// src/ui-server.js – Express Web-UI: Dateibaum, Drag&Drop, Markitdown-Konvertierung
import express from 'express';
import multer from 'multer';
import { readdirSync, statSync, mkdirSync, renameSync, existsSync, writeFileSync, unlinkSync, copyFileSync, chmodSync } from 'fs';
import { join, extname, basename, dirname, relative, resolve } from 'path';
import { fileURLToPath } from 'url';
import { spawn, spawnSync } from 'child_process';
import { tmpdir } from 'os';
import { readFileSync } from 'fs';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { buildIndexer } from './indexer.js';
import { makeTools, SIDECAR_SUFFIXES, cleanupNexusTmp } from './tools.js';
import { loadConfig, resolveDbPath, dataPath, CONFIG_PATH, safeFull, writeConfigAtomic } from './paths.js';
// R26: Lernmodus – Karteikarten-Sidecars, Review-Log und Faecher liegen im Vault,
// die Auswertung (Faelligkeit, Pruefungs-Planung) ist pure Logik in lernen.js.
import {
  scanKartenSidecars, readReviews, foldReviews, appendReview, readFaecher, writeFaecher,
  lernUebersicht, sessionQueue, lernStatistik, storniereReview, ankiExport,
  fachFuerNotiz, fachKontext, kartenSidecarPath, heuteISO,
  LERN_STANDARD, LERN_LOGDIR, FAECHER_REL, karteSpielbar,
} from './lernen.js';
// Phase 1: Piper-TTS + Claude-Connect laufen als REST statt Electron-IPC – dieselbe
// Route funktioniert in-process unter Electron UND spaeter als eigenstaendiger
// Tauri-Sidecar-Prozess (computeLaunchSpec() unten erkennt die Umgebung selbst).
import { piperStatus, piperInstallVoice, piperDeleteVoice, piperSynth } from './piper.js';
import { connectClaude, migrateClaudeEntryIfStale } from './claude-connect.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const cfg   = loadConfig();
// Dev-Identitaet: von scripts/dev-tauri.mjs (tauri dev) bzw. Nexus-Dev.bat gesetzt.
const DEV   = process.env.NEXUS_DEV === '1';

// App-Version aus package.json – eine Quelle der Wahrheit, passt sich bei jedem Build automatisch an
// (gleiche Version, die tauri.conf.json referenziert). package.json liegt sowohl im Dev-Baum als auch im
// gepackten Sidecar-Layout (src-tauri/tauri.conf.json -> bundle.resources) unter dem Projekt-Root, also
// ein Level über src/.
let APP_VERSION = '';
try { APP_VERSION = JSON.parse(readFileSync(join(__dir, '..', 'package.json'), 'utf8')).version || ''; } catch { /* ignore */ }

// ── Vaults laden ─────────────────────────────────────────────────────────────
const indexers = {};
const toolsMap = {};

for (const v of cfg.vaults) {
  try {
    mkdirSync(v.path, { recursive: true });
    // R27a: Reste abgebrochener atomarer Writes (<datei>.nexustmp) wegraeumen, bevor
    // der Index laeuft – sonst stehen sie ewig als unsichtbare Leichen im Vault.
    const tmpRest = cleanupNexusTmp(v.path, cfg.ignore ?? []);
    if (tmpRest) console.log(`[Nexus] Vault "${v.name}": ${tmpRest} .nexustmp-Rest(e) entfernt`);
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
// R27a: 2 MB statt der 100-kB-Voreinstellung – ein Kartensatz mit 300 Karten samt
// Bild-Regionen liegt darueber und scheiterte vorher still mit 413.
app.use(express.json({ limit: '2mb' }));

const WEB = process.env.NEXUS_WEB === '1';

// ── R27a: Start-Token fuer die UI-API ─────────────────────────────────────────
// Der Server lauscht zwar nur noch auf Loopback (siehe app.listen unten), aber
// jeder lokale Prozess/Browser-Tab koennte die API trotzdem ansprechen. Deshalb:
// pro Start ein Zufalls-Token (32 Byte hex). Es liegt in <DATA_DIR>/.nexus/ui-token
// (nur Besitzer lesbar) – die Tauri-Shell liest es dort und haengt es als ?t=…
// an die Fenster-URL; der Server setzt daraus ein HttpOnly-Cookie und leitet auf
// die URL ohne Query um. Danach prueft eine Middleware vor /api/*: Cookie ODER
// Header X-Nexus-Token (fuer Skripte/Tests). Ausnahmen: GET /api/version (Anzeige
// im Wizard/Hilfe), /api/events nur per Cookie (EventSource kann keine Header).
// Im Web-Betrieb (NEXUS_WEB=1) ist das Token AUS – dort authentifiziert
// Authelia/Caddy vor dem Container, und lernen.html hat keinen ?t=-Weg.
// NEXUS_UI_TOKEN (Env) ueberschreibt das Zufalls-Token – fuer Tests und Dev.
const UI_TOKEN = WEB ? null : (
  /^[0-9a-f]{16,128}$/i.test(process.env.NEXUS_UI_TOKEN || '') ? process.env.NEXUS_UI_TOKEN : randomBytes(32).toString('hex')
);
const UI_TOKEN_FILE = dataPath('.nexus', 'ui-token');
const UI_COOKIE = 'nexus_ui';
if (UI_TOKEN) {
  try {
    mkdirSync(dataPath('.nexus'), { recursive: true });
    writeFileSync(UI_TOKEN_FILE, UI_TOKEN, { encoding: 'utf8', mode: 0o600 });
    try { chmodSync(UI_TOKEN_FILE, 0o600); } catch {}
  } catch (e) { console.error(`[Nexus] ui-token nicht schreibbar (${UI_TOKEN_FILE}): ${e.message}`); }
}
function tokenOk(given) {
  if (!UI_TOKEN || typeof given !== 'string' || given.length !== UI_TOKEN.length) return false;
  return timingSafeEqual(Buffer.from(given, 'utf8'), Buffer.from(UI_TOKEN, 'utf8'));
}
function cookieValue(req, name) {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) { try { return decodeURIComponent(part.slice(i + 1).trim()); } catch { return null; } }
  }
  return null;
}
function tokenUrl(base, token) {
  if (!token) return base;
  return base + (base.includes('?') ? '&' : '?') + 't=' + encodeURIComponent(token);
}
if (UI_TOKEN) {
  // 1) ?t=<token> auf einer Seiten-URL -> Cookie setzen, ohne Query weiterleiten.
  app.use((req, res, next) => {
    if (req.method !== 'GET' || typeof req.query.t !== 'string' || req.path.startsWith('/api/')) return next();
    if (tokenOk(req.query.t)) {
      res.setHeader('Set-Cookie', `${UI_COOKIE}=${UI_TOKEN}; Path=/; HttpOnly; SameSite=Strict`);
    } else {
      console.error('[Nexus] ?t= mit falschem Token – kein Cookie gesetzt');
    }
    const u = new URL(req.originalUrl, 'http://x');
    u.searchParams.delete('t');
    res.redirect(302, u.pathname + u.search);
  });
  // 2) /api/* nur mit gueltigem Cookie oder Header.
  app.use('/api', (req, res, next) => {
    if (req.method === 'GET' && (req.path === '/version' || req.path === '/version/')) return next();
    if (tokenOk(cookieValue(req, UI_COOKIE))) return next();
    if (req.path !== '/events' && tokenOk(req.headers['x-nexus-token'])) return next();
    res.status(401).json({ error: 'Nicht autorisiert: UI-Token fehlt oder ist ungueltig (Nexus-App neu starten).' });
  });
}

// ── Web-Betrieb (Container hinter Reverse-Proxy): NEXUS_WEB=1 ────────────────
// Auf dem Heimserver laeuft derselbe Server, aber ohne Desktop drumherum. Routen,
// die dort sinnlos sind oder auf dem SERVER Prozesse/Programme starten wuerden,
// werden hart gesperrt – unabhaengig davon, was der Proxy durchlaesst (Guertel und
// Hosentraeger). Ohne die Variable aendert sich nichts, die Desktop-App ist unberuehrt.
const WEB_GESPERRT = new Set([
  '/api/open-external',      // startet das Standardprogramm des SERVERS
  '/api/open-external-url',
  '/api/connect-claude',     // schreibt Claude-Desktop-Konfiguration des SERVERS
  '/api/claude-usage',       // Claude-Session-Key liegt auf dem Desktop, nicht im Container
  '/api/claude-orgs', '/api/claude-auth',
  '/api/vaults/create', '/api/vaults/remove', '/api/vaults/active',
]);
if (WEB) {
  app.use((req, res, next) => {
    if (WEB_GESPERRT.has(req.path) || (req.method === 'POST' && req.path === '/api/settings/vaultsRoot')) {
      return res.status(403).json({ error: 'Im Web-Betrieb deaktiviert (NEXUS_WEB=1).' });
    }
    next();
  });
  console.log('[nexus] Web-Betrieb: geraetegebundene Routen gesperrt (NEXUS_WEB=1)');
}
// index.html nie cachen – sonst lädt Electron nach UI-Änderungen eine veraltete Version (stale CSS/JS)
app.use(express.static(join(__dir, '..', 'public'), {
  etag: false,
  lastModified: false,
  setHeaders(res, path) {
    // .html und die geteilte Lern-Logik nie cachen – etag/lastModified sind aus, es gaebe
    // sonst gar keinen Validator und Handy/Desktop liefen auf alter Wertungslogik.
    if (path.endsWith('.html') || path.endsWith('lernen-kern.js')) res.setHeader('Cache-Control', 'no-store, must-revalidate');
  }
}));

// ── Dateibaum ─────────────────────────────────────────────────────────────────
// Sidecar-Erkennung an EINER Stelle: buildTree und treeSignature muessen exakt
// dieselbe Menge ausblenden (siehe Kommentar in buildTree).
function istSidecar(name) {
  return SIDECAR_SUFFIXES.some(s => name.endsWith(s) || name.endsWith(s + '.nexustmp'));
}

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
      // R24/R26: Sidecars (Vortragsskript, Karteikarten) sind Maschinen-Dateien –
      // nicht im Baum zeigen. Auch die .nexustmp-Crash-Leichen der atomaren Writes.
      // (Gleiche Regel in treeSignature spiegeln, sonst feuert das SSE-Polling
      // tree-changed-Events fuer unsichtbare Dateien.)
      if (istSidecar(e.name)) continue;
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

// Billige Signatur des sichtbaren Baums (gleiche Ignore-Regeln wie buildTree):
// FNV-1a-Hash ueber alle relativen Pfade + Anzahl. EIN readdir pro Ordner (kein
// stat pro Datei) -> sehr guenstig, auch bei tausenden Dateien. Aendert sich genau
// dann, wenn Dateien/Ordner hinzukommen, verschwinden oder umbenannt/verschoben
// werden (Inhalts-Edits ohne Pfadaenderung lassen den Baum – korrekt – unberuehrt).
// R26: derselbe Lauf berechnet eine ZWEITE Signatur fuer die Lern-Daten
// (*.karten.json, _System/Lernen/**). Die muss getrennt sein, weil die Karten-
// Sidecars aus dem sichtbaren Baum ausgeblendet sind – eine von Claude geschriebene
// Karte wuerde sonst nie ein Event ausloesen und das Dashboard bliebe veraltet.
// Hier zaehlt der INHALT (mtime+size), nicht nur der Pfad: eine geaenderte Karte
// oder eine neue Antwortzeile im Log aendert den Pfad ja nicht.
function mixStr(state, key, s) {
  for (let i = 0; i < s.length; i++) { state[key] ^= s.charCodeAt(i); state[key] = Math.imul(state[key], 0x01000193) >>> 0; }
}
function treeSignature(root, ignoreSet, depth = 0, rel = '', state = { h: 0x811c9dc5 >>> 0, n: 0, lh: 0x811c9dc5 >>> 0 }) {
  if (depth > 8) return state;
  let entries;
  try { entries = readdirSync(rel === '' ? root : join(root, rel), { withFileTypes: true }); }
  catch { return state; }
  for (const e of entries) {
    if (ignoreSet.has(e.name) || e.name.startsWith('.')) continue;
    const r = rel ? rel + '/' + e.name : e.name;
    if (!e.isDirectory() && istSidecar(e.name)) {                       // R24/R26: wie buildTree
      if (e.name.endsWith('.karten.json')) mixLern(state, root, r);
      continue;
    }
    if (!e.isDirectory() && (r === FAECHER_REL || r.startsWith(LERN_LOGDIR + '/'))) mixLern(state, root, r);
    state.n++;
    mixStr(state, 'h', r);
    if (e.isDirectory()) treeSignature(root, ignoreSet, depth + 1, r, state);
  }
  return state;
}
function mixLern(state, root, rel) {
  let st;
  try { st = statSync(join(root, rel)); } catch { return; }
  mixStr(state, 'lh', rel + ':' + st.size + ':' + Math.floor(st.mtimeMs));
}
function treeSigString(root, ignoreSet) {
  const s = treeSignature(root, ignoreSet);
  return { tree: s.n + ':' + s.h, lern: String(s.lh) };
}

app.get('/api/vaults', (_req, res) => {
  res.json(cfg.vaults.map(v => ({ name: v.name, active: v.name === cfg.activeVault })));
});

// ── Vault-Management (anlegen / entfernen / aktiv) ─────────────────────────────
// R27a: atomar (tmp + rename) – ein Absturz mitten im Schreiben laesst nie eine
// halbe nexus.config.json zurueck, aus der der naechste Start nicht mehr hochkommt.
function saveConfig() {
  writeConfigAtomic(CONFIG_PATH, cfg);
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

app.get('/api/version', (_req, res) => {
  res.json({ version: APP_VERSION });
});

// Kurzlink fuer das Handy-Lesezeichen; die Seite selbst liefert express.static.
app.get('/lernen', (_req, res) => res.redirect(302, '/lernen.html'));

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

// ── Dataview: dynamische LIST/TABLE-Bloecke zur Laufzeit aufloesen ──────────────
// Das Frontend rendert ```dataview-Bloecke als Platzhalter und fuellt sie ueber
// diesen Endpunkt (Nexus-Aequivalent zu Obsidians Dataview-Plugin).
app.post('/api/dataview', (req, res) => {
  try {
    const { tools } = getVault(req.body?.vault);
    res.json(tools.dataview({ source: req.body?.source }));
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

// ── R26: Lernmodus (Karteikarten + Spaced Repetition) ─────────────────────────
// Alle Daten liegen im Vault (Karten neben der Notiz, Antworten als JSONL, Faecher
// in _System/Lernen/faecher.json) – hier wird nur gelesen, gefaltet und gerechnet.
// Mehrgeraete-Betrieb (R26b): je Geraet schreibt genau ein Prozess seinen Antwort-Log
// append-only; Syncthing bringt die Dateien zusammen, readReviews bildet die Vereinigung
// ueber ALLE *.jsonl (inkl. Konfliktkopien) und dedupliziert per t|karte.
const _kartenCache = {};   // Vault -> Map(sidecarPfad -> {mtime, sidecar}), mtime-invalidiert
// Obergrenze einer einzelnen Sitzung. Kein fachliches Limit mehr (das entscheidet der
// Nutzer ueber seine Auswahl), nur ein Riegel gegen versehentlich riesige Queues.
const MAX_SITZUNG = 2000;
const _reviewCache = {};   // Vault -> {sig, reviews}

// Der Log waechst mit jeder Antwort; ihn bei jedem Dashboard-Poll komplett neu zu
// parsen waere Verschwendung. Signatur = Dateinamen + Groesse + mtime im Log-Ordner.
function readReviewsCached(vaultPath, name) {
  let sig = '';
  try {
    for (const f of readdirSync(join(vaultPath, ...LERN_LOGDIR.split('/'))).sort()) {
      if (!/\.jsonl$/i.test(f)) continue;
      const st = statSync(join(vaultPath, ...LERN_LOGDIR.split('/'), f));
      sig += `${f}:${st.size}:${Math.floor(st.mtimeMs)}|`;
    }
  } catch { sig = ''; }
  const hit = _reviewCache[name];
  if (hit && hit.sig === sig) return hit.reviews;
  const reviews = readReviews(vaultPath);
  _reviewCache[name] = { sig, reviews };
  return reviews;
}

function lernKontext(vaultName) {
  const { vault, tools } = getVault(vaultName);
  const cache = (_kartenCache[vault.name] ||= new Map());
  const sidecars = scanKartenSidecars(vault.path, cache);
  const faecher  = readFaecher(vault.path);
  // Karten-ID -> Fach-Kontext: die Pruefungs-Kappung braucht ihn schon beim Falten
  // des Logs, nicht erst beim Anzeigen.
  const ctxById = new Map();
  for (const sc of sidecars) {
    const ctx = fachKontext(fachFuerNotiz(sc.notiz, faecher), LERN_STANDARD);
    for (const k of sc.karten) ctxById.set(k.id, ctx);
  }
  const reviews = readReviewsCached(vault.path, vault.name);
  const zustaende = foldReviews(reviews, id => ctxById.get(id) || {});
  return { vault, tools, sidecars, faecher, zustaende, reviews, heute: heuteISO(), standard: LERN_STANDARD };
}

app.get('/api/lernen/statistik', (req, res) => {
  try {
    const { sidecars, faecher, zustaende, reviews, heute, standard } = lernKontext(req.query.vault);
    const tage = Math.min(365, Math.max(7, Number(req.query.tage) || 30));
    // fach fehlt => alles; '__ohne__' => Karten ohne Fach-Zuordnung
    const fach = req.query.fach === undefined ? undefined
      : (req.query.fach === '__ohne__' ? null : String(req.query.fach));
    res.json(lernStatistik({ sidecars, zustaende, reviews, faecher, heute, tage, fach, standard }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/lernen/uebersicht', (req, res) => {
  try {
    const { sidecars, faecher, zustaende, heute, standard } = lernKontext(req.query.vault);
    res.json(lernUebersicht({ sidecars, zustaende, faecher, heute, standard }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Sitzungs-Queue. Ohne Filter: alles, was heute im ganzen Vault faellig ist –
// das ist der "Alles lernen"-Knopf der Abfrage-Uebersicht.
app.get('/api/lernen/session', (req, res) => {
  try {
    const { sidecars, faecher, zustaende, heute, standard } = lernKontext(req.query.vault);
    const filter = {};
    if (req.query.note) filter.notiz = String(req.query.note).replace(/\\/g, '/');
    // Themenblock-Auswahl: mehrere Notizen gleichzeitig (zeilengetrennt).
    if (req.query.notes) {
      const liste = String(req.query.notes).split('\n').map(s => s.trim().replace(/\\/g, '/')).filter(Boolean);
      if (liste.length) filter.notizen = liste;
    }
    // Feinere Auswahl: einzelne Themen als "<Notiz>::<Thema>" (leeres Thema = ohne Thema)
    if (req.query.themen) {
      const liste = String(req.query.themen).split('\n').map(s => s.trim().replace(/\\/g, '/')).filter(Boolean);
      if (liste.length) filter.themen = liste;
    }
    // '__ohne__' = die Sammelkachel "Ohne Fach" im Dashboard (Karten ohne Fach-Zuordnung).
    if (req.query.fach) filter.fach = req.query.fach === '__ohne__' ? null : String(req.query.fach);
    // limit=0 (bzw. "alle") heisst: keine Obergrenze. Wer ein Thema bewusst waehlt, will
    // es ganz durcharbeiten; gedeckelt wird nur noch gegen Ausreisser (MAX_SITZUNG).
    const roh = String(req.query.limit ?? '').trim();
    const limit = (roh === '0' || roh.toLowerCase() === 'alle') ? MAX_SITZUNG
      : Math.min(MAX_SITZUNG, Math.max(1, Number(roh) || 60));
    // uebung=1: alles abfragen, nichts einplanen (der Client schreibt dann keine Antworten)
    const uebung = req.query.uebung === '1' || req.query.uebung === 'true';
    // ohneTageslimit=1: das Tagesbudget "neue Karten pro Tag" ignorieren (bewusste Themenwahl)
    const ohneTageslimit = req.query.ohneTageslimit === '1' || req.query.ohneTageslimit === 'true';
    // nurFaellig=1: Umfang "Nur Faelliges" – neue Karten bleiben draussen, sonst weicht
    // die Sitzung von der Zahl ab, die der Auswahl-Dialog vorher angezeigt hat.
    const nurFaellig = req.query.nurFaellig === '1' || req.query.nurFaellig === 'true';
    const q = sessionQueue({ sidecars, zustaende, faecher, heute, standard, filter, limit, uebung, ohneTageslimit, nurFaellig });
    // Der Client braucht den Fach-Kontext nicht – nur Karte, Herkunft und Zustand.
    res.json({
      ...q,
      karten: q.karten.map(e => ({
        karte: e.karte, notiz: e.notiz, titel: e.titel, fach: e.fach,
        neu: !e.zustand || !e.zustand.due,
        due: e.zustand?.due ?? null,
        stufe: e.zustand?.stufe ?? 0,
      })),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/lernen/antwort', (req, res) => {
  try {
    const { vault: vaultName, notiz, kartenId, korrekt, dauerMs, session, detail } = req.body || {};
    if (typeof kartenId !== 'string' || !kartenId) return res.status(400).json({ error: 'kartenId fehlt' });
    if (typeof korrekt !== 'boolean') return res.status(400).json({ error: 'korrekt muss true/false sein' });
    const { vault } = getVault(vaultName);
    const heute = heuteISO();
    const r = appendReview(vault.path, { tag: heute, karte: kartenId, korrekt, notiz, dauerMs, session, detail });
    if (r.error) return res.status(500).json(r);
    // Neu falten statt inkrementell rechnen: eine Quelle der Wahrheit (der Log).
    const { zustaende, sidecars, faecher, standard } = lernKontext(vaultName);
    broadcastEvent({ type: 'lernen-changed', vault: vault.name });
    res.json({
      ok: true,
      t: r.t,                       // fuer /api/lernen/undo, falls sich der Nutzer verklickt
      zustand: zustaende.get(kartenId) ?? null,
      offen: sessionQueue({ sidecars, zustaende, faecher, heute, standard, limit: 500 }).gesamt,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Verklickt? Die Antwort wird nicht geloescht (append-only Log), sondern storniert.
app.post('/api/lernen/undo', (req, res) => {
  try {
    const { vault: vaultName, kartenId, t } = req.body || {};
    const { vault } = getVault(vaultName);
    const r = storniereReview(vault.path, { karte: kartenId, t });
    if (r.error) return res.status(400).json(r);
    const { zustaende } = lernKontext(vaultName);
    broadcastEvent({ type: 'lernen-changed', vault: vault.name });
    res.json({ ok: true, zustand: zustaende.get(kartenId) ?? null });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/lernen/anki', (req, res) => {
  try {
    const { sidecars, faecher } = lernKontext(req.query.vault);
    const fach = req.query.fach === undefined ? undefined
      : (req.query.fach === '__ohne__' ? null : String(req.query.fach));
    const r = ankiExport({ sidecars, faecher, fach });
    const name = 'nexus-karten' + (req.query.fach ? '-' + String(req.query.fach).replace(/[^\w-]+/g, '_') : '') + '.txt';
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="' + name + '"');
    res.setHeader('X-Nexus-Karten', String(r.karten));
    res.send(r.tsv);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/lernen/faecher', (req, res) => {
  try {
    const { vault } = getVault(req.query.vault);
    res.json({ faecher: readFaecher(vault.path), standard: LERN_STANDARD });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/lernen/faecher', (req, res) => {
  try {
    const { vault } = getVault(req.body?.vault);
    const faecher = req.body?.faecher;
    if (!Array.isArray(faecher)) return res.status(400).json({ error: 'faecher fehlt' });
    for (const f of faecher) {
      for (const o of (Array.isArray(f?.ordner) ? f.ordner : [])) {
        const full = safeFull(vault.path, o);
        if (!full) return res.status(400).json({ error: `Ordner ausserhalb des Vaults: ${o}` });
        if (!existsSync(full)) return res.status(400).json({ error: `Ordner existiert nicht: ${o}` });
      }
    }
    const r = writeFaecher(vault.path, faecher);
    if (r.error) return res.status(400).json(r);
    broadcastEvent({ type: 'lernen-changed', vault: vault.name });
    res.json({ ...r, faecherListe: readFaecher(vault.path) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Karten einer Notiz fuer den Editor: Inhalt + Veraltungs-Hinweis + Lernstand.
app.get('/api/karten', (req, res) => {
  try {
    const { vault } = getVault(req.query.vault);
    const relNote = String(req.query.path || '').replace(/\\/g, '/');
    if (!/\.md$/i.test(relNote)) return res.status(400).json({ error: 'path muss auf eine .md-Notiz zeigen' });
    const noteFull = safeFull(vault.path, relNote);
    if (!noteFull || !existsSync(noteFull)) return res.status(404).json({ error: 'Notiz nicht gefunden' });
    const scFull = safeFull(vault.path, kartenSidecarPath(relNote));
    let sidecar = null;
    if (scFull && existsSync(scFull)) { try { sidecar = JSON.parse(readFileSync(scFull, 'utf8')); } catch { sidecar = null; } }
    let stale = false;
    if (sidecar?.notizHash) {
      const roh = readFileSync(noteFull, 'utf8').replace(/^﻿/, '');
      stale = sidecar.notizHash !== 'sha256:' + createHash('sha256').update(roh, 'utf8').digest('hex');
    }
    const { zustaende } = lernKontext(req.query.vault);
    const karten = (sidecar?.karten ?? []).map(k => ({
      ...k,
      spielbar: karteSpielbar(k),
      zustand: zustaende.get(k.id) ?? null,
    }));
    res.json({ notiz: relNote, titel: sidecar?.titel ?? null, erstellt: sidecar?.erstellt ?? null, stale, karten });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Editor-Speichern laeuft durch DIESELBE Validierung + denselben ID-Merge wie das
// MCP-Tool – es gibt nur einen Schreibpfad fuer Karteikarten.
app.post('/api/karten/save', (req, res) => {
  try {
    const { vault: vaultName, path: relNote, titel, karten } = req.body || {};
    const { vault, tools } = getVault(vaultName);
    const r = tools.writeKarten({ path: String(relNote || '').replace(/\\/g, '/'), titel, karten });
    if (r.error) return res.status(400).json(r);
    broadcastEvent({ type: 'lernen-changed', vault: vault.name });
    res.json(r);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Piper-Neural-TTS (R24b, seit Phase 1 REST statt Electron-IPC) ─────────────
// Fortschritt bei Downloads geht als SSE-Event ueber den bestehenden /api/events-Kanal
// (kein separater Kanal noetig, der Client hoert dort schon auf tree-changed).
app.get('/api/piper/status', (_req, res) => {
  try { res.json(piperStatus()); } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/piper/install', async (req, res) => {
  try {
    const r = await piperInstallVoice(req.body?.id, (p) => broadcastEvent({ type: 'piper-progress', ...p }));
    res.json(r);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/piper/delete', (req, res) => {
  try { res.json(piperDeleteVoice(req.body?.id)); } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/piper/synth', async (req, res) => {
  try {
    const { text, voice, lengthScale } = req.body || {};
    res.json(await piperSynth(text, { voice, lengthScale }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Claude-Desktop-Anbindung (REST statt Electron-IPC) ────────────────────────
// computeLaunchSpec(): process.execPath ist der Node-Sidecar (bzw. der Dev-Node)
// -> ein reiner Node-Prozess, kein ELECTRON_RUN_AS_NODE-Trick noetig (der entfiel
// mit dem Electron-Rueckbau R25). Unter der gepackten Tauri-Shell gibt NEXUS_DATA_DIR
// server.js den schreibbaren Datenordner mit.
function computeLaunchSpec() {
  const env = {};
  if (process.env.NEXUS_DATA_DIR) env.NEXUS_DATA_DIR = process.env.NEXUS_DATA_DIR;
  return { command: process.execPath, args: [join(__dir, 'server.js')], env };
}
app.post('/api/connect-claude', (_req, res) => {
  try {
    res.json(connectClaude({ launchSpec: computeLaunchSpec(), mcpKey: DEV ? 'nexus-dev' : 'nexus' }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Phase 3 – Auto-Migration beim Start unter der GEPACKTEN Tauri-Shell:
// Die Rust-Shell markiert ihren Sidecar mit NEXUS_SHELL=tauri (nur Release).
// Ein bestehender Claude-Desktop-Eintrag aus der Electron-Aera (Nexus.exe mit
// ELECTRON_RUN_AS_NODE) wird dann einmalig auf die Node-Sidecar-Spec
// umgeschrieben (mit Backup) – danach ist die Pruefung idempotent (kein weiterer
// Write). Bewusst NICHT im Dev / bei `npm run ui`: dort soll nie ungefragt an der
// echten Claude-Config geschrieben werden.
if (process.env.NEXUS_SHELL === 'tauri' && !DEV) {
  try {
    const r = migrateClaudeEntryIfStale({ launchSpec: computeLaunchSpec(), mcpKey: 'nexus' });
    if (r.migrated) console.error(`[Nexus] Claude-Desktop-Eintrag auf Node-Sidecar migriert (Backup: ${r.path}.nexus-backup). Claude Desktop einmal neu starten.`);
    else console.error(`[Nexus] Claude-Eintrag: ${r.reason}`);
  } catch (e) { console.error('[Nexus] Claude-Migration fehlgeschlagen:', e.message); }
}

// ── Drag & Drop Upload ────────────────────────────────────────────────────────
const UPLOAD_TMP = dataPath('.nexus', 'tmp');
mkdirSync(UPLOAD_TMP, { recursive: true });
// R27a: harte Obergrenzen (200 MB je Datei, 50 Dateien je Request) – multer wirft
// dann einen MulterError, den der Fehler-Handler unten als 413 beantwortet.
const UPLOAD_MAX_BYTES = 200 * 1024 * 1024;
const UPLOAD_MAX_FILES = 50;
const upload = multer({ dest: UPLOAD_TMP, limits: { fileSize: UPLOAD_MAX_BYTES, files: UPLOAD_MAX_FILES } });

// rename ueber Laufwerks-/Mount-Grenzen (EXDEV: Upload-Temp in %APPDATA%, Vault auf D:)
// faellt auf copy + unlink zurueck.
function moveFileSync(from, to) {
  try { renameSync(from, to); }
  catch (e) {
    if (e.code !== 'EXDEV') throw e;
    copyFileSync(from, to);
    unlinkSync(from);
  }
}

app.post('/api/upload', upload.array('files'), (req, res) => {
  const cleanup = () => { for (const f of req.files ?? []) { try { unlinkSync(f.path); } catch {} } };
  try {
    const { vault, indexer } = getVault(req.body.vault);
    // R27a: targetPath geht durch safeFull – vorher konnte ../ aus dem Vault fuehren.
    const targetDir = safeFull(vault.path, req.body.targetPath || '');
    if (!targetDir) { cleanup(); return res.status(400).json({ error: 'Zielordner ausserhalb des Vaults' }); }
    mkdirSync(targetDir, { recursive: true });

    const moved = [];
    for (const f of req.files ?? []) {
      // Nur der Dateiname zaehlt – Pfadanteile im Upload-Namen (a/../b) werden verworfen.
      const name = basename(String(f.originalname || '').replace(/\\/g, '/'));
      const dest = name ? safeFull(targetDir, name) : null;
      if (!dest || dest === targetDir) { try { unlinkSync(f.path); } catch {} continue; }
      moveFileSync(f.path, dest);
      if (extname(dest).toLowerCase() === '.md') indexer.indexFile(dest);
      moved.push({ name, path: relative(vault.path, dest).replace(/\\/g, '/') });
    }
    res.json({ ok: true, files: moved });
  } catch (e) { cleanup(); res.status(500).json({ error: e.message }); }
});

// ── Python/markitdown-Interpreter robust aufloesen (R16) ───────────────────────
// Frueher hart 'python'. Auf macOS gibt es seit 12.3 KEIN 'python' mehr (nur
// 'python3') -> spawn schlug fehl -> Office-/Word-Vorschau blieb leer, nur
// "extern oeffnen" ging. Wir probieren plattformabhaengig mehrere Kandidaten und
// pruefen, ob markitdown dort wirklich installiert ist. Erfolg wird gecacht; ist
// markitdown (noch) nirgends da, wird beim naechsten Aufruf erneut gesucht (so wirkt
// ein spaeteres "pip install markitdown" ohne App-Neustart).
let _pyCmd = null;
function resolvePythonCmd() {
  if (_pyCmd) return _pyCmd;
  // Reihenfolge bewusst: Windows zuerst der offizielle Launcher 'py' – das blanke
  // 'python' ist auf Windows oft der Store-Alias-Stub, der haengt/den Store oeffnet
  // (hier real als ETIMEDOUT beobachtet). macOS/Linux: 'python3' (kein 'python' seit macOS 12.3).
  const candidates = process.platform === 'win32'
    ? ['py', 'python', 'python3']
    : ['python3', 'python'];
  for (const cmd of candidates) {
    try {
      const r = spawnSync(cmd, ['-m', 'markitdown', '--help'], { windowsHide: true, timeout: 8000 });
      if (r.status === 0) { _pyCmd = cmd; return _pyCmd; }
    } catch { /* naechster Kandidat */ }
  }
  return null;
}

// ── Markitdown Konvertierung ──────────────────────────────────────────────────
app.post('/api/convert/markitdown', (req, res) => {
  const { filePath, vault: vaultName } = req.body;
  if (!filePath) return res.status(400).json({ error: 'filePath fehlt' });

  let vaultObj;
  try { vaultObj = getVault(vaultName).vault; } catch (e) { return res.status(404).json({ error: e.message }); }

  // R27a: safeFull statt join – vorher liess sich per ../ jede Datei des Rechners
  // an markitdown verfuettern und das Ergebnis daneben ablegen.
  const fullPath = safeFull(vaultObj.path, filePath);
  if (!fullPath || fullPath === resolve(vaultObj.path)) return res.status(400).json({ error: 'Pfad ausserhalb des Vaults' });
  if (!existsSync(fullPath)) return res.status(404).json({ error: 'Datei nicht gefunden' });

  const outPath = fullPath.replace(/\.[^.]+$/, '.md');
  const py = resolvePythonCmd();
  if (!py) return res.status(500).json({ error: 'markitdown nicht verfuegbar – bitte "pip install markitdown" (Python 3) ausfuehren.' });
  // KEIN shell:true -> Node quotet die Argumente selbst, sodass Vault-Pfade mit
  // Leerzeichen (z. B. "5. Semester") korrekt als EIN Argument ankommen. Mit
  // shell:true zerteilt cmd.exe den Pfad am Leerzeichen -> markitdown bekommt
  // den Rest als "unrecognized arguments" (Exit-Code 2).
  const proc = spawn(py, ['-m', 'markitdown', fullPath, '-o', outPath], { windowsHide: true });

  let stderr = '', replied = false;
  const reply = (status, body) => { if (replied) return; replied = true; clearTimeout(timer); res.status(status).json(body); };
  // 25-s-Deckel wie /api/preview/office: ein haengender Konverter blockiert sonst
  // die Anfrage endlos (und die UI zeigt ewig den Spinner).
  const timer = setTimeout(() => { try { proc.kill(); } catch {} reply(504, { error: 'Zeitueberschreitung bei der Konvertierung' }); }, 25_000);
  proc.stderr.on('data', d => stderr += d.toString());
  proc.on('error', e => reply(500, { error: `markitdown nicht gestartet: ${e.message}` }));
  proc.on('close', code => {
    if (replied) return;
    if (code !== 0) return reply(500, { error: `markitdown Fehler (code ${code}): ${stderr}` });
    const relOut = relative(vaultObj.path, outPath).replace(/\\/g, '/');
    // Index neue .md-Datei
    try { getVault(vaultName).indexer.indexFile(outPath); } catch {}
    reply(200, { ok: true, mdPath: relOut });
  });
});

// ── Datei speichern (Editor) ──────────────────────────────────────────────────
app.post('/api/save', (req, res) => {
  try {
    const { vault: vaultName, path: relPath, content, create } = req.body || {};
    if (typeof relPath !== 'string' || !relPath.length) return res.status(400).json({ error: 'path fehlt' });
    if (typeof content !== 'string') return res.status(400).json({ error: 'content fehlt' });
    const { vault, tools } = getVault(vaultName);
    const full = safeFull(vault.path, relPath);
    if (!full || full === resolve(vault.path)) return res.status(400).json({ error: 'Pfad ausserhalb des Vaults' });
    const existed = existsSync(full);
    if (!existed && !create) return res.status(404).json({ error: 'Datei existiert nicht (create=false)' });
    // R27a: derselbe gehaertete Schreibpfad wie das MCP-Tool write_note – atomar
    // (tmp + rename) mit vollem Read-Back statt nacktem writeFileSync. writeNote prueft
    // die Existenz ueber den Index; fuer Nicht-Markdown (.txt/.json) gilt die Datei
    // auf Platte als Existenzbeweis, deshalb create: existed || create.
    const r = tools.writeNote({ path: relPath.replace(/\\/g, '/'), content, create: existed || !!create });
    if (r.error) return res.status(500).json({ error: r.error });
    res.json({ ok: true, path: relPath.replace(/\\/g, '/'), created: !existed, bytes: r.bytes });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Ordner/Datei-Operationen ──────────────────────────────────────────────────
// R27a: nur noch Duennschicht ueber tools.createFolder/move/delete – Pfadpruefung,
// Sidecar-Mitnahme und Reindex leben an EINER Stelle (tools.js). Die HTTP-Codes
// bleiben wie vorher: 400 ungueltig, 404 nicht gefunden, 409 existiert bereits.
function toolStatus(err) {
  if (/nicht gefunden/i.test(err)) return 404;
  if (/existiert bereits/i.test(err)) return 409;
  return 400;
}

app.post('/api/mkdir', (req, res) => {
  try {
    const { vault: vaultName, path: relPath } = req.body || {};
    if (typeof relPath !== 'string' || !relPath.trim()) return res.status(400).json({ error: 'path fehlt' });
    const { tools } = getVault(vaultName);
    const r = tools.createFolder({ path: relPath });
    if (r.error) return res.status(toolStatus(r.error)).json({ error: r.error });
    res.json({ ok: true, path: relPath.replace(/\\/g, '/') });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/rename', (req, res) => {
  try {
    const { vault: vaultName, oldPath, newPath } = req.body || {};
    if (typeof oldPath !== 'string' || typeof newPath !== 'string' || !oldPath || !newPath)
      return res.status(400).json({ error: 'oldPath/newPath fehlt' });
    const { tools } = getVault(vaultName);
    const r = tools.move({ from: oldPath, to: newPath });
    if (r.error) return res.status(toolStatus(r.error)).json({ error: r.error });
    res.json({ ok: true, oldPath: oldPath.replace(/\\/g, '/'), newPath: newPath.replace(/\\/g, '/'), indexed: r.indexed });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/delete', (req, res) => {
  try {
    const { vault: vaultName, path: relPath } = req.body || {};
    if (typeof relPath !== 'string' || !relPath) return res.status(400).json({ error: 'path fehlt' });
    const { tools } = getVault(vaultName);
    const r = tools.delete({ path: relPath });
    if (r.error) return res.status(toolStatus(r.error)).json({ error: r.error });
    res.json({ ok: true, path: relPath.replace(/\\/g, '/'), indexed: r.indexed });
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
    const ext = extname(full).toLowerCase();
    res.type(mimeForExt(ext));
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(basename(full))}"`);
    // R27a: Vault-HTML/SVG darf nie auf der App-Origin laufen. Die Vorschau in
    // index.html laedt HTML per fetch() in ein sandboxed <iframe srcdoc> (eigene,
    // opake Origin) – dort greift dieser Header nicht. Er sichert den ANDEREN Weg:
    // wird die Datei direkt als Dokument geoeffnet (Link, <iframe src>, <object>),
    // sperrt CSP `sandbox` Skripte, localStorage und Cookies der App-Origin.
    // PDF/Bilder unveraendert (PDF.js und <img> brauchen keine Sandbox).
    if (ext === '.html' || ext === '.htm' || ext === '.svg') res.setHeader('Content-Security-Policy', 'sandbox');
    res.sendFile(full, err => { if (err && !res.headersSent) res.status(err.statusCode || 500).end(); });
  } catch (e) { if (!res.headersSent) res.status(500).send(e.message); }
});

// ── Datei im Standardprogramm oeffnen (Word/Excel/...) ─────────────────────────
// Wird vom Office-/Binaer-Viewer im Frontend aufgerufen. Reine OS-Befehle –
// bis R25 gab es hier zusaetzlich einen Versuch ueber Electrons shell.openPath,
// der mit dem Electron-Rueckbau entfiel (lief unter Tauri ohnehin nie).
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
    openInDefaultApp(full);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Externe URL im Standard-Browser oeffnen (Phase 1: REST statt Electron-IPC) ─
// Seit R25 auch http:// erlaubt (vorher nur https, analog zur alten IPC-Guard):
// unter der Tauri-Shell laufen ALLE externen Links ueber diese Route
// laufen ALLE externen Links ueber diese Route (WebView2 unterdrueckt
// target=_blank ohne new-window-Handler), und der Markdown-Renderer verlinkt
// http wie https. Andere Schemes (file:, javascript: ...) bleiben verboten.
app.post('/api/open-external-url', async (req, res) => {
  try {
    const url = req.body?.url;
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return res.status(400).json({ error: 'Nur http(s):// URLs erlaubt' });
    openInDefaultApp(url);
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
  const py = resolvePythonCmd();
  if (!py) return finish(500, { error: 'markitdown nicht verfuegbar – bitte "pip install markitdown" (Python 3) ausfuehren.' });
  // KEIN shell:true -> Node quotet die Argumente selbst, sodass Vault-Pfade mit
  // Leerzeichen (z. B. "Nexus Vaults") korrekt ankommen. Interpreter via
  // resolvePythonCmd() (macOS hat nur 'python3', nicht 'python') – R16.
  const proc = spawn(py, ['-m', 'markitdown', full, '-o', tmpOut], { windowsHide: true });
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
// R27a: Der Session-Key wandert NICHT mehr als URL-Query durch Logs/History und
// liegt nicht mehr im localStorage der UI (dort konnte jede eingebettete HTML-
// Datei ihn lesen). Die UI schickt ihn einmal per POST /api/claude-auth, der
// Server verwahrt ihn in <DATA_DIR>/.nexus/claude-auth.json (nur Besitzer lesbar)
// und benutzt ihn serverseitig. GET liefert nur "konfiguriert ja/nein" + Org-ID.
const CLAUDE_AUTH_FILE = dataPath('.nexus', 'claude-auth.json');
function readClaudeAuth() {
  try {
    const a = JSON.parse(readFileSync(CLAUDE_AUTH_FILE, 'utf8'));
    return (a && typeof a.sessionKey === 'string' && a.sessionKey) ? a : null;
  } catch { return null; }
}
function writeClaudeAuth(a) {
  mkdirSync(dataPath('.nexus'), { recursive: true });
  const tmp = CLAUDE_AUTH_FILE + '.nexustmp';
  writeFileSync(tmp, JSON.stringify(a, null, 2), { encoding: 'utf8', mode: 0o600 });
  renameSync(tmp, CLAUDE_AUTH_FILE);
  try { chmodSync(CLAUDE_AUTH_FILE, 0o600); } catch {}
}
const CLAUDE_HEADERS = (sessionKey) => ({
  'Cookie': `sessionKey=${sessionKey}`,
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json',
  'Referer': 'https://claude.ai/',
});

app.get('/api/claude-auth', (_req, res) => {
  const a = readClaudeAuth();
  res.json({ configured: !!a, orgId: a?.orgId ?? null });
});
app.post('/api/claude-auth', (req, res) => {
  try {
    const { sessionKey, orgId } = req.body || {};
    const prev = readClaudeAuth();
    // Leerer Key + vorhandener Eintrag: nur die Org-ID aktualisieren.
    const key = (typeof sessionKey === 'string' && sessionKey.trim()) ? sessionKey.trim() : prev?.sessionKey;
    if (!key) return res.status(400).json({ error: 'sessionKey fehlt' });
    const org = (typeof orgId === 'string' && orgId.trim()) ? orgId.trim() : (prev?.orgId ?? null);
    if (!org) return res.status(400).json({ error: 'orgId fehlt' });
    writeClaudeAuth({ sessionKey: key, orgId: org, updated: new Date().toISOString() });
    res.json({ ok: true, configured: true, orgId: org });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.delete('/api/claude-auth', (_req, res) => {
  try { if (existsSync(CLAUDE_AUTH_FILE)) unlinkSync(CLAUDE_AUTH_FILE); res.json({ ok: true, configured: false }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/claude-usage', async (_req, res) => {
  const a = readClaudeAuth();
  if (!a || !a.orgId) return res.status(400).json({ error: 'Claude-Zugang nicht konfiguriert (Session-Key + Org-ID im Usage-Widget eintragen)' });
  try {
    const resp = await fetch(
      `https://claude.ai/api/organizations/${encodeURIComponent(a.orgId)}/usage`,
      { headers: CLAUDE_HEADERS(a.sessionKey) }
    );
    if (!resp.ok) return res.status(resp.status).json({ error: `HTTP ${resp.status}` });
    res.json(await resp.json());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Org-Liste zur Auto-Erkennung. Der Key kommt im POST-Body (frisch eingetippt,
// noch nicht gespeichert) oder – ohne Body – aus der Server-Ablage.
app.post('/api/claude-orgs', async (req, res) => {
  const sessionKey = (typeof req.body?.sessionKey === 'string' && req.body.sessionKey.trim()) || readClaudeAuth()?.sessionKey;
  if (!sessionKey) return res.status(400).json({ error: 'sessionKey fehlt' });
  try {
    const resp = await fetch('https://claude.ai/api/organizations', { headers: CLAUDE_HEADERS(sessionKey) });
    if (!resp.ok) return res.status(resp.status).json({ error: `HTTP ${resp.status}` });
    const data = await resp.json();
    if (Array.isArray(data)) {
      const chat = data.filter(o => Array.isArray(o.capabilities) && o.capabilities.includes('chat'));
      return res.json(chat.map(o => ({ id: o.uuid || o.id, name: o.name, isTeam: o.raven_type === 'team' })));
    }
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Live-Updates: Tree-Abgleich -> Server-Sent Events ─────────────────────────
// Damit neue/geloeschte/umbenannte Dateien und Ordner (aus dem Explorer, von Claude
// via MCP oder einem anderen Editor) in der App von selbst erscheinen, ohne Neuladen
// (Strg+R). Statt eines event-basierten Datei-Watchers (chokidar verschluckt unter
// Windows-Polling Datei-"unlink"-Events unzuverlaessig) wird hier alle paar Sekunden
// eine billige Baum-Signatur berechnet und nur bei echter Aenderung ein "tree-changed"
// an alle offenen UI-Tabs gepusht (die dann refreshTree() ausfuehren). Verlaesslich,
// weil es den IST-Zustand des Dateisystems vergleicht statt auf Events zu vertrauen.
const sseClients = new Set();
app.get('/api/events', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();
  res.write('retry: 3000\n\n');
  sseClients.add(res);
  // Heartbeat haelt die Verbindung durch Idle-Timeouts offen.
  const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch {} }, 25_000);
  req.on('close', () => { clearInterval(ping); sseClients.delete(res); });
});
function broadcastEvent(obj) {
  const payload = `data: ${JSON.stringify(obj)}\n\n`;
  for (const res of sseClients) { try { res.write(payload); } catch {} }
}

// Pro Vault: alle 2 s die Signatur pruefen (nur wenn ueberhaupt ein UI-Tab offen ist,
// sonst gibt es nichts zu aktualisieren -> kein Idle-CPU). Aenderung -> tree-changed.
const _ignoreSet = new Set(cfg.ignore ?? []);
const _treeSig = {};
for (const v of cfg.vaults) {
  if (!indexers[v.name]) continue;
  try { _treeSig[v.name] = treeSigString(v.path, _ignoreSet); } catch { _treeSig[v.name] = { tree: '', lern: '' }; }
}
setInterval(() => {
  if (sseClients.size === 0) return;
  for (const v of cfg.vaults) {
    if (!indexers[v.name]) continue;
    let sig;
    try { sig = treeSigString(v.path, _ignoreSet); } catch { continue; }
    const vorher = _treeSig[v.name] ?? { tree: '', lern: '' };
    _treeSig[v.name] = sig;
    if (sig.tree !== vorher.tree) broadcastEvent({ type: 'tree-changed', vault: v.name });
    // R26: eigenes Event – die Karten-Sidecars sind aus dem Baum ausgeblendet, ein
    // per MCP geschriebenes Kartenset wuerde sonst kein Update ausloesen.
    if (sig.lern !== vorher.lern) broadcastEvent({ type: 'lernen-changed', vault: v.name });
  }
}, 2000).unref?.();

// ── Server starten ────────────────────────────────────────────────────────────
// NEXUS_PORT (von der Tauri-Shell gesetzt: Release 3000, tauri dev 3002) hat Vorrang.
// Standalone (npm run ui) faellt auf cfg.ui.port zurueck.
const port = Number(process.env.NEXUS_PORT) || cfg.ui?.port || 3000;

// R27a: Fehler-Handler ganz am Ende – Body zu gross (express.json, 2 MB) und
// multer-Limits (Dateigroesse/Anzahl) antworten als 413 mit JSON statt als
// HTML-Fehlerseite; alles andere bleibt ein 500 mit Meldung.
app.use((err, _req, res, next) => {
  if (res.headersSent) return next(err);
  if (err && (err.type === 'entity.too.large' || err.code === 'LIMIT_FILE_SIZE' || err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE')) {
    return res.status(413).json({ error: `Anfrage zu gross: ${err.message}` });
  }
  if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Ungueltiges JSON im Request-Body' });
  res.status(err?.status || 500).json({ error: err?.message || 'Interner Fehler' });
});

// R27a: Loopback-Default. Vorher lauschte der Server auf allen Interfaces – jeder im
// selben WLAN (Uni, Zug) konnte lesen, schreiben, loeschen. Nur der Web-Betrieb
// (NEXUS_WEB=1, Container hinter Authelia/Caddy) bindet 0.0.0.0; cfg.ui.host
// ueberschreibt beides bewusst.
const host = cfg.ui?.host ?? (WEB ? '0.0.0.0' : '127.0.0.1');
const startUrl = tokenUrl(`http://127.0.0.1:${port}/`, UI_TOKEN);
const httpServer = app.listen(port, host, () => {
  console.log(`[Nexus UI] lauscht auf ${host}:${port} (${WEB ? 'Web-Betrieb, kein UI-Token' : 'nur lokal, UI-Token aktiv'})`);
  // Token-URL nur ausserhalb der gepackten Shell zeigen (Dev-Konsole, npm run ui):
  // die Shell liest das Token selbst aus <DATA_DIR>/.nexus/ui-token.
  if (process.env.NEXUS_SHELL !== 'tauri') console.log(`[Nexus UI] ${WEB ? `http://127.0.0.1:${port}/` : startUrl}`);
  // autoOpen NUR im echten Standalone-Betrieb (npm run ui) einen Browser starten.
  // Unter der Tauri-Shell (NEXUS_SHELL=tauri) laedt bereits das App-Fenster diese
  // URL -> ein zusaetzlicher Browser-Tab waere ein doppeltes Fenster.
  if (cfg.ui?.autoOpen && process.env.NEXUS_SHELL !== 'tauri') {
    const opener = process.platform === 'win32' ? 'start' : 'open';
    spawn(opener, [startUrl], { shell: true, detached: true, windowsHide: true });
  }
});
// Belegten Port sauber abfangen statt als "JavaScript error"-Dialog hochblubbern zu lassen.
// Greift dank Single-Instance-Lock (Tauri, src-tauri/src/lib.rs) im Normalfall gar nicht.
httpServer.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    console.error(`[Nexus UI] Port ${port} ist belegt - laeuft Nexus bereits? Beende diese Instanz.`);
    process.exit(1);
  }
  throw err;
});
// "localhost" loest je nach Resolver zuerst auf ::1 auf (Windows, neuere Node/Chromium).
// Damit http://localhost:PORT (Fenster-URL der Shell, Lesezeichen) mit dem IPv4-Loopback-
// Bind weiter geht, lauscht derselbe Express-Stack zusaetzlich auf ::1 – rein optional:
// ohne IPv6 (EADDRNOTAVAIL/EAFNOSUPPORT) wird der Versuch still verworfen.
if (host === '127.0.0.1') {
  const v6 = createServer(app);
  v6.on('error', () => { try { v6.close(); } catch {} });
  try { v6.listen(port, '::1'); } catch { /* kein IPv6 */ }
}
