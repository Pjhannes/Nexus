// src/claude-connect.js – schreibt/merged den Nexus-Eintrag in claude_desktop_config.json.
//
// Bewusst OHNE Electron-Imports (reines Node/ESM): laeuft sowohl aus dem Electron-
// Hauptprozess (Menue-Aktion) als auch aus dem UI-Server (REST-Endpoint, egal ob
// in-process unter Electron oder spaeter als eigenstaendiger Tauri-Sidecar-Prozess).
// Der Aufrufer bestimmt die Launch-Spec (heute: ELECTRON_RUN_AS_NODE-Trick,
// spaeter: Node-Sidecar-Binary) – dieses Modul kennt nur das generische
// Lesen/Sichern/Mergen/Schreiben der Config-Datei.
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';

export function claudeConfigPath() {
  if (process.platform === 'win32') {
    return join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json');
  }
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  }
  return join(homedir(), '.config', 'Claude', 'claude_desktop_config.json');
}

// launchSpec = { command, args, env } – vom Aufrufer gebaut (main.js: ELECTRON_RUN_AS_NODE;
// spaeter Tauri: Node-Sidecar-Pfad ohne diesen Trick). mcpKey = 'nexus' oder 'nexus-dev'.
export function connectClaude({ launchSpec, mcpKey }) {
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
  cfg.mcpServers[mcpKey] = { command: launchSpec.command, args: launchSpec.args, env: launchSpec.env };
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), 'utf8');
  return { ok: true, path: cfgPath, backedUp, key: mcpKey };
}
