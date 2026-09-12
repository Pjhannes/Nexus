// src/paths.js - zentrale, schreibbare Pfade fuer Nexus
//
// Problem: gepackt ist der App-/Sidecar-Ordner faktisch read-only. Config, Index-DB
// und Upload-Temp muessen daher in einen schreibbaren Ordner (userData) wandern.
//
// Loesung: DATA_DIR.
//   - Dev (node src/server.js / npm run ui): NEXUS_DATA_DIR ist NICHT gesetzt
//     -> DATA_DIR = App-Root (Quell-Repo). Verhalten exakt wie bisher.
//   - Gepackt: die Tauri-Shell (src-tauri/src/lib.rs) setzt NEXUS_DATA_DIR auf den
//     userData-Pfad -> Config + DB + Temp liegen schreibbar neben den Nutzerdaten.
//
// Statische Assets (public/, src/) werden weiterhin aus dem App-Ordner gelesen
// (read-only ist dort ok) - dafuer ist APP_ROOT.

import { readFileSync, existsSync, writeFileSync, renameSync, mkdirSync, copyFileSync } from 'fs';
import { join, dirname, isAbsolute, resolve, sep } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';

const __dir = dirname(fileURLToPath(import.meta.url));

// App-Ordner (Code, public/) - read-only ok
export const APP_ROOT = join(__dir, '..');

// Plattform-Standard "userData"-Ordner (historisch der Electron-app.getPath('userData')
// fuer productName "Nexus"; die Tauri-Shell setzt in src-tauri/src/lib.rs exakt
// denselben Pfad -> DATA_DIR-Kontinuitaet). Unabhaengig nachgebaut, weil der headless
// MCP-Prozess (reiner Node-Sidecar) ihn ohne die Shell-Umgebung sonst nicht kennt.
function defaultUserDataDir() {
  const home = homedir();
  if (process.platform === 'darwin') return join(home, 'Library', 'Application Support', 'Nexus');
  if (process.platform === 'win32')  return join(process.env.APPDATA || join(home, 'AppData', 'Roaming'), 'Nexus');
  return join(process.env.XDG_CONFIG_HOME || join(home, '.config'), 'Nexus');
}

// Schreibbarer Datenordner (Config, .nexus/, Upload-Temp):
//   - Dev (NEXUS_DATA_DIR ungesetzt): App-Root, exakt wie bisher.
//   - Gepackt: die Tauri-Shell setzt NEXUS_DATA_DIR = userData-Pfad.
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
// fehlt (Seeding macht die Tauri-Shell bzw. der Einrichtungs-Assistent).
export function loadConfig() {
  if (!existsSync(CONFIG_PATH)) {
    throw new Error(
      `nexus.config.json nicht gefunden unter ${CONFIG_PATH}. ` +
      `Bitte die Nexus-App einmal starten (legt die Config an) und dort unter ` +
      `Einstellungen -> System "Mit Claude Desktop verbinden" klicken.`
    );
  }
  const cfg = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  // R27a: Schema-Version nachziehen (fehlt -> 1). Backup VOR dem ersten Schreiben,
  // danach ist der Aufruf idempotent (kein weiterer Write).
  const { changed } = migrateConfig(cfg);
  if (changed) {
    try {
      backupConfig(CONFIG_PATH);
      writeConfigAtomic(CONFIG_PATH, cfg);
    } catch (e) {
      try { process.stderr.write(`[Nexus] Config-Migration nicht geschrieben: ${e.message}\n`); } catch {}
    }
  }
  return cfg;
}

// ── R27a: Config-Schema + atomares Schreiben ─────────────────────────────────
export const CONFIG_SCHEMA_VERSION = 1;

// Pure Migration: hebt eine Config auf die aktuelle Schema-Version. Gibt
// { changed } zurueck, damit der Aufrufer nur bei echter Aenderung schreibt.
// Kuenftige Schritte (1 -> 2 ...) kommen hier als weitere if-Bloecke dazu.
export function migrateConfig(cfg) {
  if (!cfg || typeof cfg !== 'object') return { changed: false };
  let changed = false;
  if (!Number.isInteger(cfg.schemaVersion)) { cfg.schemaVersion = CONFIG_SCHEMA_VERSION; changed = true; }
  return { changed, version: cfg.schemaVersion };
}

// Zeitgestempelte Kopie nach <DATA_DIR>/.nexus-backups/ (gitignored). Nur eine
// Kopie je Migration, kein Rotieren – die Datei ist klein, eine Migration selten.
export function backupConfig(path = CONFIG_PATH) {
  if (!existsSync(path)) return null;
  const dir = join(dirname(path), '.nexus-backups');
  mkdirSync(dir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = join(dir, `nexus.config.${ts}.json`);
  copyFileSync(path, dest);
  return dest;
}

// Atomar: tmp + rename (MoveFileEx-Semantik unter Windows). Ein Absturz mitten
// im Schreiben laesst nie eine halbe nexus.config.json zurueck.
export function writeConfigAtomic(path, cfg) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = path + '.nexustmp';
  writeFileSync(tmp, JSON.stringify(cfg, null, 2), 'utf8');
  renameSync(tmp, path);
}

// ── R27b: EINE Ignore-Regel fuer alle Vault-Walker ────────────────────────────
// Vorher hatten Indexer, Watcher, Dateibaum, Lern-Scanner und Vault-Check je
// eine eigene Liste (vier Stellen, drei verschiedene Mengen). Jetzt: Defaults +
// cfg.ignore + Dotfile-Regel (alles, was mit "." beginnt – .trash, .nexus,
// .obsidian, .stfolder, .git ...). makeIgnore(list) liefert ein Praedikat fuer
// EINEN Namen (Datei oder Ordner), das jeder Walker auf jeden Eintrag anwendet.
export const TRASH_DIR = '.trash';
export const DEFAULT_IGNORE = ['.obsidian', TRASH_DIR, '.nexus', 'node_modules', '.git', '.stfolder', '.stversions'];
export function makeIgnore(list = []) {
  const set = new Set([...DEFAULT_IGNORE, ...(Array.isArray(list) ? list : [])]);
  return (name) => typeof name !== 'string' || name.length === 0 || name.startsWith('.') || set.has(name);
}

// ── R27a: Pfad-Haertung – EINE safeFull fuer MCP-Tools und UI-Server ──────────
// Liefert den absoluten Pfad von `rel` innerhalb von `root` – oder null, wenn der
// Pfad den Vault verlassen wuerde. Bewusst strenger als ein reiner resolve()-
// Vergleich, weil der Server auch unter Linux (Container, Sandbox-Tests) laeuft,
// wo Windows-Schreibweisen wie `..\x` oder `\\?\C:\x` sonst als harmlose
// Dateinamen INNERHALB des Vaults durchgehen wuerden:
//   - kein String / NUL-Byte                          -> null
//   - absolute Pfade (/x, \x, C:\x, C:x, \\server, \\?\) -> null
//   - jedes `..`-Segment (mit / oder \ getrennt)       -> null
//   - Ergebnis muss unter root liegen (resolve-Check)  -> sonst null
// '' bzw. '.' liefert die Vault-Wurzel selbst (fuer Ordner-Listings).
export function safeFull(root, rel) {
  if (rel === undefined || rel === null) rel = '';
  if (typeof rel !== 'string') return null;
  if (rel.includes('\0')) return null;
  const norm = rel.replace(/\\/g, '/');
  if (norm.startsWith('/')) return null;                    // /abs, \abs, \\server, \\?\
  if (/^[A-Za-z]:/.test(norm)) return null;                 // C:\x, C:x
  if (isAbsolute(rel)) return null;                         // Plattform-Sicht obendrauf
  for (const seg of norm.split('/')) if (seg === '..') return null;
  const rootAbs = resolve(root);
  const full = resolve(rootAbs, norm);
  if (full !== rootAbs && !full.startsWith(rootAbs + sep)) return null;
  return full;
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
