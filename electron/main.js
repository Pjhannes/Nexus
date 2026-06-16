// electron/main.js - Nexus Hauptprozess
//
// Zwei Betriebsarten in EINER .exe:
//
//   1) GUI-Modus (Standard / Doppelklick):
//        Laedt src/ui-server.js in-process (Express) und oeffnet das Fenster.
//        Beim allerersten Start (keine nexus.config.json) laeuft zuvor der
//        Einrichtungs-Assistent (wizard.html).
//
//   2) MCP-Modus (Start mit Argument "--mcp"):
//        Startet src/server.js (MCP stdio) HEADLESS, ohne Fenster.
//        Claude Desktop ruft genau diese .exe mit "--mcp" auf -> der fremde PC
//        braucht KEIN separat installiertes Node.js. Self-contained.
//
// Schreibbare Pfade (Config, Index-DB, Upload-Temp):
//   - Dev (npm run app): NEXUS_DATA_DIR ungesetzt -> Repo-Ordner (D:\Nexus).
//   - Gepackt: NEXUS_DATA_DIR = userData (schreibbar).

// R10: Erster-Start-Wizard, Hilfe-Fenster, Taskleisten-Identitaet.
import { app, BrowserWindow, Menu, dialog, shell, ipcMain } from 'electron';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { createServer } from 'net';
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, appendFileSync } from 'fs';

const __dir = dirname(fileURLToPath(import.meta.url));
const APP_ROOT   = join(__dir, '..');
const UI_SERVER  = pathToFileURL(join(__dir, '..', 'src', 'ui-server.js')).href;
const MCP_SERVER = pathToFileURL(join(__dir, '..', 'src', 'server.js')).href;
const MAIN_JS    = join(__dir, 'main.js');
const WIZARD_HTML = join(APP_ROOT, 'public', 'wizard.html');
const HELP_HTML   = join(APP_ROOT, 'public', 'help.html');
const ICON_PNG    = join(APP_ROOT, 'build', 'icon.png');
const ICON_ICO    = join(APP_ROOT, 'build', 'icon.ico');
const PORT = 3000;

const IS_MCP = process.argv.includes('--mcp');

// Identitaet: Taskleiste zeigt "Nexus" + Nexus-Logo, userData heisst "Nexus".
app.setName('Nexus');
if (process.platform === 'win32') app.setAppUserModelId('de.hunold.nexus');
app.setAboutPanelOptions({ applicationName: 'Nexus', applicationVersion: app.getVersion(), credits: 'Nexus' });

let mainWindow = null;
let wizardWin  = null;
let helpWin    = null;
let uiStarted  = false;

// --- Logging: niemals sichtbares stdout (MCP nutzt stdout fuer JSON-RPC). --------
// Alles geht nach stderr + optional in eine Logdatei im Datenordner.
function log(...parts) {
  const line = '[Nexus] ' + parts.join(' ');
  try { process.stderr.write(line + '\n'); } catch {}
  try {
    const dir = process.env.NEXUS_DATA_DIR || APP_ROOT;
    appendFileSync(join(dir, 'nexus.log'), new Date().toISOString() + ' ' + line + '\n');
  } catch {}
}

function winIcon() { return existsSync(ICON_ICO) ? ICON_ICO : (existsSync(ICON_PNG) ? ICON_PNG : undefined); }

// --- Schreibbaren Datenordner sicherstellen (kein Seeding hier mehr) -----------
// Seeding der Erst-Config macht jetzt der Wizard (wizard:finish). Dev unveraendert.
function ensureDataDir() {
  if (!app.isPackaged) return APP_ROOT;
  const dataDir = app.getPath('userData');
  mkdirSync(dataDir, { recursive: true });
  process.env.NEXUS_DATA_DIR = dataDir;
  return dataDir;
}

function configPath() {
  return join(process.env.NEXUS_DATA_DIR || APP_ROOT, 'nexus.config.json');
}

// --- GUI: warten bis Port belegt ist (Server bereit) --------------------------
function waitForPort(port, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    function attempt() {
      const sock = createServer();
      sock.once('error', () => resolve()); // Port belegt = Server laeuft
      sock.listen(port, () => {
        sock.close(() => {
          if (Date.now() > deadline) return reject(new Error(`Timeout: Port ${port} nicht bereit`));
          setTimeout(attempt, 100);
        });
      });
    }
    attempt();
  });
}

async function startUIServer() {
  if (uiStarted) return;
  await import(UI_SERVER);
  await waitForPort(PORT);
  uiStarted = true;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    title: 'Nexus',
    icon: winIcon(),
    backgroundColor: '#07090f',
    autoHideMenuBar: false,
    webPreferences: {
      preload: join(__dir, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      plugins: true,   // aktiviert Chromiums eingebauten PDF-Viewer (sonst rendert <iframe src=*.pdf> nicht)
    },
  });
  mainWindow.loadURL(`http://localhost:${PORT}`);
  mainWindow.on('closed', () => { mainWindow = null; });
}

// ── Erster-Start-Assistent ─────────────────────────────────────────────────────
function createWizard() {
  wizardWin = new BrowserWindow({
    width: 620,
    height: 560,
    title: 'Nexus – Einrichtung',
    icon: winIcon(),
    resizable: false,
    backgroundColor: '#07090f',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dir, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  Menu.setApplicationMenu(null); // im Wizard kein Menue
  wizardWin.loadFile(WIZARD_HTML);
  wizardWin.on('closed', () => { wizardWin = null; });
}

function openHelpWindow() {
  if (helpWin && !helpWin.isDestroyed()) { helpWin.focus(); return; }
  helpWin = new BrowserWindow({
    width: 640,
    height: 720,
    title: 'Nexus – Einrichtung & Anbindung',
    icon: winIcon(),
    backgroundColor: '#07090f',
    autoHideMenuBar: true,
    parent: mainWindow || undefined,
    webPreferences: {
      preload: join(__dir, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  helpWin.setMenu(null);
  helpWin.loadFile(HELP_HTML);
  helpWin.on('closed', () => { helpWin = null; });
}

// Schreibt die Erst-Config mit dem gewaehlten Vault-Speicherort.
function seedConfig(vaultsRoot) {
  const root = (vaultsRoot && String(vaultsRoot).trim())
    ? String(vaultsRoot).trim()
    : join(app.getPath('documents'), 'Nexus Vaults');
  const seed = {
    _comment: 'Beim ersten Start ueber den Einrichtungs-Assistenten erzeugt. Keine vorbefuellten Inhalte.',
    vaultsRoot: root,
    activeVault: 'knowledge-base',
    vaults: [
      { name: 'knowledge-base', path: join(root, 'knowledge-base'), dbPath: '.nexus/knowledge-base.db' },
    ],
    ui: { port: PORT, autoOpen: false },
    ignore: ['.obsidian', '.trash', '.nexus', 'node_modules'],
  };
  mkdirSync(seed.vaults[0].path, { recursive: true });
  writeFileSync(configPath(), JSON.stringify(seed, null, 2), 'utf8');
  return root;
}

// ── Claude-Desktop-Anbindung (Kern + Menue-Variante) ───────────────────────────
function claudeConfigPath() {
  if (process.platform === 'win32') {
    return join(process.env.APPDATA || join(app.getPath('home'), 'AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json');
  }
  if (process.platform === 'darwin') {
    return join(app.getPath('home'), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  }
  return join(app.getPath('home'), '.config', 'Claude', 'claude_desktop_config.json');
}

function mcpLaunchSpec() {
  if (app.isPackaged) return { command: process.execPath, args: ['--mcp'] };
  return { command: process.execPath, args: [MAIN_JS, '--mcp'] };
}

// Schreibt/merged den nexus-Eintrag. Gibt ein Ergebnisobjekt zurueck (kein Dialog).
function connectClaudeCore() {
  const cfgPath = claudeConfigPath();
  mkdirSync(dirname(cfgPath), { recursive: true });
  let cfg = {};
  let backedUp = false;
  if (existsSync(cfgPath)) {
    copyFileSync(cfgPath, cfgPath + '.nexus-backup');
    backedUp = true;
    try { cfg = JSON.parse(readFileSync(cfgPath, 'utf8')); } catch { cfg = {}; }
  }
  if (!cfg.mcpServers || typeof cfg.mcpServers !== 'object') cfg.mcpServers = {};
  const spec = mcpLaunchSpec();
  cfg.mcpServers.nexus = { command: spec.command, args: spec.args };
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), 'utf8');
  return { ok: true, path: cfgPath, backedUp };
}

function connectClaudeDesktop() {
  try {
    const r = connectClaudeCore();
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Mit Claude Desktop verbunden',
      message: 'Nexus wurde als MCP-Server eingetragen.',
      detail:
        `Konfiguration: ${r.path}\n` +
        (r.backedUp ? 'Backup der alten Datei: claude_desktop_config.json.nexus-backup\n' : '') +
        '\nClaude Desktop bitte komplett neu starten (beenden + oeffnen), damit der Server geladen wird.',
      buttons: ['OK'],
    });
  } catch (err) {
    dialog.showMessageBox(mainWindow, {
      type: 'error', title: 'Verbindung fehlgeschlagen',
      message: 'Konnte die Claude-Desktop-Config nicht schreiben.',
      detail: String(err && err.message ? err.message : err), buttons: ['OK'],
    });
  }
}

function openVaultFolder() {
  try {
    const dataDir = process.env.NEXUS_DATA_DIR || APP_ROOT;
    const cfg = JSON.parse(readFileSync(join(dataDir, 'nexus.config.json'), 'utf8'));
    const active = cfg.vaults.find(v => v.name === cfg.activeVault) || cfg.vaults[0];
    const target = active ? active.path : (cfg.vaultsRoot || dataDir);
    shell.openPath(target);
  } catch (err) {
    dialog.showMessageBox(mainWindow, { type: 'error', message: 'Vault-Ordner nicht gefunden', detail: String(err), buttons: ['OK'] });
  }
}

function buildMenu() {
  const template = [
    {
      label: 'Nexus',
      submenu: [
        { label: 'Mit Claude Desktop verbinden', click: connectClaudeDesktop },
        { label: 'Vault-Ordner oeffnen', click: openVaultFolder },
        { type: 'separator' },
        { role: 'quit', label: 'Beenden' },
      ],
    },
    {
      label: 'Ansicht',
      submenu: [
        { role: 'reload', label: 'Neu laden' },
        { role: 'forceReload', label: 'Hart neu laden' },
        { role: 'toggleDevTools', label: 'Entwicklerwerkzeuge' },
        { type: 'separator' },
        { role: 'resetZoom', label: 'Zoom zuruecksetzen' },
        { role: 'zoomIn', label: 'Vergroessern' },
        { role: 'zoomOut', label: 'Verkleinern' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Vollbild' },
      ],
    },
    {
      label: 'Hilfe',
      submenu: [
        { label: 'Einrichtung & Usage-Key…', click: openHelpWindow },
        { label: 'Mit Claude Desktop verbinden', click: connectClaudeDesktop },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ── IPC (Wizard / Hilfe) ───────────────────────────────────────────────────────
function registerIpc() {
  ipcMain.handle('wizard:default-vault-path', () => join(app.getPath('documents'), 'Nexus Vaults'));

  ipcMain.handle('wizard:browse', async () => {
    const r = await dialog.showOpenDialog(wizardWin, {
      title: 'Vault-Speicherort waehlen',
      properties: ['openDirectory', 'createDirectory'],
    });
    return (r.canceled || !r.filePaths.length) ? null : r.filePaths[0];
  });

  ipcMain.handle('wizard:cancel', () => { app.quit(); });

  ipcMain.handle('wizard:finish', async (_e, opts = {}) => {
    try {
      const preview = existsSync(configPath()); // Re-Run ohne echte Erst-Config -> nichts ueberschreiben
      if (!preview) seedConfig(opts.vaultsRoot);
      try { app.setLoginItemSettings({ openAtLogin: !!opts.autostart }); } catch (e) { log('autostart fehlgeschlagen:', e.message); }

      const launch = opts.launchNow !== false;
      const guide  = !!opts.showGuide;
      const w = wizardWin;

      if (launch) { await startUIServer(); buildMenu(); createWindow(); }
      if (guide)  openHelpWindow();
      if (w && !w.isDestroyed()) w.close();
      if (!launch && !guide) app.quit();
      return { ok: true };
    } catch (e) {
      log('wizard:finish Fehler:', e.message);
      return { error: String(e && e.message ? e.message : e) };
    }
  });

  ipcMain.handle('help:connect-claude', () => {
    try { return connectClaudeCore(); }
    catch (e) { return { error: String(e && e.message ? e.message : e) }; }
  });

  ipcMain.handle('app:open-external', (_e, url) => {
    if (typeof url === 'string' && /^https:\/\//i.test(url)) shell.openExternal(url);
  });

  ipcMain.handle('app:version', () => app.getVersion());
}

// --- Start --------------------------------------------------------------------
app.whenReady().then(async () => {
  ensureDataDir();

  if (IS_MCP) {
    // Headless MCP-Modus: kein Fenster, nur stdio. server.js verbindet das
    // StdioServerTransport am Modulende; der Prozess bleibt fuer Claude Desktop aktiv.
    try {
      await import(MCP_SERVER);
    } catch (err) {
      log('MCP-Server-Start fehlgeschlagen:', err && err.message);
      app.quit();
    }
    return;
  }

  registerIpc();

  const firstRun = !existsSync(configPath()) || process.env.NEXUS_FORCE_WIZARD === '1';

  try {
    if (firstRun) {
      createWizard();           // UI-Server + Hauptfenster startet der Wizard nach Abschluss
    } else {
      await startUIServer();
      buildMenu();
      createWindow();
    }
  } catch (err) {
    log('Start fehlgeschlagen:', err && err.message);
    app.quit();
  }

  app.on('activate', () => {
    if (!IS_MCP && BrowserWindow.getAllWindows().length === 0) {
      if (uiStarted) createWindow(); else createWizard();
    }
  });
});

app.on('window-all-closed', () => {
  // Im MCP-Modus existiert nie ein Fenster -> dieser Hook feuert dort nicht.
  if (!IS_MCP && process.platform !== 'darwin') app.quit();
});
