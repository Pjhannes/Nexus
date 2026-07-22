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

// Phase 3: Migriert einen BESTEHENDEN Eintrag auf die aktuelle Launch-Spec, wenn er
// strukturell veraltet ist – vor allem der alte Electron-Trick (ELECTRON_RUN_AS_NODE
// auf der Nexus.exe), den die Tauri-Shell nicht mehr braucht, oder ein command-Pfad
// einer frueheren Installation. Legt NIE einen neuen Eintrag an (wer Claude nie
// verbunden hat, bleibt unverbunden) und schreibt NUR bei echter Abweichung
// (idempotent -> kein Backup-Churn bei jedem App-Start).
export function migrateClaudeEntryIfStale({ launchSpec, mcpKey }) {
  const cfgPath = claudeConfigPath();
  if (!existsSync(cfgPath)) return { migrated: false, reason: 'keine Claude-Config' };
  let cfg;
  try { cfg = JSON.parse(readFileSync(cfgPath, 'utf8')); } catch { return { migrated: false, reason: 'Claude-Config unlesbar' }; }
  const entry = cfg?.mcpServers?.[mcpKey];
  if (!entry) return { migrated: false, reason: 'kein Eintrag' };
  const norm = (v) => v ?? null;
  const stale =
    (entry.env?.ELECTRON_RUN_AS_NODE && !launchSpec.env?.ELECTRON_RUN_AS_NODE) ||
    entry.command !== launchSpec.command ||
    JSON.stringify(entry.args ?? []) !== JSON.stringify(launchSpec.args ?? []) ||
    norm(entry.env?.NEXUS_DATA_DIR) !== norm(launchSpec.env?.NEXUS_DATA_DIR);
  if (!stale) return { migrated: false, reason: 'aktuell' };
  return { ...connectClaude({ launchSpec, mcpKey }), migrated: true };
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
