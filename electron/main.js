// electron/main.js - Nexus Electron-Hauptprozess
//
// Zwei Betriebsarten in EINER .exe:
//
//   1) GUI-Modus (Standard / Doppelklick):
//        Laedt src/ui-server.js in-process (Express) und oeffnet das Fenster.
//
//   2) MCP-Modus (Start mit Argument "--mcp"):
//        Startet src/server.js (MCP stdio) HEADLESS, ohne Fenster.
//        Claude Desktop ruft genau diese .exe mit "--mcp" auf -> der fremde PC
//        braucht KEIN separat installiertes Node.js. Self-contained.
//
// Prozessmodell (Spike 2026-06-10): in-process, weil Electron 42 Node 24.16
// buendelt -> node:sqlite, express, chokidar laufen unveraendert.
//
// Schreibbare Pfade (Config, Index-DB, Upload-Temp):
//   - Dev (npm run app): app.isPackaged=false -> NEXUS_DATA_DIR ungesetzt ->
//     Module nutzen den Repo-Ordner (D:\Nexus). Verhalten wie bisher.
//   - Gepackt: NEXUS_DATA_DIR = userData (schreibbar). Beim ersten Start wird
//     eine frische Config OHNE Vault-Inhalte erzeugt (Vaults unter Documents).

import { app, BrowserWindow, Menu, dialog, shell } from 'electron';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { createServer } from 'net';
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'fs';

const __dir = dirname(fileURLToPath(import.meta.url));
const UI_SERVER  = pathToFileURL(join(__dir, '..', 'src', 'ui-server.js')).href;
const MCP_SERVER = pathToFileURL(join(__dir, '..', 'src', 'server.js')).href;
const MAIN_JS    = join(__dir, 'main.js');
const PORT = 3000;

const IS_MCP = process.argv.includes('--mcp');

let mainWindow = null;

// --- Schreibbaren Datenordner sicherstellen + Erst-Config seeden --------------
// Nur gepackt aktiv. Dev nutzt unveraendert den Repo-Ordner.
function ensureDataDir() {
  if (!app.isPackaged) return null;

  const dataDir = app.getPath('userData');
  mkdirSync(dataDir, { recursive: true });
  process.env.NEXUS_DATA_DIR = dataDir;

  const cfgPath = join(dataDir, 'nexus.config.json');
  if (!existsSync(cfgPath)) {
    const vaultsRoot = join(app.getPath('documents'), 'Nexus Vaults');
    const seed = {
      _comment: 'Automatisch erstellt beim ersten Start. Vaults liegen unter vaultsRoot (Documents). Keine vorbefuellten Inhalte.',
      vaultsRoot,
      activeVault: 'knowledge-base',
      vaults: [
        {
          name: 'knowledge-base',
          path: join(vaultsRoot, 'knowledge-base'),
          dbPath: '.nexus/knowledge-base.db',
        },
      ],
      ui: { port: PORT, autoOpen: false },
      ignore: ['.obsidian', '.trash', '.nexus', 'node_modules'],
    };
    mkdirSync(seed.vaults[0].path, { recursive: true });
    writeFileSync(cfgPath, JSON.stringify(seed, null, 2), 'utf8');
  }
  return dataDir;
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
  await import(UI_SERVER);
  await waitForPort(PORT);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    title: 'Nexus',
    backgroundColor: '#07090f',
    webPreferences: {
      preload: join(__dir, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadURL(`http://localhost:${PORT}`);
  mainWindow.on('closed', () => { mainWindow = null; });
}

// --- Pfad zur Claude-Desktop-Config je Plattform ------------------------------
function claudeConfigPath() {
  if (process.platform === 'win32') {
    return join(process.env.APPDATA || join(app.getPath('home'), 'AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json');
  }
  if (process.platform === 'darwin') {
    return join(app.getPath('home'), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  }
  return join(app.getPath('home'), '.config', 'Claude', 'claude_desktop_config.json');
}

// Command + Args, mit denen Claude Desktop den MCP-Server startet.
function mcpLaunchSpec() {
  if (app.isPackaged) {
    // Diese .exe selbst, im MCP-Modus. Kein Node noetig.
    return { command: process.execPath, args: ['--mcp'] };
  }
  // Dev: Electron-Binary + main.js + Flag.
  return { command: process.execPath, args: [MAIN_JS, '--mcp'] };
}

// --- Menue-Aktion: Eintrag in claude_desktop_config.json schreiben/mergen -----
function connectClaudeDesktop() {
  try {
    const cfgPath = claudeConfigPath();
    mkdirSync(dirname(cfgPath), { recursive: true });

    let cfg = {};
    if (existsSync(cfgPath)) {
      copyFileSync(cfgPath, cfgPath + '.nexus-backup');
      try { cfg = JSON.parse(readFileSync(cfgPath, 'utf8')); } catch { cfg = {}; }
    }
    if (!cfg.mcpServers || typeof cfg.mcpServers !== 'object') cfg.mcpServers = {};

    const spec = mcpLaunchSpec();
    cfg.mcpServers.nexus = { command: spec.command, args: spec.args };

    writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), 'utf8');

    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Mit Claude Desktop verbunden',
      message: 'Nexus wurde als MCP-Server eingetragen.',
      detail:
        `Konfiguration: ${cfgPath}\n` +
        (existsSync(cfgPath + '.nexus-backup') ? 'Backup der alten Datei: claude_desktop_config.json.nexus-backup\n' : '') +
        '\nClaude Desktop bitte komplett neu starten (beenden + oeffnen), damit der Server geladen wird.',
      buttons: ['OK'],
    });
  } catch (err) {
    dialog.showMessageBox(mainWindow, {
      type: 'error',
      title: 'Verbindung fehlgeschlagen',
      message: 'Konnte die Claude-Desktop-Config nicht schreiben.',
      detail: String(err && err.message ? err.message : err),
      buttons: ['OK'],
    });
  }
}

// --- Menue-Aktion: Vault-Ordner im Explorer oeffnen ---------------------------
function openVaultFolder() {
  try {
    const dataDir = process.env.NEXUS_DATA_DIR || join(__dir, '..');
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
        { role: 'toggleDevTools', label: 'DevTools' },
        { type: 'separator' },
        { role: 'resetZoom', label: 'Zoom zuruecksetzen' },
        { role: 'zoomIn', label: 'Vergroessern' },
        { role: 'zoomOut', label: 'Verkleinern' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Vollbild' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
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
      console.error('[Nexus] MCP-Server-Start fehlgeschlagen:', err);
      app.quit();
    }
    return;
  }

  try {
    await startUIServer();
    buildMenu();
    createWindow();
  } catch (err) {
    console.error('[Nexus] Server-Start fehlgeschlagen:', err);
    app.quit();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  // Im MCP-Modus existiert nie ein Fenster -> dieser Hook feuert dort nicht.
  if (!IS_MCP && process.platform !== 'darwin') app.quit();
});
