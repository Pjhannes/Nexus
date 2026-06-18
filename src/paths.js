// src/paths.js - zentrale, schreibbare Pfade fuer Nexus
//
// Problem: gepackt (Electron/asar) ist der App-Ordner READ-ONLY. Config, Index-DB
// und Upload-Temp muessen daher in einen schreibbaren Ordner (userData) wandern.
//
// Loesung: DATA_DIR.
//   - Dev (npm run app / node src/server.js): NEXUS_DATA_DIR ist NICHT gesetzt
//     -> DATA_DIR = App-Root (Quell-Repo). Verhalten exakt wie bisher.
//   - Gepackt: electron/main.js setzt NEXUS_DATA_DIR = app.getPath('userData')
//     -> Config + DB + Temp liegen schreibbar neben den Nutzerdaten.
//
// Statische Assets (public/, src/) werden weiterhin aus dem App-Ordner gelesen
// (read-only ist dort ok) - dafuer ist APP_ROOT.

import { readFileSync, existsSync } from 'fs';
import { join, dirname, isAbsolute } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';

const __dir = dirname(fileURLToPath(import.meta.url));

// App-Ordner (Code, public/) - read-only ok
export const APP_ROOT = join(__dir, '..');

// Plattform-Standard "userData"-Ordner (entspricht Electrons app.getPath('userData')
// fuer productName "Nexus"). Unabhaengig nachgebaut, weil der headless MCP-Prozess
// (ELECTRON_RUN_AS_NODE -> kein app-Objekt) ihn sonst nicht kennt.
function defaultUserDataDir() {
  const home = homedir();
  if (process.platform === 'darwin') return join(home, 'Library', 'Application Support', 'Nexus');
  if (process.platform === 'win32')  return join(process.env.APPDATA || join(home, 'AppData', 'Roaming'), 'Nexus');
  return join(process.env.XDG_CONFIG_HOME || join(home, '.config'), 'Nexus');
}

// Schreibbarer Datenordner (Config, .nexus/, Upload-Temp):
//   - Dev (NEXUS_DATA_DIR ungesetzt): App-Root, exakt wie bisher.
//   - Gepackt: electron/main.js setzt NEXUS_DATA_DIR = app.getPath('userData').
// Selbstheilung: Ist NEXUS_DATA_DIR gesetzt, enthaelt aber KEINE nexus.config.json
// (typisch: in der claude_desktop_config.json von Hand falsch eingetragen, z. B.
// "Applications Support" statt "Application Support"), liegt aber am Standard-
// userData-Ort eine Config -> diese nutzen statt hart abzustuerzen.
function resolveDataDir() {
  const envDir = process.env.NEXUS_DATA_DIR;
  if (!envDir) return APP_ROOT;
  if (existsSync(join(envDir, 'nexus.config.json'))) return envDir;
  const fallback = defaultUserDataDir();
  if (fallback !== envDir && existsSync(join(fallback, 'nexus.config.json'))) {
    try { process.stderr.write(`[Nexus] NEXUS_DATA_DIR=${envDir} ohne nexus.config.json -> nutze ${fallback}\n`); } catch {}
    return fallback;
  }
  return envDir;
}

// Schreibbarer Datenordner (Config, .nexus/, Upload-Temp)
export const DATA_DIR = resolveDataDir();

// Pfad zur aktiven Config
export const CONFIG_PATH = join(DATA_DIR, 'nexus.config.json');

// Liest die Config. Klarer, handlungsweisender Fehler statt rohem ENOENT, falls sie
// fehlt (Seeding macht electron/main.js bzw. der Einrichtungs-Assistent).
export function loadConfig() {
  if (!existsSync(CONFIG_PATH)) {
    throw new Error(
      `nexus.config.json nicht gefunden unter ${CONFIG_PATH}. ` +
      `Bitte die Nexus-App einmal starten (legt die Config an) und dort unter ` +
      `Einstellungen -> System "Mit Claude Desktop verbinden" klicken.`
    );
  }
  return JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
}

// Beliebiger Pfad relativ zum schreibbaren Datenordner
export function dataPath(...parts) {
  return join(DATA_DIR, ...parts);
}

// Loest den DB-Pfad eines Vaults auf:
//   - absoluter dbPath  -> unveraendert (z. B. Dev-Config mit absolutem .nexus-Pfad)
//   - relativer dbPath  -> relativ zu DATA_DIR
//   - kein dbPath        -> Default DATA_DIR/.nexus/<name>.db
export function resolveDbPath(v) {
  if (v && v.dbPath) {
    return isAbsolute(v.dbPath) ? v.dbPath : join(DATA_DIR, v.dbPath);
  }
  return join(DATA_DIR, '.nexus', ((v && v.name) || 'vault') + '.db');
}
