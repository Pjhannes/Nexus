// src/tools.js – MCP-Tool-Implementierungen (node:sqlite, positionale Parameter)
import { readFileSync, writeFileSync, mkdirSync, renameSync, rmSync, existsSync, readdirSync, statSync } from 'fs';
import { join, dirname, resolve, sep, relative } from 'path';
import { createHash } from 'node:crypto';
import { transaction } from './db.js';
import { runVaultCheck, renderReport, REPORT_REL } from './vault-check.js';
import { evaluateDataview } from './dataview.js';
import { vortragNorm, ohneBom, ohneFrontmatter } from './norm.js';
import { safeFull as safeFullIn, TRASH_DIR, makeIgnore } from './paths.js';

// R27b: Papierkorb-Eintraege aelter als `days` Tage entfernen (Stempel-Ordner
// <vault>/.trash/<JJJJ-MM-TT_HHMMSS>). Wird beim Start von UI-Server und MCP-Server
// je Vault aufgerufen; days <= 0 schaltet das Aufraeumen ab. Gibt die Zahl der
// entfernten Stempel-Ordner zurueck.
export function emptyOldTrash(vaultPath, days = 30, now = Date.now()) {
  if (!(days > 0)) return 0;
  const root = join(vaultPath, TRASH_DIR);
  let entries;
  try { entries = readdirSync(root, { withFileTypes: true }); } catch { return 0; }
  let n = 0;
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const m = /^(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})(\d{2})/.exec(e.name);
    if (!m) continue;
    const t = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
    if (now - t > days * 24 * 60 * 60 * 1000) {
      try { rmSync(join(root, e.name), { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); n++; } catch {}
    }
  }
  return n;
}
import { bildMasse, svgMasse, mimeFuer, istVektor, BILD_ENDUNGEN } from './bildmasse.js';

// Obergrenzen fuer read_bild: eine Vorlesungsfolie als PNG liegt bei 0,1-2 MB; 12 MB
// laesst Luft nach oben, verhindert aber, dass ein Scan die Sitzung lahmlegt.
const BILD_MAX_BYTES = 12 * 1024 * 1024;
const BILD_MAX_SVG   = 200 * 1024;
import {
  validateKarten, mergeKartenIds, kartenSidecarPath, readKartenSidecar, KARTEN_VERSION, karteSpielbar,
  scanKartenSidecars, readFaecher, readReviews, foldReviews, fachFuerNotiz, fachKontext,
  lernUebersicht, lernStatistik, heuteISO, LERN_STANDARD, LERN_STUFEN, themenAusGliederung,
} from './lernen.js';

const SNIPPET_LINES = 30;

// Die Normalisierung wohnt in src/norm.js (damit auch lernen.js sie nutzen kann,
// ohne Zirkelimport) – hier weiter exportiert, damit bestehende Importe aus
// tools.js (test/vortrag.test.mjs) gueltig bleiben.
export { vortragNorm };

// Sidecar-Dateien, die zu einer Notiz gehoeren, aber im Dateibaum unsichtbar sind.
// JEDE neue Sorte muss an VIER Stellen bekannt sein, sonst bleiben unsichtbare
// Waisen zurueck: ui-server.js buildTree + treeSignature (Ausblenden) sowie hier
// in move() und deleteEntry() (Mitnahme). Seit R27a rufen /api/rename, /api/delete
// und /api/mkdir diese Funktionen – die Sidecar-Mitnahme lebt nur noch HIER.
export const SIDECAR_SUFFIXES = ['.vortrag.json', '.karten.json'];

// R27a: Crash-Leichen der atomaren Writes (<datei>.nexustmp) beim Start entfernen.
// Gleiche Ignore-Regel wie alle Walker (paths.makeIgnore: Defaults + cfg.ignore +
// Dotfiles; R27d-Review 5 – vorher eigene Liste ohne node_modules/.stversions), max. Tiefe 8.
// Gibt die Anzahl entfernter Dateien zurueck; Fehler einzelner Dateien werden
// verschluckt (z. B. Windows-Lock) – der naechste Start raeumt sie dann.
export function cleanupNexusTmp(root, ignore = []) {
  const isIgnored = makeIgnore(ignore);
  let n = 0;
  const walk = (dir, depth) => {
    if (depth > 8) return;
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (isIgnored(e.name)) continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) { walk(full, depth + 1); continue; }
      if (e.name.endsWith('.nexustmp')) { try { rmSync(full, { force: true }); n++; } catch {} }
    }
  };
  walk(root, 0);
  return n;
}

// ---- R24: Vortragsskript (<Notiz>.vortrag.json) – pure Helfer, ohne FS/DB testbar ----

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
    const fullPath = safeFull(path);                        // R27a: kein ../-Ausbruch
    if (!fullPath || typeof path !== 'string' || !path) return { error: 'Pfad ausserhalb des Vaults oder ungueltig: ' + path };
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
    // R27a: Pfad-Haertung auch bei create:true – vorher konnte ein neuer Pfad
    // mit ../ ausserhalb des Vaults angelegt werden.
    const fullPath = (typeof path === 'string' && path) ? safeFull(path) : null;
    if (!fullPath) return { error: 'Pfad ausserhalb des Vaults oder ungueltig: ' + path };
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
    // Nur Markdown gehoert in Index/FTS/Graph (wie reindex und /api/save) – seit R27a
    // laeuft auch der Editor-Save ueber diesen Pfad, der auch .txt/.json anfasst.
    if (/\.md$/i.test(fullPath)) indexer.indexFile(fullPath);
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
    // BOM strippen (Hash muss im Player reproduzierbar sein) und Frontmatter fuer die
    // ANKER-Validierung ausblenden – der Hash laeuft weiter ueber den vollen Inhalt.
    const roh = ohneBom(raw);
    const rumpf = ohneFrontmatter(roh);
    const errors = validateVortragSegmente(segmente, rumpf);
    if (errors.length)
      return { error: 'Vortragsskript ungueltig:\n- ' + errors.join('\n- ') };
    const skript = {
      version: 1,
      notiz: path.replace(/\\/g, '/'),
      notizHash: 'sha256:' + createHash('sha256').update(roh, 'utf8').digest('hex'),
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

  // R26: Karteikarten-Sidecar (<Notiz>.karten.json) fuer den Lernmodus schreiben.
  // Analog zu writeVortrag – zusaetzlich der ID-MERGE: Karten mit unveraenderter
  // Frage behalten ihre alte ID, damit der Lernstand (der nur IDs kennt, siehe
  // src/lernen.js) eine Regeneration ueberlebt. Bild-Karten behalten dabei die vom
  // Nutzer platzierten Regionen, die ein LLM nicht liefern kann.
  // Bewusst OHNE indexer.indexFile: .json gehoert nicht in Index/FTS/Graph.
  function writeKarten({ path, titel, karten }) {
    if (typeof path !== 'string' || !/\.md$/i.test(path))
      return { error: 'path muss auf eine .md-Notiz zeigen: ' + path };
    const full = safeFull(path);
    if (!full) return { error: 'Pfad ausserhalb des Vaults' };
    if (!existsSync(full)) return { error: 'Notiz existiert nicht: ' + path };
    let raw;
    try { raw = readFileSync(full, 'utf8'); } catch (e) { return { error: e.message }; }
    const roh = ohneBom(raw);
    const rumpf = ohneFrontmatter(roh);
    const errors = validateKarten(karten, rumpf, {
      bildExists: (p) => { const f = safeFull(p); return !!f && existsSync(f); },
    });
    if (errors.length)
      return { error: 'Karteikarten ungueltig:\n- ' + errors.join('\n- ') };

    const alt = readKartenSidecar(vaultPath, path);
    const { karten: merged, neu, uebernommen } = mergeKartenIds(karten, alt?.karten ?? []);
    const heute = new Date().toISOString().slice(0, 10);
    const sidecar = {
      version: KARTEN_VERSION,
      notiz: path.replace(/\\/g, '/'),
      notizHash: 'sha256:' + createHash('sha256').update(roh, 'utf8').digest('hex'),
      erstellt: alt?.erstellt || heute,
      aktualisiert: heute,
      ...(titel && String(titel).trim() ? { titel: String(titel).trim() } : {}),
      karten: merged,
    };
    const content = JSON.stringify(sidecar, null, 2) + '\n';
    const sidecarFull = full.replace(/\.md$/i, '.karten.json');
    try {
      const tmp = sidecarFull + '.nexustmp';
      writeFileSync(tmp, content, 'utf8');
      renameSync(tmp, sidecarFull);
      const back = readFileSync(sidecarFull, 'utf8');
      if (back !== content)
        return { error: 'Schreib-Integritaet verletzt: Read-Back der Karteikarten weicht ab – bitte erneut schreiben.' };
    } catch (e) { return { error: e.message }; }

    const offen = merged.filter(k => !karteSpielbar(k));
    return {
      ok: true,
      path: kartenSidecarPath(path).replace(/\\/g, '/'),
      karten: merged.length,
      neu, uebernommen,
      notizHash: sidecar.notizHash,
      ...(offen.length ? {
        bildOhneRegionen: offen.map(k => ({ id: k.id, frage: k.frage.slice(0, 60) })),
        hinweis: 'Diese Bild-Karten haben noch nicht fuer jedes Label ein Rechteck und sind darum nicht spielbar. '
          + 'Sieh dir die Bilddatei an und liefere "regionen" (label/x/y/w/h, jeweils 0..1) direkt mit – '
          + 'alternativ zieht der Nutzer sie im Karten-Editor der App auf.',
      } : {}),
    };
  }

  // Themen nachtragen, ohne die Karten neu zu schreiben: die Zuordnung kommt aus der
  // Gliederung der Notiz selbst (Belegzitat lokalisieren -> Ueberschrift darueber).
  // Kartentexte und IDs bleiben unveraendert, der Lernstand also auch.
  function karteGliedern({ path, ebene, ueberschreiben } = {}) {
    if (typeof path !== 'string' || !/\.md$/i.test(path))
      return { error: 'path muss auf eine .md-Notiz zeigen: ' + path };
    const full = safeFull(path);
    if (!full) return { error: 'Pfad ausserhalb des Vaults' };
    if (!existsSync(full)) return { error: 'Notiz existiert nicht: ' + path };
    const alt = readKartenSidecar(vaultPath, path);
    if (!alt || !Array.isArray(alt.karten) || !alt.karten.length)
      return { error: 'Keine Karteikarten zu dieser Notiz: ' + path };

    let roh;
    try { roh = ohneBom(readFileSync(full, 'utf8')); } catch (e) { return { error: e.message }; }

    // Ohne "ueberschreiben" bleiben bereits vergebene Themen unangetastet.
    const vorher = alt.karten.map(k => k.thema || '');
    const r = themenAusGliederung(roh, alt.karten, { ebene: Number.isFinite(ebene) ? ebene : 2 });
    const karten = r.karten.map((k, i) => (
      (!ueberschreiben && vorher[i]) ? { ...k, thema: vorher[i] } : k
    ));

    const sidecar = { ...alt, karten, aktualisiert: new Date().toISOString().slice(0, 10) };
    const content = JSON.stringify(sidecar, null, 2) + '\n';
    const sidecarFull = full.replace(/\.md$/i, '.karten.json');
    try {
      const tmp = sidecarFull + '.nexustmp';
      writeFileSync(tmp, content, 'utf8');
      renameSync(tmp, sidecarFull);
      if (readFileSync(sidecarFull, 'utf8') !== content)
        return { error: 'Schreib-Integritaet verletzt: Read-Back weicht ab.' };
    } catch (e) { return { error: e.message }; }

    // Verteilung zurueckmelden – so sieht man sofort, ob die Gliederung brauchbar ist.
    const proThema = new Map();
    for (const k of karten) {
      const t = k.thema || '(ohne Thema)';
      proThema.set(t, (proThema.get(t) || 0) + 1);
    }
    return {
      ok: true,
      path: kartenSidecarPath(path).replace(/\\/g, '/'),
      karten: karten.length,
      zugeordnet: r.zugeordnet,
      ohneThema: karten.filter(k => !k.thema).length,
      themen: [...proThema.entries()].map(([thema, anzahl]) => ({ thema, anzahl })),
      ...(r.offen ? { hinweis: r.offen + ' Karte(n) ohne zuordenbares Zitat – meist Bild-Karten '
        + '(die tragen kein quelle-Feld) oder Karten zu inzwischen geaenderten Stellen. '
        + 'Deren Thema laesst sich mit write_karten von Hand setzen.' } : {}),
    };
  }

  // Eine Grafik aus dem Vault so zurueckgeben, dass ein LLM sie WIRKLICH ansehen kann:
  // als base64 im MCP-Bild-Content (server.js baut daraus den image-Block). Dazu die
  // Pixelmasse aus dem Dateikopf – ohne die koennte Claude zwar das Bild sehen, aber
  // keine exakten 0..1-Koordinaten fuer die Bild-Karten daraus ableiten.
  function readBild({ path, maxBytes } = {}) {
    if (typeof path !== 'string' || !path) return { error: 'path fehlt' };
    const mime = mimeFuer(path);
    if (!mime) {
      return { error: 'Keine unterstuetzte Bilddatei: ' + path
        + ' (moeglich: ' + BILD_ENDUNGEN.join(', ') + ')' };
    }
    const full = safeFull(path);
    if (!full) return { error: 'Pfad ausserhalb des Vaults' };
    if (!existsSync(full)) return { error: 'Bild existiert nicht: ' + path };

    const deckel = Number.isFinite(maxBytes) ? Math.max(1, maxBytes) : BILD_MAX_BYTES;
    let stat;
    try { stat = statSync(full); } catch (e) { return { error: e.message }; }
    if (stat.size > deckel) {
      return { error: 'Bild ist zu gross (' + Math.round(stat.size / 1024) + ' KB, max '
        + Math.round(deckel / 1024) + ' KB). Bitte verkleinert im Vault ablegen.' };
    }

    let buf;
    try { buf = readFileSync(full); } catch (e) { return { error: e.message }; }
    const rel = path.replace(/\\/g, '/');

    // SVG ist Text: als Quelltext zurueck (Bild-Content waere hier unzuverlaessig).
    // Das ist sogar oft praeziser – die Beschriftungen stehen mit Koordinaten drin.
    if (istVektor(rel)) {
      const quelltext = buf.toString('utf8');
      const masse = svgMasse(quelltext);
      return {
        ok: true, path: rel, mime, bytes: stat.size, vektor: true,
        ...(masse ? { breite: masse.breite, hoehe: masse.hoehe, masseAus: masse.quelle } : {}),
        svg: quelltext.length > BILD_MAX_SVG ? quelltext.slice(0, BILD_MAX_SVG) : quelltext,
        gekuerzt: quelltext.length > BILD_MAX_SVG,
      };
    }

    const masse = bildMasse(buf);
    return {
      ok: true, path: rel, mime, bytes: stat.size,
      ...(masse ? { breite: masse.breite, hoehe: masse.hoehe, format: masse.format }
                : { hinweis: 'Masse nicht aus dem Dateikopf lesbar – Koordinaten anhand des Bildeindrucks schaetzen.' }),
      base64: buf.toString('base64'),
    };
  }

  // Lesender Lernstand fuer Claude: dieselbe Rechnung wie das Dashboard der App,
  // nur als kompaktes JSON – bewusst ohne Kartentexte (Prinzip: Information pro Token).
  function lernStatus({ fach, tage } = {}) {
    // R27d (Review 4): dieselbe Ignore-Regel wie das UI-Dashboard (cfg.ignore ueber indexer.isIgnored),
    // sonst zaehlt Claude Karten aus ignorierten Ordnern, die die App nicht zeigt.
    const sidecars = scanKartenSidecars(vaultPath, undefined, vcIgnored);
    const faecher  = readFaecher(vaultPath);        // liefert die Liste direkt
    const reviews  = readReviews(vaultPath);
    const heute    = heuteISO();
    const ctxById  = new Map();
    for (const sc of sidecars) {
      const f = fachFuerNotiz(sc.notiz, faecher);
      const kontext = fachKontext(f, LERN_STANDARD);
      for (const k of sc.karten || []) ctxById.set(k.id, kontext);
    }
    const zustaende = foldReviews(reviews, id => ctxById.get(id) || {});
    const ueber = lernUebersicht({ sidecars, faecher, zustaende, heute, standard: LERN_STANDARD });

    // Fach-Filter darf Name ODER ID sein – Claude kennt meist nur den Namen.
    let gewaehlt;
    if (fach !== undefined && fach !== null && String(fach).trim() !== '') {
      const such = vortragNorm(String(fach));
      const treffer = ueber.faecher.find(f => vortragNorm(f.name) === such || vortragNorm(String(f.id)) === such);
      if (!treffer) {
        return { error: 'Fach nicht gefunden: ' + fach + ' (bekannt: ' + ueber.faecher.map(f => f.name).join(', ') + ')' };
      }
      gewaehlt = treffer.id;
    }
    const stat = lernStatistik({
      sidecars, zustaende, reviews, faecher, heute,
      tage: Math.min(365, Math.max(7, Number(tage) || 30)),
      fach: gewaehlt, standard: LERN_STANDARD,
    });
    const faecherAus = ueber.faecher
      .filter(f => gewaehlt === undefined || f.id === gewaehlt)
      .map(f => ({
        name: f.name, pruefung: f.pruefung || null, resttage: f.resttage,
        notizen: f.notizen, karten: f.karten, faellig: f.faellig, neu: f.neu,
        stufenBisDurch: LERN_STUFEN.length, offeneStufen: f.fehlend,
        proTagNoetig: f.proTagNoetig, aufKurs: f.aufKurs, quote: f.quote,
        ...(f.bildOffen ? { bildOhneRegionen: f.bildOffen } : {}),
        // R28: pausierte Lernsets sind eingefroren – weder faellig noch neu.
        ...(f.pausierteSets ? { pausiert: f.pausiertGanz ? 'ganz' : f.pausierteSets + ' von ' + f.notizen + ' Lernsets', pausierteKarten: f.pausiert } : {}),
      }));
    const faellige = ueber.faellige.filter(n => gewaehlt === undefined || n.fach === gewaehlt);
    return {
      heute,
      faecher: faecherAus,
      heuteFaellig: faellige.reduce((s, n) => s + n.faellig + n.neu, 0),
      notizenFaellig: faellige
        .map(n => ({ notiz: n.notiz, fach: n.fachName || null, faellig: n.faellig, neu: n.neu })),
      notizenPausiert: ueber.notizen
        .filter(n => n.pausiertSeit && (gewaehlt === undefined || n.fach === gewaehlt))
        .map(n => ({ notiz: n.notiz, seit: n.pausiertSeit, karten: n.pausiert })),
      verteilung: stat.verteilung,
      quote: stat.gesamt.quote,
      serie: stat.gesamt.serie,
      zuletztGelernt: stat.gesamt.letzteAntwort,
      problemKarten: stat.problemKarten.map(p => ({
        frage: p.frage, notiz: p.notiz, falsch: p.lapses, quote: p.quote,
      })),
    };
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
  // R27a: EINE Implementierung fuer MCP-Tools und UI-Server – lebt in paths.js.
  function safeFull(rel) { return safeFullIn(vaultPath, rel); }

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
      // R24/R26: Sidecars der Notiz mitziehen (im Baum unsichtbar, wuerden sonst als
      // Waisen-Dateien zurueckbleiben). Hash haengt am Inhalt -> bleibt gueltig.
      if (/\.md$/i.test(src) && /\.md$/i.test(dst)) {
        for (const suf of SIDECAR_SUFFIXES) {
          const scSrc = src.replace(/\.md$/i, suf);
          const scDst = dst.replace(/\.md$/i, suf);
          if (existsSync(scSrc) && !existsSync(scDst)) { try { renameSync(scSrc, scDst); } catch {} }
        }
      }
    } catch (e) { return { error: e.message }; }
    const n = indexer.reindex();
    return { ok: true, from, to, indexed: n };
  }

  // ── R27b: Papierkorb ────────────────────────────────────────────────────────
  // delete verschiebt nach <vault>/.trash/<JJJJ-MM-TT_HHMMSS>/<relativer Pfad> statt
  // zu loeschen (Sidecars folgen in denselben Stempel-Ordner). Endgueltig loeschen
  // geht nur mit permanent:true UND nur fuer Eintraege, die schon im Papierkorb
  // liegen (Pfad beginnt mit ".trash/"). Geschuetzt: Vault-Wurzel, "_System" und
  // ".trash" selbst. Der Papierkorb ist per Dotfile-Regel aus Index, Baum, Lern-
  // Scanner und Vault-Check ausgeblendet (paths.makeIgnore).
  const relOf = (full) => relative(resolve(vaultPath), full).split(sep).join('/');
  const trashRoot = () => join(resolve(vaultPath), TRASH_DIR);
  // R27d (Review 1): Vergleiche case-insensitiv – auf Windows/macOS ist "_system" derselbe
  // Ordner wie "_System"; vorher liess sich der Schutz ueber die Schreibweise umgehen.
  const inTrash = (rel) => { const l = rel.toLowerCase(); return l === TRASH_DIR || l.startsWith(TRASH_DIR + '/'); };
  const PROTECTED = new Set(['_system', TRASH_DIR.toLowerCase()]);

  function trashStamp(d = new Date()) {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  }
  // Alle Dateien eines Stempel-Ordners (relativ zum Stempel) – fuer list_trash.
  function walkTrash(dir, rel, out) {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
    for (const e of entries) {
      const r = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) walkTrash(join(dir, e.name), r, out);
      else out.push(r);
    }
    return out;
  }

  function deleteEntry({ path, permanent = false }) {
    if (typeof path !== 'string' || !path) return { error: 'path fehlt' };
    const full = safeFull(path);
    if (!full || full === resolve(vaultPath)) return { error: 'Ungueltiger Pfad' };
    const rel = relOf(full);
    if (PROTECTED.has(rel.toLowerCase())) return { error: `Geschuetzt, kann nicht geloescht werden: ${rel}` };
    if (!existsSync(full)) return { error: 'Nicht gefunden: ' + path };
    const sidecars = /\.md$/i.test(full)
      ? SIDECAR_SUFFIXES.map(suf => full.replace(/\.md$/i, suf)).filter(sc => existsSync(sc))
      : [];
    try {
      if (permanent) {
        if (!inTrash(rel)) return { error: 'permanent:true nur fuer Eintraege im Papierkorb (.trash/...) – normales delete verschiebt in den Papierkorb' };
        // maxRetries/retryDelay faengt kurzzeitige Windows-Locks (EPERM/EBUSY) ab, z. B.
        // wenn ein Datei-Watcher den Ordner gerade noch losgelassen hat.
        rmSync(full, { recursive: true, force: true, maxRetries: 5, retryDelay: 120 });
        for (const sc of sidecars) { try { rmSync(sc, { force: true, maxRetries: 5, retryDelay: 120 }); } catch {} }
        return { ok: true, path, permanent: true, indexed: indexer.reindex() };
      }
      if (inTrash(rel)) return { error: 'Liegt bereits im Papierkorb – zum endgueltigen Loeschen permanent:true setzen' };
      // Stempel-Ordner; bei zwei Loeschungen in derselben Sekunde ein Suffix.
      let stamp = trashStamp();
      let base = join(trashRoot(), stamp);
      for (let i = 2; existsSync(join(base, rel)); i++) { stamp = trashStamp() + '-' + i; base = join(trashRoot(), stamp); }
      const dest = join(base, rel);
      mkdirSync(dirname(dest), { recursive: true });
      renameSync(full, dest);
      // R24/R26: Sidecars der Notiz mitnehmen (unsichtbare Zombies sonst) – restore holt sie zurueck.
      for (const sc of sidecars) {
        try { renameSync(sc, join(base, relOf(sc))); } catch {}
      }
      const n = indexer.reindex();
      return { ok: true, path, trashed: `${TRASH_DIR}/${stamp}/${rel}`, indexed: n };
    } catch (e) { return { error: e.message }; }
  }

  // Inhalt des Papierkorbs, neueste Loeschung zuerst. Eintrag = eine Datei mit
  // ihrem Original-Pfad; Sidecars werden unter der Notiz mitgezaehlt, nicht einzeln.
  function listTrash({ limit = 200 } = {}) {
    const root = trashRoot();
    let stamps;
    try { stamps = readdirSync(root, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name).sort().reverse(); }
    catch { stamps = []; }
    const eintraege = [];
    for (const stamp of stamps) {
      const files = walkTrash(join(root, stamp), '', []);
      const notizen = new Set(files.filter(f => /\.md$/i.test(f)));
      for (const f of files) {
        const sc = SIDECAR_SUFFIXES.find(suf => f.endsWith(suf));
        if (sc && notizen.has(f.slice(0, -sc.length) + '.md')) continue;   // haengt an der Notiz
        let bytes = 0;
        try { bytes = statSync(join(root, stamp, f)).size; } catch {}
        eintraege.push({ path: f, trashPath: `${TRASH_DIR}/${stamp}/${f}`, geloescht: stampToIso(stamp), bytes });
      }
    }
    return { eintraege: eintraege.slice(0, limit), gesamt: eintraege.length, retentionDays: null };
  }
  function stampToIso(stamp) {
    const m = /^(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})(\d{2})/.exec(stamp);
    return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}` : stamp;
  }

  // Aus dem Papierkorb zurueck an den Original-Ort. path = trashPath aus list_trash
  // (".trash/<stamp>/<rel>") oder der Original-Pfad (dann die neueste Kopie).
  // Ein Konflikt (Ziel existiert) ist ein Fehler – nichts wird ueberschrieben.
  function restore({ path }) {
    if (typeof path !== 'string' || !path) return { error: 'path fehlt' };
    const norm = path.replace(/\\/g, '/').replace(/^\/+/, '');
    let stamp, rel;
    if (inTrash(norm)) {
      const m = /^\.trash\/([^/]+)\/(.+)$/.exec(norm);
      if (!m) return { error: 'Ungueltiger Papierkorb-Pfad: ' + path };
      [, stamp, rel] = m;
    } else {
      rel = norm;
      const hit = listTrash({ limit: 100000 }).eintraege.find(e => e.path === rel);
      if (hit) stamp = hit.trashPath.split('/')[1];
      else {
        // R27d (Review 8): Ordner – listTrash kennt nur Dateien; juengsten Stempel nehmen,
        // in dem rel ein Verzeichnis ist (ganzer Ordner kommt in einem Zug zurueck).
        let stamps = [];
        try { stamps = readdirSync(trashRoot(), { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name).sort().reverse(); } catch {}
        stamp = stamps.find(st => { try { return statSync(join(trashRoot(), st, rel)).isDirectory(); } catch { return false; } });
        if (!stamp) return { error: 'Nicht gefunden im Papierkorb: ' + path };
      }
    }
    const src = safeFull(`${TRASH_DIR}/${stamp}/${rel}`);
    const dst = safeFull(rel);
    if (!src || !dst) return { error: 'Pfad ausserhalb des Vaults' };
    if (!existsSync(src)) return { error: 'Nicht gefunden im Papierkorb: ' + path };
    if (existsSync(dst)) return { error: `Ziel existiert bereits: ${rel} – erst umbenennen oder loeschen` };
    try {
      mkdirSync(dirname(dst), { recursive: true });
      renameSync(src, dst);
      if (/\.md$/i.test(dst)) {
        for (const suf of SIDECAR_SUFFIXES) {
          const scSrc = src.replace(/\.md$/i, suf), scDst = dst.replace(/\.md$/i, suf);
          if (existsSync(scSrc) && !existsSync(scDst)) { try { renameSync(scSrc, scDst); } catch {} }
        }
      }
      // Leere Stempel-Ordner nicht stehen lassen.
      pruneEmptyDirs(join(trashRoot(), stamp));
    } catch (e) { return { error: e.message }; }
    return { ok: true, path: rel, from: `${TRASH_DIR}/${stamp}/${rel}`, indexed: indexer.reindex() };
  }
  function pruneEmptyDirs(dir) {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) if (e.isDirectory()) pruneEmptyDirs(join(dir, e.name));
    try { if (readdirSync(dir).length === 0) rmSync(dir, { recursive: true, force: true }); } catch {}
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
  // R27b: dieselbe Ignore-Regel wie der Indexer (Defaults + cfg.ignore + Dotfiles).
  const vcIgnored = typeof indexer.isIgnored === 'function' ? indexer.isIgnored : makeIgnore([]);
  function walkAllFiles(dir, out = []) {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (vcIgnored(e.name)) continue;
        walkAllFiles(join(dir, e.name), out);
      } else if (e.isFile()) {
        out.push(join(dir, e.name));
      }
    }
    return out;
  }

  // regeln: cfg.vaultCheck (inactiveAreas, ignoreNames, deadPrefixes, deadNames) –
  // seit R27b stehen persoenliche Pfade in der Config, nicht mehr im generischen Code.
  function vaultCheck({ dryRun = false, regeln = {} } = {}) {
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
    const result = runVaultCheck({ notes, allRelPaths, now, regeln });
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

  return { search, outline, readNote, writeNote, writeVortrag, writeKarten, karteGliedern, readBild, lernStatus, appendToSection, backlinks, listNotes, reindex, query, patch, graph, dataview, createFolder, move, delete: deleteEntry, listTrash, restore, vaultCheck };
}
// rev: graph() fuer UI-Graph (Session 13)
