// scripts/prepare-sidecar-resources.mjs – stellt die Bundle-Ressourcen fuer den
// Tauri-Release-Build bereit (beforeBuildCommand in src-tauri/tauri.conf.json).
//
// Der Node-Sidecar (ui-server.js / server.js) braucht im installierten Layout
// seine npm-Dependencies neben sich: resources/node_modules. Das darf NICHT das
// Dev-node_modules sein (enthaelt electron, electron-builder, sharp ... ~500 MB),
// sondern ein PRODUKTIONS-Stand: package.json + package-lock.json werden in
// src-tauri/resources/ gestaged und dort per `npm ci --omit=dev` installiert –
// lockfile-treu und reproduzierbar. (electron-updater ist als runtime-dependency
// dabei, obwohl nur die Electron-Huelle es nutzt – bewusst in Kauf genommen,
// solange die Bruecken-Phase laeuft; fliegt mit dem Electron-Rueckbau raus.)
//
// Idempotent: neu installiert wird nur, wenn sich package-lock.json geaendert hat
// (Hash-Merker .lockhash). src-tauri/resources/ ist gitignored.
// Zusaetzlich wird die Node-Sidecar-Binary geholt, falls sie fehlt (delegiert an
// fetch-node-sidecar.mjs als Kindprozess – das Script beendet sich selbst).
import { existsSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import { createHash } from 'crypto';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..');
const STAGING = join(ROOT, 'src-tauri', 'resources');

// 1) Node-Sidecar-Binary sicherstellen (Kindprozess; eigenes Skip-if-exists).
// Tauri setzt TAURI_ENV_TARGET_TRIPLE fuer Build-Hooks, wenn `tauri build --target ...`
// lief (z. B. der macOS-x64-Crossbuild auf einem arm64-Runner) – ohne das wuerde
// hier faelschlich die Host-Architektur-Binary nachgeladen (unnoetiger Download,
// keine Fehlfunktion, da externalBin ohnehin ueber --target aufloest).
{
  const tripleArg = process.env.TAURI_ENV_TARGET_TRIPLE ? [`--triple=${process.env.TAURI_ENV_TARGET_TRIPLE}`] : [];
  const r = spawnSync(process.execPath, [join(__dir, 'fetch-node-sidecar.mjs'), ...tripleArg], { stdio: 'inherit' });
  if (r.status !== 0) { console.error('[resources] Sidecar-Fetch fehlgeschlagen'); process.exit(1); }
}

// 2) Produktions-node_modules stagen (lockfile-treu, idempotent per Hash).
mkdirSync(STAGING, { recursive: true });
const lock = readFileSync(join(ROOT, 'package-lock.json'));
const lockHash = createHash('sha256').update(lock).digest('hex');
const hashFile = join(STAGING, '.lockhash');
const upToDate = existsSync(join(STAGING, 'node_modules')) &&
  existsSync(hashFile) && readFileSync(hashFile, 'utf8') === lockHash;

if (upToDate) {
  console.log('[resources] node_modules aktuell (Lock unveraendert).');
} else {
  copyFileSync(join(ROOT, 'package.json'), join(STAGING, 'package.json'));
  writeFileSync(join(STAGING, 'package-lock.json'), lock);
  // Merker VOR dem Install loeschen: bricht npm ci ab (Stromausfall, Ctrl+C),
  // bleibt eine kaputte node_modules mit veraltetem Hash liegen – ohne diese
  // Zeile wuerde der naechste Lauf sie faelschlich als "aktuell" durchwinken.
  rmSync(hashFile, { force: true });
  console.log('[resources] npm ci --omit=dev in src-tauri/resources ...');
  // --ignore-scripts: (a) der repo-eigene prepare-Hook (install-hooks.mjs) existiert
  // im Staging nicht, (b) die Server-Deps sind reine JS-Pakete ohne noetige
  // Install-Scripts (kein natives Modul dank node:sqlite) -> sicherer UND robuster.
  // Windows braucht shell:true fuer npm.cmd (CVE-2024-27980-Haertung) – ein
  // EINZELNER command-String statt Array+shell vermeidet Nodes DEP0190-Warnung,
  // ohne die Sicherheit zu aendern (alle Argumente sind Literale, keine Injektion).
  const npmArgs = ['ci', '--omit=dev', '--no-audit', '--no-fund', '--ignore-scripts'];
  const r = process.platform === 'win32'
    ? spawnSync(['npm', ...npmArgs].join(' '), { cwd: STAGING, stdio: 'inherit', shell: true })
    : spawnSync('npm', npmArgs, { cwd: STAGING, stdio: 'inherit' });
  if (r.status !== 0) { console.error('[resources] npm ci fehlgeschlagen'); process.exit(1); }
  writeFileSync(hashFile, lockHash);
}
console.log('[resources] Fertig: ' + join(STAGING, 'node_modules'));
