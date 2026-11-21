// test/build-server.test.mjs – R29/N7: buildServer({ registry, policy, info }) ohne Transport-Kopie.
//
// Beweist im Prozess (InMemoryTransport, kein Kindprozess, kein stdio):
//   1. Die Registry ist ein PARAMETER: zwei Registries in einem Prozess -> zwei getrennte Server.
//   2. Aus EINER Registry lassen sich mehrere Server bauen (HTTP-Einstieg: einer pro Anfrage).
//   3. policy.allow filtert Tools schon bei der Registrierung (z. B. "nur lesen").
//   4. info landet in initialize und list_vaults.server.
//   5. Der "$schema"-Fix gilt fuer jeden gebauten Server, nicht nur fuer den stdio-Einstieg.
//   6. src/server.js ist nur noch Einstieg (keine Tool-Registrierung mehr).
// Alles im Temp-Scratch. Lauf: node test/build-server.test.mjs
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildServer } from '../src/mcp/build-server.js';
import { makeVaultRegistry } from '../src/vault-registry.js';
import { buildIndexer } from '../src/indexer.js';
import { makeTools } from '../src/tools.js';

const __dir = dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
function ok(label, cond, extra) {
  if (cond) { console.log('  \x1b[32m✓\x1b[0m', label); pass++; }
  else      { console.log('  \x1b[31m✗\x1b[0m', label, extra ? `\n     Kontext: ${String(extra).slice(0, 300)}` : ''); fail++; }
}

const scratch = mkdtempSync(join(tmpdir(), 'nexus-buildserver-test-'));
const registries = [];
function registryMit(name, notiz, inhalt) {
  const dir = join(scratch, name);
  const vaultDir = join(dir, 'vault');
  mkdirSync(vaultDir, { recursive: true });
  writeFileSync(join(vaultDir, notiz), inhalt, 'utf8');
  const cfgPath = join(dir, 'nexus.config.json');
  const cfg = { activeVault: name, vaults: [{ name, path: vaultDir }], ignore: ['.trash', '.nexus'] };
  writeFileSync(cfgPath, JSON.stringify(cfg), 'utf8');
  const r = makeVaultRegistry({
    configPath: cfgPath,
    loadConfig: () => JSON.parse(readFileSync(cfgPath, 'utf8')),
    resolveDbPath: (v) => join(dir, v.name + '.db'),
    buildIndexer, makeTools,
  });
  registries.push(r);
  return r;
}
async function verbinde(server) {
  const [c, s] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'build-server-test', version: '0.0.0' });
  await Promise.all([server.connect(s), client.connect(c)]);
  return client;
}
const textVon = (r) => r?.content?.find(x => x.type === 'text')?.text ?? '';

const clients = [];
try {
  const regA = registryMit('alpha', 'A.md', '# A\n\nNur in Alpha.\n');
  const regB = registryMit('beta',  'B.md', '# B\n\nNur in Beta.\n');
  const info = { name: 'nexus-test', version: '9.9.9', gitCommit: 'abc1234', buildDate: null, dataDir: scratch, dev: true };

  // ── 1. Registry als Parameter ──────────────────────────────────────────────
  let wirft = false;
  try { buildServer({ info }); } catch { wirft = true; }
  ok('buildServer ohne registry wirft (kein stiller Modul-Singleton)', wirft);

  const cA = await verbinde(buildServer({ registry: regA, info })); clients.push(cA);
  const cB = await verbinde(buildServer({ registry: regB, info })); clients.push(cB);
  const lvA = await cA.callTool({ name: 'list_vaults', arguments: {} });
  const lvB = await cB.callTool({ name: 'list_vaults', arguments: {} });
  ok('Server A sieht nur seine Registry (alpha)', lvA.structuredContent?.vaults?.map(v => v.name).join() === 'alpha', JSON.stringify(lvA.structuredContent));
  ok('Server B sieht nur seine Registry (beta)',  lvB.structuredContent?.vaults?.map(v => v.name).join() === 'beta',  JSON.stringify(lvB.structuredContent));
  const rA = await cA.callTool({ name: 'read_note', arguments: { path: 'A.md' } });
  const rAB = await cA.callTool({ name: 'read_note', arguments: { path: 'B.md' } });
  ok('Server A liest A.md', textVon(rA).includes('Nur in Alpha'), textVon(rA));
  ok('Server A kennt B.md nicht (isError)', rAB.isError === true, textVon(rAB));

  // ── 2. mehrere Server aus EINER Registry ───────────────────────────────────
  const cA2 = await verbinde(buildServer({ registry: regA, info })); clients.push(cA2);
  const w = await cA2.callTool({ name: 'write_note', arguments: { path: 'Neu.md', content: '# Neu\n\nvom zweiten Server\n', create: true } });
  ok('zweiter Server aus derselben Registry schreibt', w.isError !== true, textVon(w));
  const gelesen = await cA.callTool({ name: 'read_note', arguments: { path: 'Neu.md' } });
  ok('erster Server sieht die Notiz des zweiten (gemeinsamer Index/Vault)', textVon(gelesen).includes('vom zweiten Server'), textVon(gelesen));

  // ── 3. policy ──────────────────────────────────────────────────────────────
  const alle = (await cA.listTools()).tools;
  ok('ohne policy: alle 24 Tools', alle.length === 24, `${alle.length}: ${alle.map(t => t.name).join(',')}`);
  const nurLesen = { allow: (name, { annotations }) => annotations?.readOnlyHint === true };
  const cRO = await verbinde(buildServer({ registry: regA, policy: nurLesen, info })); clients.push(cRO);
  const ro = (await cRO.listTools()).tools;
  ok('policy "nur lesen": nur readOnly-Tools gelistet', ro.length > 0 && ro.length < alle.length && ro.every(t => t.annotations?.readOnlyHint === true),
    ro.map(t => t.name).join(','));
  ok('policy "nur lesen": search/read_note da, write_note/patch/delete weg',
    ['search', 'read_note', 'list_vaults'].every(n => ro.some(t => t.name === n)) &&
    ['write_note', 'patch', 'delete', 'move', 'append_to_section'].every(n => !ro.some(t => t.name === n)),
    ro.map(t => t.name).join(','));
  let abgelehnt = false, antwort = null;
  try { antwort = await cRO.callTool({ name: 'write_note', arguments: { path: 'X.md', content: 'x', create: true } }); }
  catch { abgelehnt = true; }
  ok('policy "nur lesen": write_note ist nicht aufrufbar', abgelehnt || antwort?.isError === true, JSON.stringify(antwort));
  const dochDa = await cA.callTool({ name: 'read_note', arguments: { path: 'X.md' } });
  ok('policy "nur lesen": es wurde nichts geschrieben', dochDa.isError === true, textVon(dochDa));
  const nurName = await verbinde(buildServer({ registry: regA, policy: { allow: (name) => name === 'search' }, info })); clients.push(nurName);
  ok('policy nach Name: genau ein Tool', (await nurName.listTools()).tools.map(t => t.name).join() === 'search');

  // ── 4. info ────────────────────────────────────────────────────────────────
  const sv = cA.getServerVersion();
  ok('info.name/version stehen in initialize', sv?.name === 'nexus-test' && sv?.version === '9.9.9', JSON.stringify(sv));
  const srv = lvA.structuredContent?.server;
  ok('info steht in list_vaults.server', srv?.version === '9.9.9' && srv?.gitCommit === 'abc1234' && srv?.dataDir === scratch && srv?.dev === true, JSON.stringify(srv));
  const cMin = await verbinde(buildServer({ registry: regA })); clients.push(cMin);
  const lvMin = await cMin.callTool({ name: 'list_vaults', arguments: {} });
  ok('ohne info: Standard-Identitaet besteht das outputSchema', lvMin.isError !== true && cMin.getServerVersion()?.name === 'nexus' && lvMin.structuredContent?.server?.gitCommit === null,
    textVon(lvMin));

  // ── 5. "$schema"-Fix je Server ─────────────────────────────────────────────
  const mitSchema = alle.filter(t => '$schema' in (t.inputSchema ?? {}) || '$schema' in (t.outputSchema ?? {})).map(t => t.name);
  ok('kein Tool traegt "$schema" (Fix lebt in buildServer)', mitSchema.length === 0, mitSchema.join(','));

  // ── 6. src/server.js ist nur noch Einstieg ─────────────────────────────────
  const einstieg = readFileSync(join(__dir, '..', 'src', 'server.js'), 'utf8');
  ok('src/server.js registriert keine Tools mehr', !/registerTool|\.tool\(/.test(einstieg));
  ok('src/server.js ist duenn (<= 20 Zeilen) und nutzt buildServer + stdio',
    einstieg.split('\n').length <= 20 && /buildServer\(/.test(einstieg) && /StdioServerTransport/.test(einstieg), `${einstieg.split('\n').length} Zeilen`);
} catch (e) {
  console.error('  \x1b[31m✗ Testlauf-Fehler:\x1b[0m', e.stack || e.message);
  fail++;
} finally {
  for (const c of clients) { try { await c.close(); } catch {} }
  for (const r of registries) { try { r.close(); } catch {} }
  try { rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
  catch { console.log('  (Hinweis: Scratch-Ordner nicht entfernt – EPERM/WAL, unkritisch)'); }
}

console.log(`\n${fail === 0 ? '\x1b[32m' : '\x1b[31m'}${pass} bestanden, ${fail} Fehler\x1b[0m`);
process.exit(fail === 0 ? 0 : 1);
