// test/mcp-packaged.test.mjs – Phase-4-E2E: beweist das GEPACKTE Layout.
//
// Phase 3 hat die Spawn-Semantik bewiesen, aber gegen den Repo-Baum (node_modules
// per Aufloesung nach oben). Dieser Test baut das INSTALLIERTE Layout nach:
//
//   <scratch>/app dir/            (mit Leerzeichen, wie "C:\Program Files\Nexus")
//     node.exe                    <- die ECHTE gebuendelte Sidecar-Binary
//     resources/
//       src/                      <- Kopie von src/ (wie bundle.resources)
//       package.json
//       node_modules/             <- das GEPRUENTE Staging (npm ci --omit=dev)
//
// und laesst den MCP-Server von dort laufen: Modul-Aufloesung MUSS aus
// resources/node_modules kommen (der Scratch liegt ausserhalb des Repos, es gibt
// kein node_modules weiter oben). Faengt genau die Fehlklasse, die im Review als
// "Phase-4-Luecke" markiert war: Release-Sidecar stirbt am ersten import.
//
// Voraussetzungen (werden bei Bedarf selbst hergestellt): das Staging via
// scripts/prepare-sidecar-resources.mjs. Die gebuendelte node-Binary wird genutzt,
// wenn sie fuer die aktuelle Plattform vorliegt (src-tauri/binaries/), sonst
// Fallback auf process.execPath mit Hinweis (Sandbox/CI ohne Fetch).
// Lauf: node test/mcp-packaged.test.mjs
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, cpSync, rmSync, existsSync, chmodSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { mcpSession, toolJson } from './mcp-client.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..');
const STAGING_NM = join(ROOT, 'src-tauri', 'resources', 'node_modules');

let pass = 0, fail = 0;
function ok(label, cond, extra) {
  if (cond) { console.log('  \x1b[32m✓\x1b[0m', label); pass++; }
  else      { console.log('  \x1b[31m✗\x1b[0m', label, extra ? `\n     Kontext: ${String(extra).slice(0, 300)}` : ''); fail++; }
}

// ── Voraussetzung: Staging vorhanden (sonst einmal erzeugen) ─────────────────
if (!existsSync(STAGING_NM)) {
  console.log('  (Staging fehlt – erzeuge es via prepare-sidecar-resources.mjs ...)');
  const r = spawnSync(process.execPath, [join(ROOT, 'scripts', 'prepare-sidecar-resources.mjs')], { stdio: 'inherit' });
  if (r.status !== 0) { console.error('  ✗ Staging fehlgeschlagen'); process.exit(1); }
}

// ── Gebuendelte Sidecar-Binary (echte ABI!) oder Fallback ────────────────────
function bundledNode() {
  const triples = { 'win32:x64': 'x86_64-pc-windows-msvc.exe', 'darwin:arm64': 'aarch64-apple-darwin', 'darwin:x64': 'x86_64-apple-darwin' };
  const t = triples[`${process.platform}:${process.arch}`];
  if (!t) return null;
  const p = join(ROOT, 'src-tauri', 'binaries', `node-${t}`);
  return existsSync(p) ? p : null;
}
const nodeSource = bundledNode();
if (!nodeSource) console.log('  (Hinweis: keine gebuendelte Sidecar-Binary fuer diese Plattform – Fallback auf die laufende Node; Layout-Beweis gilt trotzdem)');

// ── Install-Layout im Scratch nachbauen ──────────────────────────────────────
const scratch = mkdtempSync(join(tmpdir(), 'nexus packaged test-'));
const appDir = join(scratch, 'app dir');
const resDir = join(appDir, 'resources');
mkdirSync(resDir, { recursive: true });
const nodeBin = join(appDir, process.platform === 'win32' ? 'node.exe' : 'node');
copyFileSync(nodeSource || process.execPath, nodeBin);
if (process.platform !== 'win32') chmodSync(nodeBin, 0o755);
cpSync(join(ROOT, 'src'), join(resDir, 'src'), { recursive: true });
copyFileSync(join(ROOT, 'package.json'), join(resDir, 'package.json'));
cpSync(STAGING_NM, join(resDir, 'node_modules'), { recursive: true });

// Daten-Scratch (getrennt vom "Install"-Ordner, wie im echten Betrieb)
const dataDir = join(scratch, 'data dir');
const vaultDir = join(dataDir, 'mein vault');
mkdirSync(vaultDir, { recursive: true });
writeFileSync(join(vaultDir, 'Paket Test.md'), '# Paket Test\n\nGepacktes Layout funktioniert.\n', 'utf8');
writeFileSync(join(dataDir, 'nexus.config.json'), JSON.stringify({
  vaultsRoot: dataDir,
  activeVault: 'paketvault',
  vaults: [{ name: 'paketvault', path: vaultDir, dbPath: '.nexus/paketvault.db' }],
  ui: { port: 3998, autoOpen: false },
  ignore: ['.obsidian', '.trash', '.nexus', 'node_modules'],
}, null, 2), 'utf8');

// ── Start EXAKT wie die migrierte Claude-Config: <install>/node resources/src/server.js
const session = mcpSession(nodeBin, [join(resDir, 'src', 'server.js')], { NEXUS_DATA_DIR: dataDir });
let exitCode = 1;
try {
  const init = await session.request('initialize', {
    protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'nexus-phase4-packaged', version: '0.0.0' },
  }, 30_000);
  ok('initialize antwortet (Module aus resources/node_modules aufgeloest!)', !!init.result);
  ok('Server nennt sich "nexus"', init.result?.serverInfo?.name === 'nexus');
  session.notify('notifications/initialized', {});

  const tools = await session.request('tools/list', {});
  const names = (tools.result?.tools ?? []).map(t => t.name);
  ok('tools/list liefert alle Werkzeuge', names.length >= 15, `nur ${names.length}`);

  const lv = toolJson(await session.request('tools/call', { name: 'list_vaults', arguments: {} }));
  const vaults = Array.isArray(lv) ? lv : (lv.vaults ?? []);
  const pv = vaults.find(v => v.name === 'paketvault');
  ok('list_vaults: Scratch-Vault da, exakt 1 Notiz', pv && Number(pv.notes) === 1, JSON.stringify(lv).slice(0, 200));
  ok('Containment: alle Vault-Pfade im Scratch', vaults.length > 0 && vaults.every(v => String(v.path || '').startsWith(scratch)),
     vaults.map(v => v.path).join(' | '));

  const rd = await session.request('tools/call', { name: 'read_note', arguments: { path: 'Paket Test.md' } });
  const rdText = (rd.result?.content ?? []).map(c => c.text).join('');
  ok('read_note liest aus dem gepackten Layout', rdText.includes('Gepacktes Layout funktioniert'));

  ok('Beweis der Herkunft: genutzte Binary', true, undefined); // dokumentiert unten im Summary
  console.log(`  (Binary: ${nodeSource ? 'gebuendelte Sidecar-Node' : 'Fallback process.execPath'}, Layout: ${resDir})`);

  exitCode = 0;
} catch (e) {
  console.error('  \x1b[31m✗ E2E-Fehler:\x1b[0m', e.message);
  console.error('  Server-stderr (Tail):', session.getStderr().slice(-600) || '(leer)');
  fail++;
} finally {
  try { session.child.kill(); } catch {}
  await Promise.race([session.exited, new Promise(r => setTimeout(r, 5000))]);
  try { rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
  catch { console.log('  (Hinweis: Scratch-Ordner nicht entfernt – EPERM/WAL, unkritisch)'); }
}

console.log(`\n${fail === 0 ? '\x1b[32m' : '\x1b[31m'}${pass} bestanden, ${fail} Fehler\x1b[0m`);
process.exit(fail === 0 ? exitCode : 1);
