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
import { mcpSession, toolJson } from './mcp-client.mjs';

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
// Echtes 1x1-PNG (rot) – Kopf + gueltige Chunks, damit read_bild Masse UND Bytes liefert.
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64');
mkdirSync(join(vaultDir, 'Bilder'), { recursive: true });
writeFileSync(join(vaultDir, 'Bilder', 'punkt.png'), PNG_1x1);
writeFileSync(join(vaultDir, 'Bilder', 'skizze.svg'),
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900"><text x="352" y="315">Portalroboter</text></svg>', 'utf8');
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

// ── Mini-MCP-Client: geteilt mit mcp-packaged.test.mjs ──────────────────────
// (Implementierung in test/mcp-client.mjs – robust gegen Spawn-Fehler/Crash.)

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
  for (const t of ['list_vaults', 'search', 'read_note', 'write_note', 'write_vortrag', 'write_karten', 'lern_status', 'dataview', 'vault_check']) {
    ok(`Tool vorhanden: ${t}`, names.includes(t));
  }
  // write_karten muss Bild-Regionen entgegennehmen – sonst koennte Claude sie nicht selbst setzen
  const wk = (tools.result?.tools ?? []).find(t => t.name === 'write_karten');
  const kartenProps = wk?.inputSchema?.properties?.karten?.items?.properties ?? {};
  ok('write_karten kennt "regionen"', !!kartenProps.regionen, Object.keys(kartenProps).join(','));
  ok('write_karten kennt "modus" und "abdecken"', !!kartenProps.modus && !!kartenProps.abdecken);
  const regProps = kartenProps.regionen?.items?.properties ?? {};
  ok('Regionen sind Rechtecke (x/y/w/h)', ['x', 'y', 'w', 'h'].every(f => !!regProps[f]), Object.keys(regProps).join(','));

  // ── read_bild: liefert das Bild WIRKLICH als Bild-Inhalt, nicht als Pfad ──
  const bildAntwort = await session.request('tools/call', {
    name: 'read_bild', arguments: { vault: 'testvault', path: 'Bilder/punkt.png' } });
  const bildTeile = bildAntwort.result?.content ?? [];
  const bildBlock = bildTeile.find(c => c.type === 'image');
  ok('read_bild antwortet mit einem image-Block', !!bildBlock, JSON.stringify(bildTeile.map(c => c.type)));
  ok('image-Block trägt den richtigen MIME-Typ', bildBlock?.mimeType === 'image/png', bildBlock?.mimeType);
  ok('image-Block enthaelt base64-Daten', typeof bildBlock?.data === 'string' && bildBlock.data.length > 40);
  ok('Bild-Block steht VOR dem Text', bildTeile[0]?.type === 'image', bildTeile[0]?.type);
  const bildInfo = JSON.parse(bildTeile.find(c => c.type === 'text').text);
  ok('Pixelmasse werden mitgeliefert', bildInfo.breite === 1 && bildInfo.hoehe === 1, JSON.stringify(bildInfo));
  ok('Dateigroesse wird genannt', bildInfo.bytes === PNG_1x1.length, String(bildInfo.bytes));
  ok('Vault wird benannt', bildInfo.vault === 'testvault');

  const svgAntwort = (await session.request('tools/call', {
    name: 'read_bild', arguments: { vault: 'testvault', path: 'Bilder/skizze.svg' } })).result?.content ?? [];
  const svgInfo = JSON.parse(svgAntwort.find(c => c.type === 'text').text);
  ok('SVG kommt als Text, nicht als Bild', !svgAntwort.some(c => c.type === 'image') && svgInfo.vektor === true);
  ok('SVG-Masse aus der viewBox', svgInfo.breite === 1600 && svgInfo.hoehe === 900, JSON.stringify(svgInfo));
  ok('SVG-Quelltext liegt bei', svgAntwort.some(c => c.type === 'text' && c.text.includes('Portalroboter')));

  const keinBild = toolJson(await session.request('tools/call', {
    name: 'read_bild', arguments: { vault: 'testvault', path: 'Start Notiz.md' } }));
  ok('Nicht-Bild wird abgelehnt', /unterstuetzte Bilddatei/i.test(keinBild?.error ?? ''), JSON.stringify(keinBild).slice(0, 160));
  const raus = toolJson(await session.request('tools/call', {
    name: 'read_bild', arguments: { vault: 'testvault', path: '../../ausserhalb.png' } }));
  ok('Pfad ausserhalb des Vaults wird geblockt', /ausserhalb|existiert nicht/i.test(raus?.error ?? ''), JSON.stringify(raus).slice(0, 160));

  // lern_status auf dem Scratch-Vault: keine Karten -> leere, aber gueltige Antwort
  const ls = toolJson(await session.request('tools/call', {
    name: 'lern_status', arguments: { vault: 'testvault' } }));
  ok('lern_status antwortet mit heute-Datum', /^\d{4}-\d{2}-\d{2}$/.test(ls?.heute ?? ''), JSON.stringify(ls).slice(0, 200));
  ok('lern_status liefert Faecher-Liste', Array.isArray(ls?.faecher));
  ok('lern_status ohne Karten meldet 0 faellig', ls?.heuteFaellig === 0, String(ls?.heuteFaellig));
  const lsFehler = toolJson(await session.request('tools/call', {
    name: 'lern_status', arguments: { vault: 'testvault', fach: 'GibtsNicht' } }));
  ok('lern_status meldet unbekanntes Fach als Fehler', /nicht gefunden/i.test(lsFehler?.error ?? ''), JSON.stringify(lsFehler).slice(0, 160));

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
