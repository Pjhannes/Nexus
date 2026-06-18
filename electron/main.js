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
//   - Dev (npm run app): NEXUS_DATA_DIR ungesetzt -> App-Ordner (Quell-Repo).
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
const MCP_SERVER_PATH = join(__dir, '..', 'src', 'server.js'); // Plain-Pfad fuer ELECTRON_RUN_AS_NODE
const WIZARD_HTML = join(APP_ROOT, 'public', 'wizard.html');
const HELP_HTML   = join(APP_ROOT, 'public', 'help.html');
const ICON_PNG    = join(APP_ROOT, 'build', 'icon.png');
const ICON_ICO    = join(APP_ROOT, 'build', 'icon.ico');
const ICON_PNG_DEV = join(APP_ROOT, 'build', 'icon-dev.png');
const ICON_ICO_DEV = join(APP_ROOT, 'build', 'icon-dev.ico');
// NEXUS_DEV=1 (nur vom Dev-Starter Nexus-Dev.vbs gesetzt) => eigene Identitaet neben der
// gehaerteten Installation: Name "Nexus Dev", appId ...-dev, Port 3001, Claude-Key "nexus-dev".
// Die Installation setzt NEXUS_DEV NIE -> bleibt unveraendert "Nexus" auf Port 3000.
const DEV      = process.env.NEXUS_DEV === '1';
const APP_NAME = DEV ? 'Nexus Dev' : 'Nexus';
const APP_ID   = DEV ? 'com.nexusapp.nexus-dev' : 'com.nexusapp.nexus';
const PORT     = DEV ? 3001 : 3000;
// ui-server.js wird in-process geladen und nimmt denselben Port aus NEXUS_PORT -> kein Mismatch.
process.env.NEXUS_PORT = String(PORT);

const IS_MCP = process.argv.includes('--mcp');

// Identitaet: Taskleiste/Fenster zeigen APP_NAME + Nexus-Logo.
app.setName(APP_NAME);
if (process.platform === 'win32') app.setAppUserModelId(APP_ID);
app.setAboutPanelOptions({ applicationName: APP_NAME, applicationVersion: app.getVersion(), credits: APP_NAME });

let mainWindow = null;
let wizardWin  = null;
let helpWin    = null;
let uiStarted  = false;

// Single-Instance-Lock: eine zweite Instanz DERSELBEN Identitaet (Prod ODER Dev) verhindern,
// sonst stuerzt der zweite Start beim Port-Binden mit EADDRINUSE ab. Dev ("Nexus Dev") und
// Prod ("Nexus") haben getrennte Identitaeten -> je eigener Lock, laufen weiterhin parallel.
// Im MCP-Modus nicht noetig (kein Fenster/Port).
const gotSingleLock = IS_MCP || app.requestSingleInstanceLock();
if (!gotSingleLock) app.quit();
app.on('second-instance', () => {
  // Erneuter Start derselben App -> vorhandenes Fenster nach vorne holen statt zweiter Instanz.
  const win = mainWindow || wizardWin || helpWin;
  if (win && !win.isDestroyed()) { if (win.isMinimized()) win.restore(); win.focus(); }
});

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

function winIcon() {
  // Dev-Variante bevorzugen (optisch abgesetzt), mit Fallback aufs normale Icon.
  if (DEV) {
    if (existsSync(ICON_ICO_DEV)) return ICON_ICO_DEV;
    if (existsSync(ICON_PNG_DEV)) return ICON_PNG_DEV;
  }
  return existsSync(ICON_ICO) ? ICON_ICO : (existsSync(ICON_PNG) ? ICON_PNG : undefined);
}

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
    title: APP_NAME,
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
    title: APP_NAME + ' – Einrichtung',
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
    title: APP_NAME + ' – Einrichtung & Anbindung',
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
  // Ueber den UI-Server laden (gleiche Origin wie das Hauptfenster) -> help.html teilt den localStorage
  // und uebernimmt das aktive Layout/Theme/Akzent. Faellt auf die lokale Datei zurueck, falls der
  // Server (noch) nicht laeuft (dann ungethemt im Default-Look, aber funktionsfaehig).
  if (uiStarted) helpWin.loadURL(`http://localhost:${PORT}/help.html`);
  else helpWin.loadFile(HELP_HTML);
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

// Startet den MCP-Server als REINEN Node-Prozess via ELECTRON_RUN_AS_NODE.
// Hintergrund: ein gepacktes GUI-Electron hat auf Windows keine brauchbaren
// stdin/stdout-Pipes im Hauptprozess -> stdio-JSON-RPC schlaegt fehl
// ("Unexpected end of JSON input"). Als Node startet kein Chromium (kein GPU-/
// Netzwerk-Subprozess), und stdio funktioniert sauber. Erfordert den RunAsNode-Fuse
// (siehe scripts/afterPack.cjs).
function mcpLaunchSpec() {
  const env = { ELECTRON_RUN_AS_NODE: '1' };
  // Gepackt: der Node-Prozess hat kein app.getPath('userData') -> Datenordner mitgeben,
  // damit server.js die Config/DB im schreibbaren userData findet.
  if (app.isPackaged) env.NEXUS_DATA_DIR = app.getPath('userData');
  return { command: process.execPath, args: [MCP_SERVER_PATH], env };
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
  // Dev traegt sich als eigener Key "nexus-dev" ein -> ueberschreibt NICHT den Prod-Eintrag "nexus".
  const mcpKey = DEV ? 'nexus-dev' : 'nexus';
  cfg.mcpServers[mcpKey] = { command: spec.command, args: spec.args, env: spec.env };
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), 'utf8');
  return { ok: true, path: cfgPath, backedUp, key: mcpKey };
}

function connectClaudeDesktop() {
  try {
    const r = connectClaudeCore();
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Mit Claude Desktop verbunden',
      message: `${APP_NAME} wurde als MCP-Server eingetragen.`,
      detail:
        `Eintrag: ${r.key}\nKonfiguration: ${r.path}\n` +
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
  const isMac = process.platform === 'darwin';
  // Die Nexus-Aktionen, die auf JEDER Plattform dauerhaft erreichbar sein muessen.
  const nexusActions = [
    { label: 'Mit Claude Desktop verbinden', click: connectClaudeDesktop },
    { label: 'Einrichtung & Usage-Key…', click: openHelpWindow },
    { label: 'Vault-Ordner oeffnen', click: openVaultFolder },
  ];

  // Auf macOS ist das ERSTE Menue zwangsweise das App-Menue (fett, App-Name). Die
  // Aktionen gehoeren konventionell dort hinein (zwischen "Ueber" und "Beenden");
  // andernfalls "verschwinden" sie fuer den Nutzer, weil ein zweites "Nexus"-Menue
  // neben dem fetten App-Menue ungewohnt ist. Auf Windows/Linux bleibt das normale
  // "Nexus"-Menue mit eigenem Beenden-Eintrag.
  const appMenu = isMac
    ? {
        label: APP_NAME,
        submenu: [
          { role: 'about', label: 'Ueber ' + APP_NAME },
          { type: 'separator' },
          ...nexusActions,
          { type: 'separator' },
          { role: 'hide', label: APP_NAME + ' ausblenden' },
          { role: 'hideOthers', label: 'Andere ausblenden' },
          { role: 'unhide', label: 'Alle einblenden' },
          { type: 'separator' },
          { role: 'quit', label: 'Beenden' },
        ],
      }
    : {
        label: 'Nexus',
        submenu: [
          ...nexusActions,
          { type: 'separator' },
          { role: 'quit', label: 'Beenden' },
        ],
      };

  const template = [
    appMenu,
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
      role: 'help',
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
      if (guide)  { try { await startUIServer(); } catch (e) { log('Server fuer Hilfe-Fenster:', e.message); } openHelpWindow(); }
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

  // Hilfe-/Einrichtungsfenster aus der App-UI (Einstellungen -> System) oeffnen,
  // damit Usage-Key & Anleitung auch nach dem Wizard erreichbar sind (v. a. macOS).
  ipcMain.handle('help:open', () => {
    try { openHelpWindow(); return { ok: true }; }
    catch (e) { return { error: String(e && e.message ? e.message : e) }; }
  });

  ipcMain.handle('app:open-external', (_e, url) => {
    if (typeof url === 'string' && /^https:\/\//i.test(url)) shell.openExternal(url);
  });

  ipcMain.handle('app:version', () => app.getVersion());
}

// --- Start --------------------------------------------------------------------
if (gotSingleLock) app.whenReady().then(async () => {
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
