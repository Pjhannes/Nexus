// src/tools.js – MCP-Tool-Implementierungen (node:sqlite, positionale Parameter)
import { readFileSync, writeFileSync, mkdirSync, renameSync, rmSync, existsSync } from 'fs';
import { join, dirname, resolve, sep } from 'path';
import { transaction } from './db.js';

const SNIPPET_LINES = 30;

export function makeTools(indexer, vaultPath) {
  const { db } = indexer;

  const stmts = {
    // Kein JOIN: FTS5-Hilfsfunktionen (snippet, rank) benoetigen direkten Tabellenzugriff.
    // Ein alias (notes_fts f) mit snippet(notes_fts, ...) kann je nach SQLite-Version
    // "SQL logic error" ausloesen – daher einfachste Form ohne Alias.
    searchFts:   db.prepare(`
      SELECT path, title, snippet(notes_fts, 2, '**', '**', '…', 15) AS snip
      FROM notes_fts
      WHERE notes_fts MATCH ?
      ORDER BY rank LIMIT ?
    `),
    noteTags:    db.prepare('SELECT tags FROM notes WHERE path = ?'),
    listAll:     db.prepare('SELECT path, title, tags FROM notes LIMIT ?'),
    listAllOff:  db.prepare('SELECT path, title, tags FROM notes LIMIT ? OFFSET ?'),
    outline:     db.prepare('SELECT id, title FROM notes WHERE path = ?'),
    headings:    db.prepare('SELECT level, text, line FROM headings WHERE note_id = ? ORDER BY line'),
    findNote:    db.prepare('SELECT id FROM notes WHERE path = ?'),
    findHeading: db.prepare('SELECT line FROM headings WHERE note_id = ? AND text LIKE ? ORDER BY line LIMIT 1'),
    findNextH:   db.prepare('SELECT line FROM headings WHERE note_id = ? AND line > ? AND level <= ? ORDER BY line LIMIT 1'),
    findHLevel:  db.prepare('SELECT level FROM headings WHERE note_id = ? AND line = ?'),
    backlinks:   db.prepare(`
      SELECT DISTINCT n.path, n.title FROM links l
      JOIN notes n ON l.src_id = n.id
      WHERE l.target = ? OR l.target = ? OR l.target = ?
    `),
    noteTitle:   db.prepare('SELECT title FROM notes WHERE path = ?'),
    listPrefix:  db.prepare('SELECT path, title FROM notes WHERE path LIKE ? LIMIT ?'),
    listPrefOff: db.prepare('SELECT path, title FROM notes WHERE path LIKE ? LIMIT ? OFFSET ?'),
    allFm:       db.prepare('SELECT path, title, frontmatter FROM notes'),
    allNotes:    db.prepare('SELECT path, title FROM notes'),
    allLinks:    db.prepare('SELECT n.path AS src, l.target AS target FROM links l JOIN notes n ON l.src_id = n.id'),
  };

  // FTS5-Sanitizer: Sonderzeichen entfernen, je Wort Prefix-Wildcard anhaengen.
  // Verhindert "SQL logic error" bei Eingaben mit FTS5-Sonderzeichen (+ - " ( ) * ^).
  function buildFtsQuery(q) {
    const clean = q.replace(/[^\p{L}\p{N}\s]/gu, ' ').trim().replace(/\s+/g, ' ');
    if (!clean) return null;
    return clean.split(' ').map(w => w + '*').join(' ');
  }

  function search({ q, limit = 20, offset = 0, tag }) {
    let rows;
    if (q) {
      const ftsQ = buildFtsQuery(q);
      if (!ftsQ) return [];
      // offset fuer FTS5: LIMIT + OFFSET direkt in SQL
      const stmt = offset > 0
        ? db.prepare(`
            SELECT path, title, snippet(notes_fts, 2, '**', '**', '…', 15) AS snip
            FROM notes_fts WHERE notes_fts MATCH ? ORDER BY rank LIMIT ? OFFSET ?
          `)
        : stmts.searchFts;
      rows = offset > 0 ? stmt.all(ftsQ, limit, offset) : stmt.all(ftsQ, limit);
      if (tag) {
        rows = rows.filter(r => {
          const nr = stmts.noteTags.get(r.path);
          return JSON.parse(nr?.tags ?? '[]').includes(tag);
        });
      }
      return rows.map(r => ({ path: r.path, title: r.title, snippet: r.snip ?? null }));
    } else {
      rows = offset > 0
        ? stmts.listAllOff.all(limit, offset)
        : stmts.listAll.all(limit);
      if (tag) rows = rows.filter(r => JSON.parse(r.tags ?? '[]').includes(tag));
      return rows.map(r => ({ path: r.path, title: r.title, snippet: null }));
    }
  }

  function outline({ path }) {
    const note = stmts.outline.get(path);
    if (!note) return { error: 'Notiz nicht gefunden: ' + path };
    return { path, title: note.title, headings: stmts.headings.all(note.id) };
  }

  function readNote({ path, section, lines }) {
    const fullPath = join(vaultPath, path);
    let content;
    try { content = readFileSync(fullPath, 'utf8'); } catch {
      return { error: 'Datei nicht lesbar: ' + path };
    }
    if (section) {
      const note = stmts.findNote.get(path);
      if (note) {
        const h = stmts.findHeading.get(note.id, '%' + section + '%');
        if (h) {
          const allLines = content.split('\n');
          const start = h.line - 1;
          const end = lines ? start + lines : start + SNIPPET_LINES;
          return { path, section, content: allLines.slice(start, end).join('\n') };
        }
      }
    }
    if (lines) {
      const allLines = content.split('\n');
      return { path, content: allLines.slice(0, lines).join('\n'), truncated: allLines.length > lines };
    }
    return { path, content };
  }

  function writeNote({ path, content, create = false }) {
    const fullPath = join(vaultPath, path);
    if (!stmts.findNote.get(path) && !create)
      return { error: 'Notiz existiert nicht (create=false): ' + path };
    try {
      mkdirSync(dirname(fullPath), { recursive: true });
      writeFileSync(fullPath, content, 'utf8');
    } catch (e) { return { error: e.message }; }
    indexer.indexFile(fullPath);
    return { ok: true, path };
  }

  function appendToSection({ path, section, text }) {
    const { content, error } = readNote({ path });
    if (error) return { error };
    const lines = content.split('\n');
    const note = stmts.findNote.get(path);
    let insertAt = lines.length;
    if (note && section) {
      const h = stmts.findHeading.get(note.id, '%' + section + '%');
      if (h) {
        const lvlRow = stmts.findHLevel.get(note.id, h.line);
        const level = lvlRow?.level ?? 1;
        const next = stmts.findNextH.get(note.id, h.line, level);
        insertAt = next ? next.line - 1 : lines.length;
      }
    }
    lines.splice(insertAt, 0, '', text);
    return writeNote({ path, content: lines.join('\n') });
  }

  function backlinks({ path }) {
    const title  = stmts.noteTitle.get(path)?.title;
    const name   = path.replace(/\.md$/, '').split('/').pop();
    const noExt  = path.replace(/\.md$/, '');
    return { path, backlinks: stmts.backlinks.all(name, title ?? name, noExt) };
  }

  function listNotes({ prefix = '', limit = 100, offset = 0 } = {}) {
    if (offset > 0) return stmts.listPrefOff.all(prefix + '%', limit, offset);
    return stmts.listPrefix.all(prefix + '%', limit);
  }

  function reindex() {
    const n = indexer.reindex();
    return { ok: true, indexed: n };
  }

  // Pfad-Sicherheit: aufgeloester Pfad muss innerhalb des Vaults liegen (kein ../-Ausbruch).
  function safeFull(rel) {
    const root = resolve(vaultPath);
    const full = resolve(vaultPath, rel || '');
    if (full !== root && !full.startsWith(root + sep)) return null;
    return full;
  }

  // create_folder / move / delete: Ordner- und Datei-Operationen direkt im Vault.
  // Damit braucht Claude KEINE blockierte Datei-System-/Mount-Operation mehr (kein
  // allow_cowork_file_delete o.ae.) – alles laeuft ueber die Nexus-Tools.
  function createFolder({ path }) {
    if (typeof path !== 'string' || !path.trim()) return { error: 'path fehlt' };
    const full = safeFull(path);
    if (!full) return { error: 'Pfad ausserhalb des Vaults' };
    if (existsSync(full)) return { error: 'Existiert bereits: ' + path };
    try { mkdirSync(full, { recursive: true }); } catch (e) { return { error: e.message }; }
    return { ok: true, path };
  }

  function move({ from, to }) {
    if (typeof from !== 'string' || typeof to !== 'string' || !from || !to)
      return { error: 'from/to fehlt' };
    const src = safeFull(from), dst = safeFull(to);
    if (!src || !dst) return { error: 'Pfad ausserhalb des Vaults' };
    if (src === resolve(vaultPath)) return { error: 'Ungueltiger Pfad (Vault-Wurzel)' };
    if (!existsSync(src)) return { error: 'Quelle nicht gefunden: ' + from };
    if (existsSync(dst)) return { error: 'Ziel existiert bereits: ' + to };
    try {
      mkdirSync(dirname(dst), { recursive: true });
      renameSync(src, dst);
    } catch (e) { return { error: e.message }; }
    const n = indexer.reindex();
    return { ok: true, from, to, indexed: n };
  }

  function deleteEntry({ path }) {
    if (typeof path !== 'string' || !path) return { error: 'path fehlt' };
    const full = safeFull(path);
    if (!full || full === resolve(vaultPath)) return { error: 'Ungueltiger Pfad' };
    if (!existsSync(full)) return { error: 'Nicht gefunden: ' + path };
    try { rmSync(full, { recursive: true, force: true }); } catch (e) { return { error: e.message }; }
    const n = indexer.reindex();
    return { ok: true, path, indexed: n };
  }

  // patch: Batch-Edits – mehrere String-Ersetzungen in einer Datei.
  // patches: [{ old_str: string, new_str: string }]
  // Jeder Patch ersetzt die erste Fundstelle von old_str durch new_str.
  // Gibt applied (Anzahl erfolgreicher Patches) und missed (nicht gefundene old_str) zurueck.
  function patch({ path, patches = [] }) {
    if (!patches.length) return { error: 'Keine Patches angegeben' };
    const { content, error } = readNote({ path });
    if (error) return { error };
    let cur = content;
    let applied = 0;
    const missed = [];
    for (const p of patches) {
      if (typeof p.old_str !== 'string') { missed.push('<kein old_str>'); continue; }
      if (cur.includes(p.old_str)) {
        // replace() ersetzt nur erste Fundstelle (gewuenscht – analog zu Edit-Tool)
        cur = cur.replace(p.old_str, p.new_str ?? '');
        applied++;
      } else {
        missed.push(p.old_str.slice(0, 60));
      }
    }
    if (applied === 0) return { error: 'Kein Patch anwendbar', missed };
    const result = writeNote({ path, content: cur });
    return { ...result, applied, missed: missed.length ? missed : undefined };
  }

  // query: Frontmatter-Filter
  // op: '=' | '!=' | 'contains' | 'exists' | '<' | '>'
  function query({ field, op = '=', value, limit = 100 } = {}) {
    if (!field) return { error: 'field ist Pflicht' };
    const rows = stmts.allFm.all();
    const results = [];
    for (const row of rows) {
      let fm;
      try { fm = JSON.parse(row.frontmatter ?? '{}'); } catch { fm = {}; }
      if (!(field in fm)) continue;
      const fv = fm[field];
      let match = false;
      switch (op) {
        case '=':
        case '==':       match = String(fv) === String(value); break;
        case '!=':       match = String(fv) !== String(value); break;
        case 'contains': match = Array.isArray(fv) ? fv.includes(value) : String(fv).includes(String(value)); break;
        case 'exists':   match = fv !== null && fv !== undefined; break;
        case '<':        match = Number(fv) < Number(value); break;
        case '>':        match = Number(fv) > Number(value); break;
        default:         return { error: 'Unbekannter Operator: ' + op };
      }
      if (match) {
        const entry = { path: row.path, title: row.title };
        entry[field] = fv;
        results.push(entry);
        if (results.length >= limit) break;
      }
    }
    return results;
  }

  function graph() {
    return { nodes: stmts.allNotes.all(), links: stmts.allLinks.all() };
  }

  return { search, outline, readNote, writeNote, appendToSection, backlinks, listNotes, reindex, query, patch, graph, createFolder, move, delete: deleteEntry };
}
// rev: graph() fuer UI-Graph (Session 13)
