// src/indexer.js – Vollscan + inkrementeller Update + File-Watcher (node:sqlite)
import { readdirSync, statSync, readFileSync, mkdirSync } from 'fs';
import { join, relative, extname, basename } from 'path';
import { openDb, transaction } from './db.js';
import { parseNote } from './parse.js';

export function buildIndexer(vaultPath, dbPath, ignoreList = []) {
  mkdirSync(vaultPath, { recursive: true });
  const db = openDb(dbPath);
  const ignoreSet = new Set(ignoreList);

  function walk(dir, results = []) {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return results; }
    for (const e of entries) {
      if (ignoreSet.has(e.name)) continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) walk(full, results);
      else if (e.isFile() && extname(e.name) === '.md') results.push(full);
    }
    return results;
  }

  const stmts = {
    get:    db.prepare('SELECT id, mtime FROM notes WHERE path = ?'),
    upsert: db.prepare(`
      INSERT INTO notes (path, title, mtime, size, tags, frontmatter)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(path) DO UPDATE SET
        title=excluded.title, mtime=excluded.mtime, size=excluded.size,
        tags=excluded.tags, frontmatter=excluded.frontmatter
    `),
    getId:     db.prepare('SELECT id FROM notes WHERE path = ?'),
    delH:      db.prepare('DELETE FROM headings WHERE note_id = ?'),
    delL:      db.prepare('DELETE FROM links WHERE src_id = ?'),
    insH:      db.prepare('INSERT INTO headings (note_id,level,text,line) VALUES (?,?,?,?)'),
    insL:      db.prepare('INSERT INTO links (src_id,target,alias,line) VALUES (?,?,?,?)'),
    ftsDel:    db.prepare('DELETE FROM notes_fts WHERE rowid = ?'),
    ftsIns:    db.prepare('INSERT INTO notes_fts(rowid,path,title,body) VALUES (?,?,?,?)'),
    allPaths:  db.prepare('SELECT id, path FROM notes'),
    delNote:   db.prepare('DELETE FROM notes WHERE id = ?'),
    delByPath: db.prepare('DELETE FROM notes WHERE path = ?'),
    getByPath: db.prepare('SELECT id FROM notes WHERE path = ?'),
    count:     db.prepare('SELECT COUNT(*) as n FROM notes'),
  };

  function toRel(fullPath) {
    return relative(vaultPath, fullPath).split('\\').join('/');
  }

  function indexFile(fullPath) {
    const relPath = toRel(fullPath);
    let stat;
    try { stat = statSync(fullPath); } catch { return; }
    const mtime = stat.mtimeMs | 0;
    const size  = stat.size;

    const existing = stmts.get.get(relPath);
    if (existing && existing.mtime === mtime) return;

    let content = '';
    try { content = readFileSync(fullPath, 'utf8'); } catch { return; }

    const { frontmatter, title, headings, tags, links } = parseNote(content);
    const noteTitle = title ?? basename(relPath, '.md');

    transaction(db, () => {
      stmts.upsert.run(relPath, noteTitle, mtime, size, JSON.stringify(tags), JSON.stringify(frontmatter));
      const id = stmts.getId.get(relPath).id;
      stmts.delH.run(id);
      stmts.delL.run(id);
      for (const h of headings) stmts.insH.run(id, h.level, h.text, h.line);
      for (const l of links)    stmts.insL.run(id, l.target, l.alias ?? null, l.line ?? null);
      stmts.ftsDel.run(id);
      stmts.ftsIns.run(id, relPath, noteTitle, content);
    });
  }

  function removeStale(diskPaths) {
    const diskSet = new Set(diskPaths.map(p => toRel(p)));
    for (const row of stmts.allPaths.all()) {
      if (!diskSet.has(row.path)) stmts.delNote.run(row.id);
    }
  }

  function deleteFile(fullPath) {
    const relPath = toRel(fullPath);
    const row = stmts.getByPath.get(relPath);
    if (!row) return;
    stmts.ftsDel.run(row.id);
    stmts.delByPath.run(relPath);
  }

  return {
    db,
    reindex() {
      const files = walk(vaultPath);
      for (const f of files) indexFile(f);
      removeStale(files);
      return files.length;
    },
    indexFile,
    deleteFile,
    stats() { return stmts.count.get(); },
  };
}

/**
 * Startet einen File-Watcher (chokidar) fuer einen Vault.
 * @param {object} indexer   – Rueckgabewert von buildIndexer()
 * @param {string} vaultPath – Absoluter Vault-Pfad
 * @param {string[]} ignoreList – Ordner/Dateien, die ignoriert werden
 * @param {function} onChange  – Callback(event, path) bei jeder Aenderung (optional)
 * @returns {Promise<object>} chokidar FSWatcher
 */
export async function watchVault(indexer, vaultPath, ignoreList = [], onChange = null) {
  const { default: chokidar } = await import('chokidar');
  const ignoreSet = new Set(ignoreList);

  const watcher = chokidar.watch(vaultPath, {
    ignored: (p) => {
      const parts = p.split('/');
      return parts.some(seg => ignoreSet.has(seg));
    },
    ignoreInitial: true,
    persistent: true,
    // WICHTIG (Windows): Polling statt nativem fs.watch. Der native Watcher
    // (ReadDirectoryChangesW) haelt offene Verzeichnis-Handles -> Ordner/Themen
    // lassen sich dann weder in Nexus (rmSync EPERM) noch im Windows-Explorer
    // loeschen. Polling oeffnet keine dauerhaften Handles und gibt Ordner frei.
    usePolling: true,
    interval: 700,
    binaryInterval: 1500,
    awaitWriteFinish: { stabilityThreshold: 400, pollInterval: 100 },
  });

  watcher
    .on('add',    p => { if (p.endsWith('.md')) { indexer.indexFile(p);  onChange?.('add',    p); } })
    .on('change', p => { if (p.endsWith('.md')) { indexer.indexFile(p);  onChange?.('change', p); } })
    .on('unlink', p => { if (p.endsWith('.md')) { indexer.deleteFile(p); onChange?.('unlink', p); } });

  return watcher;
}
