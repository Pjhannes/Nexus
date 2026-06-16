// src/ui-server.js – Express Web-UI: Dateibaum, Drag&Drop, Markitdown-Konvertierung
import express from 'express';
import multer from 'multer';
import { readdirSync, statSync, mkdirSync, renameSync, existsSync, writeFileSync, rmSync, unlinkSync } from 'fs';
import { join, extname, basename, dirname, relative, resolve, sep } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { tmpdir } from 'os';
import { readFileSync } from 'fs';
import { buildIndexer } from './indexer.js';
import { makeTools } from './tools.js';
import { loadConfig, resolveDbPath, dataPath, CONFIG_PATH } from './paths.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const cfg   = loadConfig();

// ── Vaults laden ─────────────────────────────────────────────────────────────
const indexers = {};
const toolsMap = {};

for (const v of cfg.vaults) {
  try {
    mkdirSync(v.path, { recursive: true });
    const idx = buildIndexer(v.path, resolveDbPath(v), cfg.ignore ?? []);
    idx.reindex();
    indexers[v.name] = idx;
    toolsMap[v.name] = makeTools(idx, v.path);
  } catch (e) {
    console.error(`[Nexus] Vault "${v.name}" (${v.path}) übersprungen: ${e.message}`);
  }
}

function getVault(name) {
  const n = name ?? cfg.activeVault;
  const v = cfg.vaults.find(x => x.name === n);
  if (!v) throw new Error(`Vault nicht gefunden: ${n}`);
  return { vault: v, indexer: indexers[n], tools: toolsMap[n] };
}

// ── Express ───────────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());
// index.html nie cachen – sonst lädt Electron nach UI-Änderungen eine veraltete Version (stale CSS/JS)
app.use(express.static(join(__dir, '..', 'public'), {
  etag: false,
  lastModified: false,
  setHeaders(res, path) {
    if (path.endsWith('.html')) res.setHeader('Cache-Control', 'no-store, must-revalidate');
  }
}));

// ── Dateibaum ─────────────────────────────────────────────────────────────────
function buildTree(root, relBase, ignoreSet, depth = 0) {
  if (depth > 8) return [];
  let entries;
  try { entries = readdirSync(relBase === '' ? root : join(root, relBase), { withFileTypes: true }); }
  catch { return []; }

  const result = [];
  for (const e of entries) {
    if (ignoreSet.has(e.name) || e.name.startsWith('.')) continue;
    const rel = relBase ? relBase + '/' + e.name : e.name;
    if (e.isDirectory()) {
      result.push({ name: e.name, path: rel, type: 'folder', children: buildTree(root, rel, ignoreSet, depth + 1) });
    } else {
      const ext = extname(e.name).toLowerCase();
      result.push({ name: e.name, path: rel, type: 'file', ext });
    }
  }
  result.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return result;
}

app.get('/api/vaults', (_req, res) => {
  res.json(cfg.vaults.map(v => ({ name: v.name, active: v.name === cfg.activeVault })));
});

// ── Vault-Management (anlegen / entfernen / aktiv) ─────────────────────────────
function saveConfig() {
  writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
}
function safeVaultName(n) {
  return (typeof n === 'string' && /^[^\\/:*?"<>|]+$/.test(n.trim()) && n.trim().length) ? n.trim() : null;
}
function vaultList() {
  return cfg.vaults.map(v => ({ name: v.name, active: v.name === cfg.activeVault }));
}

app.post('/api/vaults/create', (req, res) => {
  try {
    const name = safeVaultName(req.body?.name);
    if (!name) return res.status(400).json({ error: 'Ungueltiger Vault-Name' });
    if (cfg.vaults.find(v => v.name === name)) return res.status(409).json({ error: 'Vault existiert bereits' });
    const root = cfg.vaultsRoot || dataPath('vaults');
    const vpath = join(root, name);
    const dbPath = dataPath('.nexus', name + '.db');
    mkdirSync(vpath, { recursive: true });
    const idx = buildIndexer(vpath, dbPath, cfg.ignore ?? []);
    idx.reindex();
    indexers[name] = idx;
    toolsMap[name] = makeTools(idx, vpath);
    cfg.vaults.push({ name, path: vpath, dbPath });
    saveConfig();
    res.json({ ok: true, name, vaults: vaultList() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/vaults/remove', (req, res) => {
  try {
    const name = req.body?.name;
    if (cfg.vaults.length <= 1) return res.status(400).json({ error: 'Der letzte Vault kann nicht entfernt werden' });
    const i = cfg.vaults.findIndex(v => v.name === name);
    if (i < 0) return res.status(404).json({ error: 'Vault nicht gefunden' });
    cfg.vaults.splice(i, 1);
    delete indexers[name];
    delete toolsMap[name];
    if (cfg.activeVault === name) cfg.activeVault = cfg.vaults[0]?.name ?? null;
    saveConfig();
    res.json({ ok: true, activeVault: cfg.activeVault, vaults: vaultList() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/vaults/active', (req, res) => {
  try {
    const name = req.body?.name;
    if (!cfg.vaults.find(v => v.name === name)) return res.status(404).json({ error: 'Vault nicht gefunden' });
    cfg.activeVault = name;
    saveConfig();
    res.json({ ok: true, activeVault: name });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Einstellungen: Vault-Speicherort (vaultsRoot) ──────────────────────────────
// GET liefert den aktuellen Wert (fuer die Anzeige im Einstellungs-Menue),
// POST validiert + persistiert ihn strukturell in nexus.config.json via saveConfig().
app.get('/api/settings/vaultsRoot', (_req, res) => {
  res.json({ vaultsRoot: cfg.vaultsRoot || dataPath('vaults') });
});

app.post('/api/settings/vaultsRoot', (req, res) => {
  try {
    const raw = req.body?.vaultsRoot;
    if (typeof raw !== 'string' || !raw.trim()) return res.status(400).json({ error: 'vaultsRoot fehlt' });
    const p = raw.trim();
    let ok = false;
    try { ok = existsSync(p) && statSync(p).isDirectory(); } catch { ok = false; }
    if (!ok) return res.status(400).json({ error: 'Pfad existiert nicht oder ist kein Ordner' });
    cfg.vaultsRoot = p;
    saveConfig();
    res.json({
      ok: true,
      vaultsRoot: p,
      reload: true,
      note: 'Vault-Speicherort gespeichert. Neue Vaults werden hier angelegt; bestehende Vaults behalten ihren Pfad. Bitte Nexus neu starten, damit die Aenderung vollstaendig wirkt.'
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/tree', (req, res) => {
  try {
    const { vault } = getVault(req.query.vault);
    const ignoreSet = new Set(cfg.ignore ?? []);
    const tree = buildTree(vault.path, '', ignoreSet);
    res.json(tree);
  } catch (e) { res.status(404).json({ error: e.message }); }
});

app.get('/api/search', (req, res) => {
  try {
    const { tools } = getVault(req.query.vault);
    const r = tools.search({ q: req.query.q, limit: Number(req.query.limit) || 20, tag: req.query.tag });
    res.json(r);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/backlinks', (req, res) => {
  try {
    const { tools } = getVault(req.query.vault);
    res.json(tools.backlinks({ path: req.query.path }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/outline', (req, res) => {
  try {
    const { tools } = getVault(req.query.vault);
    res.json(tools.outline({ path: req.query.path }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/graph', (req, res) => {
  try {
    const { tools } = getVault(req.query.vault);
    res.json(tools.graph());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Reindex ───────────────────────────────────────────────────────────────────
app.post('/api/reindex', (req, res) => {
  try {
    const { tools } = getVault(req.body?.vault);
    const result = tools.reindex();
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Drag & Drop Upload ────────────────────────────────────────────────────────
const UPLOAD_TMP = dataPath('.nexus', 'tmp');
mkdirSync(UPLOAD_TMP, { recursive: true });
const upload = multer({ dest: UPLOAD_TMP });

app.post('/api/upload', upload.array('files'), (req, res) => {
  try {
    const { vault, indexer } = getVault(req.body.vault);
    const targetDir = req.body.targetPath
      ? join(vault.path, req.body.targetPath)
      : vault.path;
    mkdirSync(targetDir, { recursive: true });

    const moved = [];
    for (const f of req.files ?? []) {
      const dest = join(targetDir, f.originalname);
      renameSync(f.path, dest);
      if (extname(dest).toLowerCase() === '.md') indexer.indexFile(dest);
      moved.push({ name: f.originalname, path: relative(vault.path, dest).replace(/\\/g, '/') });
    }
    res.json({ ok: true, files: moved });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Markitdown Konvertierung ──────────────────────────────────────────────────
app.post('/api/convert/markitdown', (req, res) => {
  const { filePath, vault: vaultName } = req.body;
  if (!filePath) return res.status(400).json({ error: 'filePath fehlt' });

  let vaultObj;
  try { vaultObj = getVault(vaultName).vault; } catch (e) { return res.status(404).json({ error: e.message }); }

  const fullPath = join(vaultObj.path, filePath);
  if (!existsSync(fullPath)) return res.status(404).json({ error: 'Datei nicht gefunden' });

  const outPath = fullPath.replace(/\.[^.]+$/, '.md');
  const proc = spawn('python', ['-m', 'markitdown', fullPath, '-o', outPath], { shell: true, windowsHide: true });

  let stderr = '';
  proc.stderr.on('data', d => stderr += d.toString());
  proc.on('close', code => {
    if (code !== 0) return res.status(500).json({ error: `markitdown Fehler (code ${code}): ${stderr}` });
    const relOut = relative(vaultObj.path, outPath).replace(/\\/g, '/');
    // Index neue .md-Datei
    try { getVault(vaultName).indexer.indexFile(outPath); } catch {}
    res.json({ ok: true, mdPath: relOut });
  });
});

// ── Datei speichern (Editor) ──────────────────────────────────────────────────
app.post('/api/save', (req, res) => {
  try {
    const { vault: vaultName, path: relPath, content, create } = req.body || {};
    if (typeof relPath !== 'string' || !relPath.length) return res.status(400).json({ error: 'path fehlt' });
    if (typeof content !== 'string') return res.status(400).json({ error: 'content fehlt' });
    const { vault, indexer } = getVault(vaultName);
    const root = resolve(vault.path);
    const full = resolve(vault.path, relPath);
    if (full !== root && !full.startsWith(root + sep)) return res.status(400).json({ error: 'Pfad ausserhalb des Vaults' });
    const existed = existsSync(full);
    if (!existed && !create) return res.status(404).json({ error: 'Datei existiert nicht (create=false)' });
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content, 'utf8');
    if (extname(full).toLowerCase() === '.md') indexer.indexFile(full);
    res.json({ ok: true, path: relPath.replace(/\\/g, '/'), created: !existed });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Datei lesen (fuer Preview) ────────────────────────────────────────────────
function safeFull(vaultPath, relPath) {
  const root = resolve(vaultPath);
  const full = resolve(vaultPath, relPath || '');
  if (full !== root && !full.startsWith(root + sep)) return null;
  return full;
}

app.post('/api/mkdir', (req, res) => {
  try {
    const { vault: vaultName, path: relPath } = req.body || {};
    if (typeof relPath !== 'string' || !relPath.trim()) return res.status(400).json({ error: 'path fehlt' });
    const { vault } = getVault(vaultName);
    const full = safeFull(vault.path, relPath);
    if (!full) return res.status(400).json({ error: 'Pfad ausserhalb des Vaults' });
    if (existsSync(full)) return res.status(409).json({ error: 'Existiert bereits' });
    mkdirSync(full, { recursive: true });
    res.json({ ok: true, path: relPath.replace(/\\/g, '/') });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/rename', (req, res) => {
  try {
    const { vault: vaultName, oldPath, newPath } = req.body || {};
    if (typeof oldPath !== 'string' || typeof newPath !== 'string' || !oldPath || !newPath)
      return res.status(400).json({ error: 'oldPath/newPath fehlt' });
    const { vault, tools } = getVault(vaultName);
    const from = safeFull(vault.path, oldPath);
    const to   = safeFull(vault.path, newPath);
    if (!from || !to) return res.status(400).json({ error: 'Pfad ausserhalb des Vaults' });
    if (from === resolve(vault.path)) return res.status(400).json({ error: 'Ungueltiger Pfad' });
    if (!existsSync(from)) return res.status(404).json({ error: 'Quelle nicht gefunden' });
    if (existsSync(to)) return res.status(409).json({ error: 'Ziel existiert bereits' });
    mkdirSync(dirname(to), { recursive: true });
    renameSync(from, to);
    const result = tools.reindex();
    res.json({ ok: true, oldPath: oldPath.replace(/\\/g, '/'), newPath: newPath.replace(/\\/g, '/'), indexed: result.indexed });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/delete', (req, res) => {
  try {
    const { vault: vaultName, path: relPath } = req.body || {};
    if (typeof relPath !== 'string' || !relPath) return res.status(400).json({ error: 'path fehlt' });
    const { vault, tools } = getVault(vaultName);
    const full = safeFull(vault.path, relPath);
    if (!full || full === resolve(vault.path)) return res.status(400).json({ error: 'Ungueltiger Pfad' });
    if (!existsSync(full)) return res.status(404).json({ error: 'Nicht gefunden' });
    // maxRetries/retryDelay faengt kurzzeitige Windows-Locks (EPERM/EBUSY) ab,
    // z.B. wenn ein Datei-Watcher den Ordner gerade noch losgelassen hat.
    rmSync(full, { recursive: true, force: true, maxRetries: 5, retryDelay: 120 });
    const result = tools.reindex();
    res.json({ ok: true, path: relPath.replace(/\\/g, '/'), indexed: result.indexed });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Korrekter MIME-Typ pro Endung – sonst rendert z. B. eine PDF im <iframe> nicht
// (sie kam vorher IMMER als text/plain heraus -> PDF-Viewer sprang nicht an, Fehler).
// Text-Endungen bleiben text/* (Frontend liest sie via fetch().text()), Binaeres
// bekommt seinen echten Typ, Unbekanntes faellt auf octet-stream.
const MIME = {
  '.pdf':'application/pdf',
  '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.gif':'image/gif',
  '.webp':'image/webp', '.svg':'image/svg+xml', '.bmp':'image/bmp', '.avif':'image/avif',
  '.ico':'image/x-icon',
  '.html':'text/html; charset=utf-8', '.htm':'text/html; charset=utf-8',
  '.md':'text/markdown; charset=utf-8', '.markdown':'text/markdown; charset=utf-8',
  '.txt':'text/plain; charset=utf-8', '.log':'text/plain; charset=utf-8',
  '.csv':'text/csv; charset=utf-8', '.tsv':'text/tab-separated-values; charset=utf-8',
  '.json':'application/json; charset=utf-8', '.xml':'application/xml; charset=utf-8',
  '.mp4':'video/mp4', '.webm':'video/webm', '.ogv':'video/ogg', '.mov':'video/quicktime', '.mkv':'video/x-matroska',
  '.mp3':'audio/mpeg', '.wav':'audio/wav', '.ogg':'audio/ogg', '.m4a':'audio/mp4', '.flac':'audio/flac', '.aac':'audio/aac',
  '.docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx':'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.doc':'application/msword', '.xls':'application/vnd.ms-excel', '.ppt':'application/vnd.ms-powerpoint',
  '.zip':'application/zip', '.rtf':'application/rtf',
};
function mimeForExt(ext) { return MIME[ext] || 'application/octet-stream'; }

app.get('/api/file', (req, res) => {
  try {
    const { vault: v } = getVault(req.query.vault);
    const full = safeFull(v.path, req.query.path);
    if (!full || !existsSync(full)) return res.status(404).send('Datei nicht gefunden');
    // Content-Type explizit setzen (send respektiert einen bereits gesetzten Typ).
    // res.sendFile statt createReadStream().pipe(): liefert Content-Length, Accept-Ranges
    // UND beantwortet Range-Requests mit 206. Chromiums PDF-Viewer (PDFium) und die nativen
    // <audio>/<video>-Tags fordern Range/Content-Length an -> sonst "Fehler beim Laden
    // des PDF-Dokuments" bzw. kein Seeking bei Medien.
    res.type(mimeForExt(extname(full).toLowerCase()));
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(basename(full))}"`);
    res.sendFile(full, err => { if (err && !res.headersSent) res.status(err.statusCode || 500).end(); });
  } catch (e) { if (!res.headersSent) res.status(500).send(e.message); }
});

// ── Datei im Standardprogramm oeffnen (Word/Excel/...) ─────────────────────────
// Wird vom Office-/Binaer-Viewer im Frontend aufgerufen. Bevorzugt Electrons
// shell.openPath (robust, behandelt Sonderzeichen/Leerzeichen); faellt im reinen
// Node-Betrieb (npm run ui) auf OS-Befehle zurueck.
let _electronShell;
async function getShell() {
  if (_electronShell !== undefined) return _electronShell || null;
  try {
    const e = await import('electron');
    _electronShell = (e && e.shell && typeof e.shell.openPath === 'function') ? e.shell : false;
  } catch { _electronShell = false; }
  return _electronShell || null;
}
function openInDefaultApp(full) {
  const p = process.platform;
  if (p === 'win32')      spawn('rundll32', ['url.dll,FileProtocolHandler', full], { windowsHide: true, detached: true, stdio: 'ignore' }).unref();
  else if (p === 'darwin') spawn('open', [full], { detached: true, stdio: 'ignore' }).unref();
  else                    spawn('xdg-open', [full], { detached: true, stdio: 'ignore' }).unref();
}
app.post('/api/open-external', async (req, res) => {
  try {
    const { vault: vaultName, path: relPath } = req.body || {};
    if (typeof relPath !== 'string' || !relPath) return res.status(400).json({ error: 'path fehlt' });
    const { vault } = getVault(vaultName);
    const full = safeFull(vault.path, relPath);
    if (!full || !existsSync(full)) return res.status(404).json({ error: 'Datei nicht gefunden' });
    const sh = await getShell();
    if (sh) {
      const err = await sh.openPath(full);   // '' = ok, sonst Fehlertext
      if (err) return res.status(500).json({ error: err });
    } else {
      openInDefaultApp(full);
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Office-Vorschau (markitdown -> Markdown, NUR temporaer, nicht in den Vault) ──
// Liefert das konvertierte Markdown zurueck, damit der Inhalt direkt in Nexus
// lesbar ist ("so viel wie moeglich in Nexus"). Schlaegt es fehl (markitdown fehlt,
// Format nicht unterstuetzt), antwortet es mit Fehler -> Frontend bietet "extern oeffnen".
let _prevSeq = 0;
app.post('/api/preview/office', (req, res) => {
  const { filePath, vault: vaultName } = req.body || {};
  if (!filePath) return res.status(400).json({ error: 'filePath fehlt' });
  let vaultObj;
  try { vaultObj = getVault(vaultName).vault; } catch (e) { return res.status(404).json({ error: e.message }); }
  const full = safeFull(vaultObj.path, filePath);
  if (!full || !existsSync(full)) return res.status(404).json({ error: 'Datei nicht gefunden' });

  const tmpOut = join(tmpdir(), `nexus-prev-${process.pid}-${++_prevSeq}.md`);
  let done = false;
  const finish = (status, body) => {
    if (done) return; done = true;
    clearTimeout(timer);
    try { if (existsSync(tmpOut)) unlinkSync(tmpOut); } catch {}
    res.status(status).json(body);
  };
  // KEIN shell:true -> Node quotet die Argumente selbst, sodass Vault-Pfade mit
  // Leerzeichen (z. B. "Nexus Vaults") korrekt ankommen. CreateProcess findet
  // 'python' -> 'python.exe' auch ohne Shell.
  const proc = spawn('python', ['-m', 'markitdown', full, '-o', tmpOut], { windowsHide: true });
  const timer = setTimeout(() => { try { proc.kill(); } catch {} finish(504, { error: 'Zeitueberschreitung bei der Konvertierung' }); }, 25_000);
  let stderr = '';
  proc.stderr.on('data', d => stderr += d.toString());
  proc.on('error', e => finish(500, { error: `markitdown nicht gestartet: ${e.message}` }));
  proc.on('close', code => {
    if (done) return;
    if (code !== 0) return finish(500, { error: `markitdown Fehler (code ${code}): ${stderr.slice(0, 400)}` });
    let md = '';
    try { md = readFileSync(tmpOut, 'utf8'); } catch (e) { return finish(500, { error: e.message }); }
    finish(200, { ok: true, markdown: md });
  });
});

// ── R9: Claude Usage Proxy ───────────────────────────────────────────────────
app.get('/api/claude-usage', async (req, res) => {
  const { sessionKey, orgId } = req.query;
  if (!sessionKey || !orgId) return res.status(400).json({ error: 'Fehlende Parameter: sessionKey, orgId' });
  try {
    const resp = await fetch(
      `https://claude.ai/api/organizations/${encodeURIComponent(orgId)}/usage`,
      { headers: {
          'Cookie': `sessionKey=${sessionKey}`,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json',
          'Referer': 'https://claude.ai/'
      }}
    );
    if (!resp.ok) return res.status(resp.status).json({ error: `HTTP ${resp.status}` });
    res.json(await resp.json());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/claude-orgs', async (req, res) => {
  const { sessionKey } = req.query;
  if (!sessionKey) return res.status(400).json({ error: 'Fehlende Parameter: sessionKey' });
  try {
    const resp = await fetch('https://claude.ai/api/organizations', {
      headers: {
        'Cookie': `sessionKey=${sessionKey}`,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json',
        'Referer': 'https://claude.ai/'
      }
    });
    if (!resp.ok) return res.status(resp.status).json({ error: `HTTP ${resp.status}` });
    const data = await resp.json();
    if (Array.isArray(data)) {
      const chat = data.filter(o => Array.isArray(o.capabilities) && o.capabilities.includes('chat'));
      return res.json(chat.map(o => ({ id: o.uuid || o.id, name: o.name, isTeam: o.raven_type === 'team' })));
    }
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Server starten ────────────────────────────────────────────────────────────
const port = cfg.ui?.port ?? 3000;
app.listen(port, () => {
  console.log(`[Nexus UI] http://localhost:${port}`);
  if (cfg.ui?.autoOpen && !process.versions.electron) {
    const opener = process.platform === 'win32' ? 'start' : 'open';
    spawn(opener, [`http://localhost:${port}`], { shell: true, detached: true, windowsHide: true });
  }
});
