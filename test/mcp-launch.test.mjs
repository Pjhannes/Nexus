// test/mcp-launch.test.mjs – Phase-3-E2E: startet den MCP-Server EXAKT so, wie
// Claude Desktop es nach der Migration tut (command + args, KEIN Shell), und
// spricht echtes MCP (JSON-RPC ueber stdio, newline-delimited).
//
// Absichtlich mit LEERZEICHEN ueberall, wo sie in der Realitaet vorkommen koennen:
//   - die Node-Binary wird in einen Ordner MIT Leerzeichen kopiert (Install-Pfad
//     "C:\Program Files\Nexus"-Klasse) und von dort gestartet,
//   - NEXUS_DATA_DIR und der Vault-Pfad enthalten Leerzeichen,
//   - eine Notiz mit Leerzeichen im Namen wird gelesen.
//
// Was dieser Test BEWEIST: Spawn-Semantik (Leerzeichen, kein Shell), korrektes
// MCP ueber stdio, NEXUS_DATA_DIR-Umleitung, R20-Hot-Reload live.
// Was er NICHT beweist (dokumentierte Phase-4-Luecke): das GEPACKTE Layout
// (resources/src + resources/node_modules) – hier laeuft der Repo-Baum mit dem
// Repo-node_modules. Phase 4 braucht einen Folgetest mit Scratch-resources-Layout.
//
// Kein Zugriff auf Pauls echte Daten: alles laeuft in einem Temp-Scratch, und die
// Containment-Invariante wird GEPRUEFT (nicht nur angenommen): jeder vom Server
// gemeldete Vault-Pfad muss im Scratch liegen – schuetzt vor dem Self-Heal-
// Fallback in paths.js, der sonst still auf %APPDATA%\Nexus zurueckfiele.
// Lauf: node test/mcp-launch.test.mjs   (aus D:\Nexus bzw. /tmp-Kopie in der Sandbox)
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, rmSync, chmodSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const SERVER_JS = join(__dir, '..', 'src', 'server.js');

let pass = 0, fail = 0;
function ok(label, cond, extra) {
  if (cond) { console.log('  \x1b[32m✓\x1b[0m', label); pass++; }
  else      { console.log('  \x1b[31m✗\x1b[0m', label, extra ? `\n     Kontext: ${String(extra).slice(0, 300)}` : ''); fail++; }
}

// ── Scratch-Umgebung (mit Leerzeichen im Pfad) ───────────────────────────────
const scratch = mkdtempSync(join(tmpdir(), 'nexus mcp test-'));
const vaultDir = join(scratch, 'test vault');
mkdirSync(vaultDir, { recursive: true });
writeFileSync(join(vaultDir, 'Start Notiz.md'), '# Start Notiz\n\nHallo aus dem MCP-E2E-Test.\n', 'utf8');
writeFileSync(join(scratch, 'nexus.config.json'), JSON.stringify({
  vaultsRoot: scratch,
  activeVault: 'testvault',
  vaults: [{ name: 'testvault', path: vaultDir, dbPath: '.nexus/testvault.db' }],
  ui: { port: 3999, autoOpen: false },
  ignore: ['.obsidian', '.trash', '.nexus', 'node_modules'],
}, null, 2), 'utf8');

// Node-Binary in einen Leerzeichen-Ordner kopieren – wie ein Install-Verzeichnis
// "C:\Program Files\Nexus\node.exe". Claude Desktop spawnt command+args ohne
// Shell, Leerzeichen duerfen also nie ein Problem sein; das beweisen wir hier.
const binDir = join(scratch, 'bin dir');
mkdirSync(binDir, { recursive: true });
const nodeCopy = join(binDir, process.platform === 'win32' ? 'node.exe' : 'node');
copyFileSync(process.execPath, nodeCopy);
if (process.platform !== 'win32') chmodSync(nodeCopy, 0o755);

// ── Mini-MCP-Client (JSON-RPC ueber stdio, eine Nachricht pro Zeile) ─────────
// Robust gegen Spawn-Fehler (AV blockt die frische node.exe) und Server-Crash:
// 'error'/'exit' rejecten alle offenen Requests sofort statt in den Timeout zu
// laufen oder als unbehandeltes Event den Test ausserhalb des try/catch zu killen.
function mcpSession(command, args, env) {
  const child = spawn(command, args, { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = '';
  const pending = new Map();
  let stderrTail = '';
  let dead = null;
  const failAll = (err) => {
    dead = err;
    for (const [, entry] of pending) { clearTimeout(entry.t); entry.reject(err); }
    pending.clear();
  };
  child.on('error', (e) => failAll(new Error(`Spawn fehlgeschlagen: ${e.message}`)));
  child.on('exit', (code, sig) => {
    if (pending.size) failAll(new Error(`Server-Exit (code ${code}, signal ${sig}). stderr: ${stderrTail.slice(-500)}`));
  });
  child.stderr.on('data', d => { stderrTail = (stderrTail + d.toString()).slice(-3000); });
  child.stdout.on('data', d => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line) continue;
      let msg; try { msg = JSON.parse(line); } catch { continue; }
      if (msg.id !== undefined && pending.has(msg.id)) {
        const entry = pending.get(msg.id);
        clearTimeout(entry.t); pending.delete(msg.id); entry.resolve(msg);
      }
    }
  });
  let seq = 0;
  function request(method, params, timeoutMs = 20_000) {
    const id = ++seq;
    return new Promise((resolve, reject) => {
      if (dead) return reject(dead);
      const t = setTimeout(() => { pending.delete(id); reject(new Error(`Timeout bei ${method}. stderr: ${stderrTail.slice(-400)}`)); }, timeoutMs);
      pending.set(id, { resolve, reject, t });
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }
  function notify(method, params) {
    try { child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n'); } catch {}
  }
  const exited = new Promise(r => child.once('exit', r));
  return { child, request, notify, exited, getStderr: () => stderrTail };
}

// Tool-Antwort -> geparstes JSON (list_vaults liefert JSON-Text im content).
function toolJson(msg) {
  const text = (msg.result?.content ?? []).map(c => c.text).join('');
  try { return JSON.parse(text); } catch { return { __raw: text }; }
}

// ── Testlauf ─────────────────────────────────────────────────────────────────
const session = mcpSession(nodeCopy, [SERVER_JS], { NEXUS_DATA_DIR: scratch });
let exitCode = 1;
try {
  const init = await session.request('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'nexus-phase3-e2e', version: '0.0.0' },
  }, 30_000); // erster Aufruf: Server muss erst indexieren
  ok('initialize antwortet', !!init.result);
  ok('Server nennt sich "nexus"', init.result?.serverInfo?.name === 'nexus');
  ok('protocolVersion ausgehandelt', typeof init.result?.protocolVersion === 'string' && init.result.protocolVersion.length > 0);
  session.notify('notifications/initialized', {});

  const tools = await session.request('tools/list', {});
  const names = (tools.result?.tools ?? []).map(t => t.name);
  ok('tools/list liefert Werkzeuge', names.length >= 15, `nur ${names.length}`);
  for (const t of ['list_vaults', 'search', 'read_note', 'write_note', 'write_vortrag', 'dataview', 'vault_check']) {
    ok(`Tool vorhanden: ${t}`, names.includes(t));
  }

  const lv = toolJson(await session.request('tools/call', { name: 'list_vaults', arguments: {} }));
  const vaults = Array.isArray(lv) ? lv : (lv.vaults ?? []);
  const tv = vaults.find(v => v.name === 'testvault');
  ok('list_vaults nennt den Scratch-Vault', !!tv, JSON.stringify(lv).slice(0, 200));
  ok('list_vaults zaehlt exakt 1 Notiz', tv && Number(tv.notes) === 1, tv && `notes=${tv.notes}`);
  // Containment-INVARIANTE (nicht Annahme): jeder gemeldete Vault-Pfad liegt im
  // Scratch. Faellt der Server je auf den echten Datenordner zurueck (paths.js-
  // Self-Heal), schlaegt der Test hart fehl, statt still Pauls Vaults anzufassen.
  ok('Containment: alle Vault-Pfade im Scratch', vaults.length > 0 && vaults.every(v => String(v.path || '').startsWith(scratch)),
     vaults.map(v => v.path).join(' | '));

  const rd = await session.request('tools/call', { name: 'read_note', arguments: { path: 'Start Notiz.md' } });
  const rdText = (rd.result?.content ?? []).map(c => c.text).join('');
  ok('read_note liest die Leerzeichen-Notiz', rdText.includes('Hallo aus dem MCP-E2E-Test'));

  // R20-Kurzprobe: neuen Vault in die Config schreiben -> list_vaults sieht ihn
  // OHNE Neustart. Deterministischer Poll statt fixem Sleep (die Registry-
  // Signatur ist mtime+size; die Datei waechst, size aendert sich sicher).
  const vault2 = join(scratch, 'zweiter vault');
  mkdirSync(vault2, { recursive: true });
  const cfg = JSON.parse(readFileSync(join(scratch, 'nexus.config.json'), 'utf8'));
  cfg.vaults.push({ name: 'zweiter', path: vault2, dbPath: '.nexus/zweiter.db' });
  writeFileSync(join(scratch, 'nexus.config.json'), JSON.stringify(cfg, null, 2), 'utf8');
  let zweiter = null;
  for (let i = 0; i < 20 && !zweiter; i++) {
    const lv2 = toolJson(await session.request('tools/call', { name: 'list_vaults', arguments: {} }));
    const arr = Array.isArray(lv2) ? lv2 : (lv2.vaults ?? []);
    zweiter = arr.find(v => v.name === 'zweiter') || null;
    if (!zweiter) await new Promise(r => setTimeout(r, 100));
  }
  ok('R20 Hot-Reload: neuer Vault ohne Neustart sichtbar', !!zweiter);
  ok('R20: neuer Vault korrekt leer (notes=0)', zweiter && Number(zweiter.notes) === 0, zweiter && `notes=${zweiter.notes}`);

  exitCode = 0;
} catch (e) {
  console.error('  \x1b[31m✗ E2E-Fehler:\x1b[0m', e.message);
  console.error('  Server-stderr (Tail):', session.getStderr().slice(-600) || '(leer)');
  fail++;
} finally {
  try { session.child.kill(); } catch {}
  // Deterministisch auf Prozess-Ende warten (max 5 s) statt fixer Schlafzeit –
  // sonst leakt der Scratch (inkl. 90-MB-node-Kopie) bei langsamem Handle-Release.
  await Promise.race([session.exited, new Promise(r => setTimeout(r, 5000))]);
  try { rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
  catch { console.log('  (Hinweis: Scratch-Ordner nicht entfernt – EPERM/WAL, unkritisch)'); }
}

console.log(`\n${fail === 0 ? '\x1b[32m' : '\x1b[31m'}${pass} bestanden, ${fail} Fehler\x1b[0m`);
process.exit(fail === 0 ? exitCode : 1);
