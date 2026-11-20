// test/mcp-http.test.mjs – R30: HTTP-Einstieg des Remote-Connectors (src/mcp/http-app.js).
//
// Alles im selben Prozess: Scratch-Vault + Registry, die Express-App auf einem freien
// Loopback-Port, rohe HTTP-Anfragen ueber node:http (damit auch der Host-Header frei setzbar ist).
// In Tests und Doku nur example.com – keine echten Domains/IDs.
// Lauf: node test/mcp-http.test.mjs
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import http from 'http';
import { createHttpApp } from '../src/mcp/http-app.js';
import { loadHttpConfig } from '../src/mcp/http-config.js';
import { makeVaultRegistry } from '../src/vault-registry.js';
import { buildIndexer } from '../src/indexer.js';
import { makeTools } from '../src/tools.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..');
let pass = 0, fail = 0;
function ok(label, cond, extra) {
  if (cond) { console.log('  \x1b[32m✓\x1b[0m', label); pass++; }
  else      { console.log('  \x1b[31m✗\x1b[0m', label, extra ? `\n     Kontext: ${String(extra).slice(0, 400)}` : ''); fail++; }
}

const scratch = mkdtempSync(join(tmpdir(), 'nexus-mcp-http-test-'));
const aufraeumen = [];

// Registry mit zwei Vaults: "wissen" (wird freigegeben) und "privat" (nie freigegeben).
function baueRegistry() {
  const vaults = [];
  for (const [name, datei, inhalt] of [
    ['wissen', 'Notiz.md', '# Notiz\n\nDer Connector findet das Wort Leuchtturm.\n\n## Abschnitt\n\nZweiter Teil.\n'],
    ['privat', 'Geheim.md', '# Geheim\n\nNur lokal: Zitronenfalter.\n'],
  ]) {
    const dir = join(scratch, name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, datei), inhalt, 'utf8');
    vaults.push({ name, path: dir });
  }
  const cfgPath = join(scratch, 'nexus.config.json');
  writeFileSync(cfgPath, JSON.stringify({ activeVault: 'privat', vaults, ignore: ['.trash', '.nexus'] }), 'utf8');
  const r = makeVaultRegistry({
    configPath: cfgPath,
    loadConfig: () => JSON.parse(readFileSync(cfgPath, 'utf8')),
    resolveDbPath: (v) => join(scratch, v.name + '.db'),
    buildIndexer, makeTools,
  });
  aufraeumen.push(() => r.close());
  return r;
}

async function starte(app) {
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  aufraeumen.push(() => new Promise(r => { server.closeAllConnections?.(); server.close(r); }));
  return server.address().port;
}

// Rohe Anfrage. body: Objekt (wird JSON) oder String/Buffer (unveraendert).
function anfrage(port, { method = 'POST', path = '/mcp', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const daten = body === undefined ? null : (typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
    const h = { ...(daten !== null ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(daten) } : {}),
      accept: 'application/json, text/event-stream', ...headers };
    const rq = http.request({ host: '127.0.0.1', port, method, path, headers: h }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', d => { text += d; });
      res.on('end', () => { let json = null; try { json = JSON.parse(text); } catch {} resolve({ status: res.statusCode, headers: res.headers, text, json }); });
    });
    rq.on('error', reject);
    if (daten !== null) rq.write(daten);
    rq.end();
  });
}
let seq = 0;
const rpc = (method, params = {}) => ({ jsonrpc: '2.0', id: ++seq, method, params });
const INIT = { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'mcp-http-test', version: '0.0.0' } };

// Basis-Umgebung fuer alle Tests – nur Platzhalter.
const RESOURCE = 'https://mcp.example.com/mcp';
const ISSUER = 'https://auth.example.com';
const ENV = { NEXUS_MCP_RESOURCE_URL: RESOURCE, NEXUS_MCP_ISSUER: ISSUER };
const wirft = (env) => { try { loadHttpConfig(env); return null; } catch (e) { return e.message; } };

const info = { name: 'nexus-test', version: '9.9.9', gitCommit: null, buildDate: null, dataDir: scratch, dev: true };

try {
  const registry = baueRegistry();

  // ── 1. HTTP-Einstieg ───────────────────────────────────────────────────────
  console.log('1. HTTP-Einstieg');
  {
    const config = loadHttpConfig(ENV);
    ok('Standard: eingeschaltet, Port 3100, Bind nur Loopback', config.enabled === true && config.port === 3100 && config.bind === '127.0.0.1', JSON.stringify(config));
    ok('ungueltiger Port -> Konfigurationsfehler', /NEXUS_MCP_PORT/.test(wirft({ ...ENV, NEXUS_MCP_PORT: 'abc' }) ?? ''));

    const port = await starte(createHttpApp({ registry, info, config }));
    const vorher = registry.size();
    const init = await anfrage(port, { body: rpc('initialize', INIT) });
    ok('POST /mcp initialize -> 200 JSON', init.status === 200 && /application\/json/.test(init.headers['content-type'] ?? '') && init.json?.result?.serverInfo?.name === 'nexus-test',
      `${init.status} ${init.text}`);
    ok('zustandslos: keine Mcp-Session-Id in der Antwort', init.headers['mcp-session-id'] === undefined);
    const init2 = await anfrage(port, { body: rpc('initialize', INIT) });
    ok('zweite Anfrage ohne Sitzung funktioniert genauso', init2.status === 200 && init2.json?.result?.serverInfo?.version === '9.9.9', init2.text);
    ok('Registry bleibt dieselbe (einmal pro Prozess)', registry.size() === vorher && vorher === 2, `${vorher} -> ${registry.size()}`);

    const get = await anfrage(port, { method: 'GET' });
    ok('GET /mcp -> 405 mit Allow: POST', get.status === 405 && get.headers.allow === 'POST', `${get.status} ${get.text}`);
    const del = await anfrage(port, { method: 'DELETE' });
    ok('DELETE /mcp -> 405', del.status === 405 && del.headers.allow === 'POST', `${del.status}`);
    const put = await anfrage(port, { method: 'PUT', body: {} });
    ok('PUT /mcp -> 405', put.status === 405, `${put.status}`);
    const fremd = await anfrage(port, { method: 'GET', path: '/' });
    ok('anderer Pfad -> 404', fremd.status === 404, `${fremd.status}`);
    const kaputt = await anfrage(port, { body: '{kein json' });
    ok('kaputtes JSON -> 400, kein Stacktrace', kaputt.status === 400 && !/at .*\.js/.test(kaputt.text), `${kaputt.status} ${kaputt.text}`);
    ok('kein X-Powered-By', init.headers['x-powered-by'] === undefined);

    // Kill-Switch
    for (const wert of ['0', 'false', 'off']) {
      const aus = loadHttpConfig({ NEXUS_MCP_ENABLED: wert });
      const p = await starte(createHttpApp({ registry: null, info, config: aus }));
      const a = await anfrage(p, { body: rpc('initialize', INIT) });
      const b = await anfrage(p, { method: 'GET', path: '/.well-known/oauth-protected-resource' });
      ok(`Kill-Switch NEXUS_MCP_ENABLED=${wert}: alles 503, ohne Registry`, aus.enabled === false && a.status === 503 && b.status === 503, `${a.status} ${b.status}`);
    }

    // Eigener, optionaler Einstieg: niemand sonst startet ihn.
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    ok('npm-Script mcp:http zeigt auf src/mcp-http.js', pkg.scripts['mcp:http'] === 'node src/mcp-http.js');
    ok('start/mcp/ui starten den HTTP-Einstieg nicht', ['start', 'mcp', 'ui'].every(s => !/mcp-http/.test(pkg.scripts[s])));
    const quellen = ['src/ui-server.js', 'src/server.js', 'src/cli.js', 'src/claude-connect.js', 'src/mcp/build-server.js', 'src/mcp/runtime.js'];
    const tauriDir = join(ROOT, 'src-tauri', 'src');
    if (existsSync(tauriDir)) for (const f of readdirSync(tauriDir)) if (f.endsWith('.rs')) quellen.push('src-tauri/src/' + f);
    if (existsSync(join(ROOT, 'src-tauri', 'tauri.conf.json'))) quellen.push('src-tauri/tauri.conf.json');
    const verweise = quellen.filter(f => /mcp-http|http-app/.test(readFileSync(join(ROOT, f), 'utf8')));
    ok('UI-Server, stdio-Einstieg und Desktop-Shell verweisen nicht auf den HTTP-Einstieg', verweise.length === 0, verweise.join(','));
  }

  // ── 2. Protected-Resource-Metadaten ────────────────────────────────────────
  console.log('2. Metadaten-Endpoint');
  {
    const config = loadHttpConfig(ENV);
    const port = await starte(createHttpApp({ registry, info, config }));
    for (const pfad of ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp']) {
      const m = await anfrage(port, { method: 'GET', path: pfad });
      ok(`GET ${pfad} -> 200, ohne Token`, m.status === 200 && /application\/json/.test(m.headers['content-type'] ?? ''), `${m.status} ${m.text}`);
      ok('  resource = eingetragene URL inkl. Pfad', m.json?.resource === RESOURCE, m.text);
      ok('  authorization_servers = [Issuer]', Array.isArray(m.json?.authorization_servers) && m.json.authorization_servers.join() === ISSUER, m.text);
      ok('  bearer_methods_supported = ["header"]', m.json?.bearer_methods_supported?.join() === 'header', m.text);
    }
    const post = await anfrage(port, { method: 'POST', path: '/.well-known/oauth-protected-resource', body: {} });
    ok('POST auf die Metadaten -> 405', post.status === 405, `${post.status}`);
    const anders = await anfrage(port, { method: 'GET', path: '/.well-known/oauth-protected-resource/anders' });
    ok('fremdes Suffix -> 404', anders.status === 404, `${anders.status}`);
    ok('metadataUrl zeigt auf die Form mit Pfad-Suffix', config.metadataUrl === 'https://mcp.example.com/.well-known/oauth-protected-resource/mcp', config.metadataUrl);
    const wurzel = loadHttpConfig({ ...ENV, NEXUS_MCP_RESOURCE_URL: 'https://mcp.example.com/' });
    ok('Ressource ohne Pfad: nur die Grundform', wurzel.metadataPaths.join() === '/.well-known/oauth-protected-resource', wurzel.metadataPaths.join());

    ok('fehlende Ressourcen-URL -> Start verweigert', /NEXUS_MCP_RESOURCE_URL fehlt/.test(wirft({ NEXUS_MCP_ISSUER: ISSUER }) ?? ''));
    ok('fehlender Issuer -> Start verweigert', /NEXUS_MCP_ISSUER fehlt/.test(wirft({ NEXUS_MCP_RESOURCE_URL: RESOURCE }) ?? ''));
    ok('http-Ressource (nicht lokal) -> Start verweigert', /muss https/.test(wirft({ ...ENV, NEXUS_MCP_RESOURCE_URL: 'http://mcp.example.com/mcp' }) ?? ''));
    ok('Ressource mit Query -> Start verweigert', /Query/.test(wirft({ ...ENV, NEXUS_MCP_RESOURCE_URL: RESOURCE + '?x=1' }) ?? ''));
    ok('http auf 127.0.0.1 ist erlaubt (lokale Tests)', wirft({ ...ENV, NEXUS_MCP_RESOURCE_URL: 'http://127.0.0.1:3100/mcp' }) === null);
    ok('Kill-Switch braucht keine weitere Konfiguration', wirft({ NEXUS_MCP_ENABLED: '0' }) === null);
  }
} catch (e) {
  console.error('  \x1b[31m✗ Testlauf-Fehler:\x1b[0m', e.stack || e.message);
  fail++;
} finally {
  for (const f of aufraeumen.reverse()) { try { await f(); } catch {} }
  try { rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
  catch { console.log('  (Hinweis: Scratch-Ordner nicht entfernt – EPERM/WAL, unkritisch)'); }
}

console.log(`\n${fail === 0 ? '\x1b[32m' : '\x1b[31m'}${pass} bestanden, ${fail} Fehler\x1b[0m`);
process.exit(fail === 0 ? 0 : 1);
