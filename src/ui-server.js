// src/ui-server.js – Express Web-UI: Dateibaum, Drag&Drop, Markitdown-Konvertierung
import express from 'express';
import multer from 'multer';
import { createReadStream, readdirSync, statSync, mkdirSync, renameSync, existsSync, writeFileSync } from 'fs';
import { join, extname, basename, dirname, relative, resolve, sep } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
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
  mkdirSync(v.path, { recursive: true });
  const idx = buildIndexer(v.path, resolveDbPath(v), cfg.ignore ?? []);
  idx.reindex();
  indexers[v.name] = idx;
  toolsMap[v.name] = makeTools(idx, v.path);
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
app.use(express.static(join(__dir, '..', 'public')));

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
  const proc = spawn('python', ['-m', 'markitdown', fullPath, '-o', outPath], { shell: true });

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
app.get('/api/file', (req, res) => {
  try {
    const { vault: v } = getVault(req.query.vault);
    const full = join(v.path, req.query.path);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    createReadStream(full).pipe(res);
  } catch (e) { res.status(500).send(e.message); }
});

// ── Server starten ────────────────────────────────────────────────────────────
const port = cfg.ui?.port ?? 3000;
app.listen(port, () => {
  console.log(`[Nexus UI] http://localhost:${port}`);
  if (cfg.ui?.autoOpen && !process.versions.electron) {
    const opener = process.platform === 'win32' ? 'start' : 'open';
    spawn(opener, [`http://localhost:${port}`], { shell: true, detached: true });
  }
});
