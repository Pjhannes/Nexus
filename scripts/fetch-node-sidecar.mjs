// scripts/fetch-node-sidecar.mjs – laedt die offizielle Node-Binary als Tauri-Sidecar.
//
// Tauri bundelt externe Binaries aus src-tauri/binaries/<name>-<target-triple>[.exe]
// (tauri.conf.json -> bundle.externalBin). Die Binary ist ~80 MB und gehoert NICHT
// ins Git-Repo (src-tauri/binaries/ steht in .gitignore) – dieses Script holt sie
// bei Bedarf: einmal lokal pro Entwickler-Maschine, und in der CI pro Runner.
//
// Standard: Binary fuer die AKTUELLE Plattform. Fuer CI-Crossbuilds (z. B.
// x86_64-DMG auf einem arm64-Mac-Runner) laesst sich das Ziel explizit setzen:
//   node scripts/fetch-node-sidecar.mjs --triple=x86_64-apple-darwin
//
// Version angepinnt auf die lokal getestete LTS-Linie (node:sqlite braucht >= 22.5).
import { existsSync, mkdirSync, createWriteStream, renameSync, rmSync, chmodSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const NODE_VERSION = '24.16.0';

const __dir = dirname(fileURLToPath(import.meta.url));
const BIN_DIR = join(__dir, '..', 'src-tauri', 'binaries');

// triple -> Download-Koordinaten bei nodejs.org
const TARGETS = {
  'x86_64-pc-windows-msvc': { kind: 'exe', dist: 'win-x64' },
  'aarch64-apple-darwin':   { kind: 'tgz', dist: 'darwin-arm64' },
  'x86_64-apple-darwin':    { kind: 'tgz', dist: 'darwin-x64' },
};

function currentTriple() {
  if (process.platform === 'win32' && process.arch === 'x64') return 'x86_64-pc-windows-msvc';
  if (process.platform === 'darwin' && process.arch === 'arm64') return 'aarch64-apple-darwin';
  if (process.platform === 'darwin' && process.arch === 'x64') return 'x86_64-apple-darwin';
  throw new Error(`Nicht unterstuetzte Plattform: ${process.platform}/${process.arch}`);
}

const argTriple = process.argv.find(a => a.startsWith('--triple='))?.slice(9);
const triple = argTriple || currentTriple();
const target = TARGETS[triple];
if (!target) throw new Error(`Unbekanntes Triple: ${triple} (bekannt: ${Object.keys(TARGETS).join(', ')})`);

async function download(url, dest) {
  console.log(`[node-sidecar] Lade ${url} ...`);
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`Download fehlgeschlagen (${res.status}): ${url}`);
  const tmp = dest + '.part';
  const out = createWriteStream(tmp);
  for await (const chunk of res.body) {
    if (!out.write(chunk)) await new Promise(r => out.once('drain', r));
  }
  await new Promise((r, j) => out.end(err => err ? j(err) : r()));
  renameSync(tmp, dest);
}

const ext = target.kind === 'exe' ? '.exe' : '';
const dest = join(BIN_DIR, `node-${triple}${ext}`);

if (existsSync(dest)) {
  console.log(`[node-sidecar] Schon vorhanden: ${dest}`);
  process.exit(0);
}
mkdirSync(BIN_DIR, { recursive: true });

if (target.kind === 'exe') {
  // Windows: node.exe liegt einzeln im dist-Ordner – kein Archiv noetig.
  await download(`https://nodejs.org/dist/v${NODE_VERSION}/${target.dist}/node.exe`, dest);
} else {
  // macOS: offizielles tar.gz, daraus nur bin/node entnehmen.
  const name = `node-v${NODE_VERSION}-${target.dist}`;
  const tgz = join(BIN_DIR, `${name}.tar.gz`);
  await download(`https://nodejs.org/dist/v${NODE_VERSION}/${name}.tar.gz`, tgz);
  const r = spawnSync('tar', ['-xzf', tgz, '-C', BIN_DIR, `${name}/bin/node`], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error('tar-Entpacken fehlgeschlagen');
  renameSync(join(BIN_DIR, name, 'bin', 'node'), dest);
  chmodSync(dest, 0o755);
  rmSync(join(BIN_DIR, name), { recursive: true, force: true });
  rmSync(tgz, { force: true });
}

console.log(`[node-sidecar] Fertig: ${dest}`);
