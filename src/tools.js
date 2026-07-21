// src/tools.js – MCP-Tool-Implementierungen (node:sqlite, positionale Parameter)
import { readFileSync, writeFileSync, mkdirSync, renameSync, rmSync, existsSync, readdirSync } from 'fs';
import { join, dirname, resolve, sep, relative } from 'path';
import { createHash } from 'node:crypto';
import { transaction } from './db.js';
import { runVaultCheck, renderReport, REPORT_REL } from './vault-check.js';
import { evaluateDataview } from './dataview.js';

const SNIPPET_LINES = 30;

// ---- R24: Vortragsskript (<Notiz>.vortrag.json) – pure Helfer, ohne FS/DB testbar ----
// Normalisierung fuer den Anker-Vergleich. Sie muss ROH-Markdown und gerenderten
// Sichttext (DOM textContent) auf dieselbe Form bringen, damit ein Anker, der hier
// beim Schreiben validiert wurde, auch im Player (vtNorm in public/index.html –
// MUSS identisch bleiben, Paritaets-Test in test/vortrag.test.mjs) gefunden wird.
// Inline-Marker (*_~`=) -> '' (Rendern entfernt sie ersatzlos, auch mitten im Wort);
// Struktur-Marker (# > |) -> ' ' (Ueberschriften-/Zitat-/Tabellenzeichen trennen Woerter).
// NFC vorweg: sonst lehnt die Validierung visuell identische Anker in NFD ab
// (z. B. von macOS kopierte Umlaute: 'ä' als 'a'+Kombinationszeichen).
export function vortragNorm(t) {
  return (t || '')
    .normalize('NFC')
    .replace(/!\[\[[^\]]+\]\]/g, ' ')                            // Embeds weg
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')                       // Bilder weg
    .replace(/\[\[([^\]#|]+)(?:#[^\]|]*)?\|([^\]]+)\]\]/g, '$2') // [[Ziel|Alias]] -> Alias
    .replace(/\[\[([^\]#|]+)(?:#[^\]|]*)?\]\]/g, '$1')           // [[Ziel]] -> Ziel
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')                     // [Text](url) -> Text
    .replace(/[*_~`=]/g, '')
    .replace(/[#>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim().toLowerCase();
}

export const VORTRAG_ARTEN = ['absatz', 'wort', 'tabelle', 'ueberschrift', 'keine'];

// Prueft ein Segment-Array gegen den rohen Notiz-Inhalt. Gibt eine Fehlerliste
// zurueck (leer = gueltig) – jede Meldung nennt das Segment, damit das LLM den
// Anker gezielt korrigieren kann.
// Obergrenzen: kein Sicherheitsthema (lokaler Client), aber ein LLM-Ausreisser soll
// keine Monster-JSON erzeugen, die der Player dann minutenlang abspielt.
const VORTRAG_MAX_SEGMENTE = 200;
const VORTRAG_MAX_SPRICH = 2000;
const VORTRAG_MAX_ANKER = 400;

export function validateVortragSegmente(segmente, noteContent) {
  const errors = [];
  if (!Array.isArray(segmente) || segmente.length === 0) {
    errors.push('segmente fehlt oder ist leer');
    return errors;
  }
  if (segmente.length > VORTRAG_MAX_SEGMENTE) {
    errors.push(`zu viele Segmente (${segmente.length}, max ${VORTRAG_MAX_SEGMENTE})`);
    return errors;
  }
  const arten = new Set(VORTRAG_ARTEN);
  const norm = vortragNorm(noteContent);
  segmente.forEach((s, i) => {
    const nr = `Segment ${i + 1}`;
    if (!s || typeof s.sprich !== 'string' || !s.sprich.trim()) {
      errors.push(`${nr}: "sprich" fehlt oder ist leer`);
      return;
    }
    if (s.sprich.length > VORTRAG_MAX_SPRICH) {
      errors.push(`${nr}: "sprich" zu lang (${s.sprich.length} Zeichen, max ${VORTRAG_MAX_SPRICH}) – in mehrere Segmente aufteilen`);
      return;
    }
    const art = s.art ?? (s.anker ? 'absatz' : 'keine');
    if (!arten.has(art)) {
      errors.push(`${nr}: unbekannte art "${s.art}" (erlaubt: ${VORTRAG_ARTEN.join('|')})`);
      return;
    }
    if (art === 'keine') return;
    if (typeof s.anker !== 'string' || !s.anker.trim()) {
      errors.push(`${nr}: "anker" fehlt (oder art:"keine" setzen)`);
      return;
    }
    if (s.anker.length > VORTRAG_MAX_ANKER) {
      errors.push(`${nr}: "anker" zu lang (${s.anker.length} Zeichen, max ${VORTRAG_MAX_ANKER}) – kurzen, eindeutigen Ausschnitt waehlen`);
      return;
    }
    const na = vortragNorm(s.anker);
    if (!na) {
      // '' waere in JEDEM Text enthalten – ein nur aus Markern bestehender Anker
      // ("**", "---") wuerde sonst still validieren und nie ein Highlight liefern.
      errors.push(`${nr}: anker besteht nur aus Markdown-Markern/Leerraum: "${s.anker.slice(0, 40)}"`);
      return;
    }
    if (!norm.includes(na))
      errors.push(`${nr}: anker nicht woertlich in der Notiz gefunden: "${s.anker.slice(0, 80)}"`);
  });
  return errors;
}

export function vortragSidecarPath(notePath) {
  return notePath.replace(/\.md$/i, '.vortrag.json');
}

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
    vcNotes:     db.prepare('SELECT id, path, title, frontmatter FROM notes'),
    vcLinks:     db.prepare('SELECT src_id, target FROM links'),
    dvNotes:     db.prepare('SELECT path, title, mtime, size, tags, frontmatter FROM notes'),
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
    if (typeof content !== 'string')
      return { error: 'content fehlt oder ist kein String' };
    // R14+: Schreib-Integritaet per VOLLEM Read-Back (nicht nur Byte-Laenge).
    // Eine reine Laengen-Pruefung faengt die EIGENTLICHE Fehlerklasse NICHT, die in
    // STATUS.md/scripts/safe-edit.mjs dokumentiert ist: Read-Modify-Write ueber den
    // divergierenden Windows<->Linux-Mount kappt am Puffer-Boundary (~5 KB), padded mit
    // NUL gleicher Laenge oder schreibt eine stale Fassung zurueck – alles teils
    // laengengleich und damit fuer statSync unsichtbar. Deshalb wie safe-edit.mjs:
    // atomar schreiben (tmp + rename) und den GANZEN Inhalt frisch von Platte gegen das
    // Soll vergleichen. Weicht der Read-Back ab, ist es ein ECHTER Fehler – kein stilles
    // ok:true, kein Datenverlust.
    const expectedBytes = Buffer.byteLength(content, 'utf8');
    try {
      mkdirSync(dirname(fullPath), { recursive: true });
      const tmp = fullPath + '.nexustmp';
      writeFileSync(tmp, content, 'utf8');
      renameSync(tmp, fullPath); // Windows: MoveFileEx-Semantik -> ueberschreibt Ziel atomar
      const back = readFileSync(fullPath, 'utf8');
      if (back !== content) {
        const actualBytes = Buffer.byteLength(back, 'utf8');
        return { error: `Schreib-Integritaet verletzt: Read-Back stimmt nicht mit dem gewollten Inhalt ueberein (${actualBytes} statt ${expectedBytes} Bytes, ${path}). Moegliche Trunkierung/NUL-Padding/Mount-Korruption – Datei NICHT als ok gemeldet, bitte erneut schreiben.` };
      }
    } catch (e) { return { error: e.message }; }
    indexer.indexFile(fullPath);
    return { ok: true, path, bytes: expectedBytes };
  }

  // R24: Vortragsskript-Sidecar (<Notiz>.vortrag.json) schreiben. Validiert jeden
  // anker gegen die echte Notiz und stempelt den sha256-Hash des Notiz-Inhalts –
  // beides kann das LLM nicht zuverlaessig selbst, deshalb passiert es HIER.
  // Bewusst OHNE indexer.indexFile: .json gehoert nicht in Index/FTS/Graph
  // (Vorbild: /api/save indexiert nur .md). Die UI blendet *.vortrag.json im
  // Baum aus; der Vortrag-Button laedt sie ueber /api/file.
  function writeVortrag({ path, titel, segmente }) {
    if (typeof path !== 'string' || !/\.md$/i.test(path))
      return { error: 'path muss auf eine .md-Notiz zeigen: ' + path };
    const full = safeFull(path);
    if (!full) return { error: 'Pfad ausserhalb des Vaults' };
    if (!existsSync(full)) return { error: 'Notiz existiert nicht: ' + path };
    let raw;
    try { raw = readFileSync(full, 'utf8'); } catch (e) { return { error: e.message }; }
    // BOM strippen: fetch().text() im Player entfernt die UTF-8-BOM per Spec –
    // ein Hash ueber den BOM-behafteten String waere client-seitig NIE reproduzierbar
    // (Skript stuende dauerhaft auf "veraltet").
    const ohneBom = raw.replace(/^﻿/, '');
    // Frontmatter fuer die ANKER-Validierung ausblenden: die Leseansicht rendert es
    // als Chip, ein Anker daraus waere serverseitig "gueltig", aber im Player nie
    // auffindbar. Der Hash laeuft weiter ueber den vollen Inhalt (ohne BOM).
    const rumpf = ohneBom.replace(/^---\r?\n[\s\S]*?\r?\n---(\r?\n|$)/, '');
    const errors = validateVortragSegmente(segmente, rumpf);
    if (errors.length)
      return { error: 'Vortragsskript ungueltig:\n- ' + errors.join('\n- ') };
    const skript = {
      version: 1,
      notiz: path.replace(/\\/g, '/'),
      notizHash: 'sha256:' + createHash('sha256').update(ohneBom, 'utf8').digest('hex'),
      erstellt: new Date().toISOString().slice(0, 10),
      ...(titel && String(titel).trim() ? { titel: String(titel).trim() } : {}),
      segmente: segmente.map(s => {
        const art = s.art ?? (s.anker ? 'absatz' : 'keine');
        return {
          sprich: s.sprich.trim(),
          ...(art !== 'keine' ? { anker: s.anker.trim() } : {}),
          art,
        };
      }),
    };
    const content = JSON.stringify(skript, null, 2) + '\n';
    const sidecarFull = full.replace(/\.md$/i, '.vortrag.json');
    // Atomik + voller Read-Back wie writeNote (R14+).
    try {
      const tmp = sidecarFull + '.nexustmp';
      writeFileSync(tmp, content, 'utf8');
      renameSync(tmp, sidecarFull);
      const back = readFileSync(sidecarFull, 'utf8');
      if (back !== content)
        return { error: 'Schreib-Integritaet verletzt: Read-Back des Vortragsskripts weicht ab – bitte erneut schreiben.' };
    } catch (e) { return { error: e.message }; }
    return { ok: true, path: vortragSidecarPath(path).replace(/\\/g, '/'), segmente: skript.segmente.length, notizHash: skript.notizHash };
  }

  function appendToSection({ path, section, text }) {
    const { content, error } = readNote({ path });
    if (error) return { error };
    const originalBytes = Buffer.byteLength(content, 'utf8');
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
    const merged = lines.join('\n');
    // R14: append fuegt nur ein – das Ergebnis darf NIE kuerzer als das Original sein.
    // Waere es kuerzer, deutet das auf eine Trunkierung beim Lesen/Zusammenbauen hin
    // (bestehende grosse Notiz wuerde sonst beim Rueckschreiben gekappt -> Datenverlust).
    if (Buffer.byteLength(merged, 'utf8') < originalBytes)
      return { error: 'append_to_section abgebrochen: Ergebnis kuerzer als Original – moeglicher Datenverlust, nichts geschrieben.' };
    return writeNote({ path, content: merged });
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
      // R24: Vortragsskript-Sidecar der Notiz mitziehen (im Baum unsichtbar, wuerde
      // sonst als Waisen-Datei zurueckbleiben). Hash haengt am Inhalt -> bleibt gueltig.
      if (/\.md$/i.test(src) && /\.md$/i.test(dst)) {
        const scSrc = src.replace(/\.md$/i, '.vortrag.json');
        const scDst = dst.replace(/\.md$/i, '.vortrag.json');
        if (existsSync(scSrc) && !existsSync(scDst)) { try { renameSync(scSrc, scDst); } catch {} }
      }
    } catch (e) { return { error: e.message }; }
    const n = indexer.reindex();
    return { ok: true, from, to, indexed: n };
  }

  function deleteEntry({ path }) {
    if (typeof path !== 'string' || !path) return { error: 'path fehlt' };
    const full = safeFull(path);
    if (!full || full === resolve(vaultPath)) return { error: 'Ungueltiger Pfad' };
    if (!existsSync(full)) return { error: 'Nicht gefunden: ' + path };
    try {
      rmSync(full, { recursive: true, force: true });
      // R24: Sidecar der geloeschten Notiz mit entfernen (unsichtbarer Zombie sonst).
      if (/\.md$/i.test(full)) {
        const sc = full.replace(/\.md$/i, '.vortrag.json');
        if (existsSync(sc)) { try { rmSync(sc, { force: true }); } catch {} }
      }
    } catch (e) { return { error: e.message }; }
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
    let expectedDelta = 0;   // R14: summierte Laengenaenderung aller angewandten Patches
    const missed = [];
    for (const p of patches) {
      if (typeof p.old_str !== 'string') { missed.push('<kein old_str>'); continue; }
      if (cur.includes(p.old_str)) {
        // replace() ersetzt nur erste Fundstelle (gewuenscht – analog zu Edit-Tool)
        const repl = p.new_str ?? '';
        cur = cur.replace(p.old_str, repl);
        expectedDelta += repl.length - p.old_str.length;
        applied++;
      } else {
        missed.push(p.old_str.slice(0, 60));
      }
    }
    if (applied === 0) return { error: 'Kein Patch anwendbar', missed };
    // R14: exakte Laengen-Invariante. Jede Erste-Fundstelle-Ersetzung aendert die Laenge
    // um genau (new_str.length - old_str.length). Stimmt das Resultat nicht mit
    // (Original + Summe der Deltas) ueberein, ist etwas anderes passiert (z. B. eine
    // Trunkierung) – dann NICHT schreiben, sondern echten Fehler melden.
    if (cur.length !== content.length + expectedDelta)
      return { error: 'patch abgebrochen: Laengen-Invariante verletzt (moegliche Trunkierung) – nichts geschrieben.', applied, missed: missed.length ? missed : undefined };
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

  // dataview: fuehrt eine Dataview-(DQL)-Query (LIST/TABLE) gegen den Live-Index aus.
  // Baut die "pages" (Notiz-Metadaten) aus der DB und reicht sie an die pure Engine
  // (src/dataview.js) weiter. Ersetzt die in Obsidian eingebetteten Dataview-Bloecke.
  function dataview({ source } = {}) {
    if (typeof source !== 'string' || !source.trim()) return { error: 'Leere Dataview-Query' };
    const noExt = (s) => s.replace(/\.md$/i, '');
    const pages = stmts.dvNotes.all().map(r => {
      let fm; try { fm = JSON.parse(r.frontmatter ?? '{}'); } catch { fm = {}; }
      let tags; try { tags = JSON.parse(r.tags ?? '[]'); } catch { tags = []; }
      const name = noExt(r.path.split('/').pop());
      const slash = r.path.lastIndexOf('/');
      const folder = slash >= 0 ? r.path.slice(0, slash) : '';
      const tagList = tags.map(t => '#' + String(t).replace(/^#/, ''));
      return {
        file: {
          path: r.path, name, folder,
          link: { __link: true, path: r.path, display: name },
          // mtime/ctime als Epoch-ms (Indexer speichert Math.floor(mtimeMs)); ctime mangels
          // birthtime im Index = mtime (Vault sortiert ohnehin nur nach file.mtime).
          mtime: r.mtime, ctime: r.mtime, size: r.size,
          tags: tagList, etags: tagList,
        },
        fm,
      };
    });
    return evaluateDataview(source, pages);
  }

  // vault_check: Gesundheits-Check ueber den LIVE-Index (kein Voll-Reparse).
  // Speist die reine Pruef-Logik (src/vault-check.js) aus der DB + einem billigen
  // readdir-Lauf fuer Anhang-Dateinamen (damit [[bild.png]]-Embeds nicht als
  // "broken" zaehlen). Schreibt den Bericht nach _System/Vault-Check.md und gibt
  // eine kompakte Zusammenfassung zurueck (max. Info pro Token).
  const VC_IGNORE_DIRS = new Set(['.obsidian', '.trash', '.nexus', 'node_modules', '.git']);
  function walkAllFiles(dir, out = []) {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (VC_IGNORE_DIRS.has(e.name)) continue;
        walkAllFiles(join(dir, e.name), out);
      } else if (e.isFile()) {
        out.push(join(dir, e.name));
      }
    }
    return out;
  }

  function vaultCheck({ dryRun = false } = {}) {
    // Frischer Index – inkrementell, ueberspringt unveraenderte mtimes (quasi gratis).
    indexer.reindex();

    const noExt = (s) => s.replace(/\.md$/i, '');
    const base  = (p) => p.split('/').pop();

    // Links pro Notiz gruppieren (eine Query statt N).
    const linksBy = new Map();
    for (const l of stmts.vcLinks.all()) {
      let arr = linksBy.get(l.src_id);
      if (!arr) { arr = []; linksBy.set(l.src_id, arr); }
      arr.push(l.target);
    }
    const notes = stmts.vcNotes.all().map(r => {
      let fm; try { fm = JSON.parse(r.frontmatter ?? '{}'); } catch { fm = {}; }
      const basename = noExt(base(r.path));
      return {
        path: r.path,
        basename,
        pathNoExt: noExt(r.path),
        title: r.title || basename,
        fm,
        links: linksBy.get(r.id) ?? [],
      };
    });

    // Alle Dateien (inkl. Anhaenge) – nur readdir, KEIN Lesen/Parsen.
    const allRelPaths = walkAllFiles(vaultPath).map(f => relative(vaultPath, f).split(sep).join('/'));

    const now = Date.now();
    const result = runVaultCheck({ notes, allRelPaths, now });
    const report = renderReport(result, { now, notesCount: notes.length, filesCount: allRelPaths.length });

    let reportPath = null;
    if (!dryRun) {
      const w = writeNote({ path: REPORT_REL, content: report, create: true });
      if (w.error) return { error: 'Bericht konnte nicht geschrieben werden: ' + w.error };
      reportPath = REPORT_REL;
    }

    const cap = 5;
    return {
      vault: vaultPath,
      notesScanned: notes.length,
      filesScanned: allRelPaths.length,
      summary: {
        brokenLinks: result.brokenLinks.length,
        orphans:     result.orphans.length,
        staleDates:  result.staleDates.length,
        deadRefs:    result.deadRefs.length,
        duplicates:  result.duplicates.length,
      },
      // Erste Treffer je Kategorie fuer sofortige Sicht; voller Bericht in reportPath.
      samples: {
        brokenLinks: result.brokenLinks.slice(0, cap),
        orphans:     result.orphans.slice(0, cap),
        staleDates:  result.staleDates.slice(0, cap),
        deadRefs:    result.deadRefs.slice(0, cap),
        duplicates:  result.duplicates.slice(0, cap),
      },
      reportPath,
      dryRun,
    };
  }

  return { search, outline, readNote, writeNote, writeVortrag, appendToSection, backlinks, listNotes, reindex, query, patch, graph, dataview, createFolder, move, delete: deleteEntry, vaultCheck };
}
// rev: graph() fuer UI-Graph (Session 13)
