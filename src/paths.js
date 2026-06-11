// src/paths.js - zentrale, schreibbare Pfade fuer Nexus
//
// Problem: gepackt (Electron/asar) ist der App-Ordner READ-ONLY. Config, Index-DB
// und Upload-Temp muessen daher in einen schreibbaren Ordner (userData) wandern.
//
// Loesung: DATA_DIR.
//   - Dev (npm run app / node src/server.js): NEXUS_DATA_DIR ist NICHT gesetzt
//     -> DATA_DIR = App-Root (D:\Nexus). Verhalten exakt wie bisher.
//   - Gepackt: electron/main.js setzt NEXUS_DATA_DIR = app.getPath('userData')
//     -> Config + DB + Temp liegen schreibbar neben den Nutzerdaten.
//
// Statische Assets (public/, src/) werden weiterhin aus dem App-Ordner gelesen
// (read-only ist dort ok) - dafuer ist APP_ROOT.

import { readFileSync } from 'fs';
import { join, dirname, isAbsolute } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));

// App-Ordner (Code, public/) - read-only ok
export const APP_ROOT = join(__dir, '..');

// Schreibbarer Datenordner (Config, .nexus/, Upload-Temp)
export const DATA_DIR = process.env.NEXUS_DATA_DIR || APP_ROOT;

// Pfad zur aktiven Config
export const CONFIG_PATH = join(DATA_DIR, 'nexus.config.json');

// Liest die Config (wirft, wenn nicht vorhanden - Seeding macht electron/main.js)
export function loadConfig() {
  return JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
}

// Beliebiger Pfad relativ zum schreibbaren Datenordner
export function dataPath(...parts) {
  return join(DATA_DIR, ...parts);
}

// Loest den DB-Pfad eines Vaults auf:
//   - absoluter dbPath  -> unveraendert (Pauls Dev-Config: D:\Nexus\.nexus\...)
//   - relativer dbPath  -> relativ zu DATA_DIR
//   - kein dbPath        -> Default DATA_DIR/.nexus/<name>.db
export function resolveDbPath(v) {
  if (v && v.dbPath) {
    return isAbsolute(v.dbPath) ? v.dbPath : join(DATA_DIR, v.dbPath);
  }
  return join(DATA_DIR, '.nexus', ((v && v.name) || 'vault') + '.db');
}
