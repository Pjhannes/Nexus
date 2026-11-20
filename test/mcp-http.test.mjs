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
import { createHmac, randomUUID } from 'crypto';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildServer } from '../src/mcp/build-server.js';
import { REMOTE_READ_TOOLS } from '../src/mcp/remote-policy.js';
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
function anfrage(port, { method = 'POST', path = '/mcp', headers = {}, body, token } = {}) {
  return new Promise((resolve, reject) => {
    const daten = body === undefined ? null : (typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
    const h = { ...(daten !== null ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(daten) } : {}),
      accept: 'application/json, text/event-stream', ...(token ? { authorization: 'Bearer ' + token } : {}), ...headers };
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
const SUB = '00000000-0000-4000-8000-000000000001';       // erlaubter Benutzer
const SUB_FREMD = '00000000-0000-4000-8000-000000000002'; // echtes Token, aber nicht freigegeben
const KID = 'test-rs256';

// Lokal erzeugtes Schluesselpaar + lokale JWKS (zaehlt die Abrufe -> Cache-Nachweis).
const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true });
const fremd = await generateKeyPair('RS256', { extractable: true }); // gleicher kid, anderer Schluessel
const jwk = { ...(await exportJWK(publicKey)), kid: KID, alg: 'RS256', use: 'sig' };
let jwksAbrufe = 0;
const jwksServer = http.createServer((req, res) => {
  if (req.url !== '/jwks.json') { res.statusCode = 404; return res.end(); }
  jwksAbrufe++;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ keys: [jwk] }));
});
await new Promise(r => jwksServer.listen(0, '127.0.0.1', r));
aufraeumen.push(() => new Promise(r => { jwksServer.closeAllConnections?.(); jwksServer.close(r); }));
const JWKS_URI = `http://127.0.0.1:${jwksServer.address().port}/jwks.json`;

const ENV = {
  NEXUS_MCP_RESOURCE_URL: RESOURCE, NEXUS_MCP_ISSUER: ISSUER,
  NEXUS_MCP_JWKS_URI: JWKS_URI, NEXUS_MCP_ALLOWED_SUBS: SUB,
};

// Access-Token wie vom Aussteller (RFC 9068): typ at+jwt, RS256, aud als Array, Scopes in scp.
// Jeder Parameter laesst sich fuer einen Negativtest einzeln verbiegen.
const jetzt = () => Math.floor(Date.now() / 1000);
function token({ sub = SUB, iss = ISSUER, aud = [RESOURCE], typ = 'at+jwt', key = privateKey, kid = KID,
                 exp = jetzt() + 300, nbf = jetzt() - 10, scp = ['openid', 'offline_access'], claims = {} } = {}) {
  const j = new SignJWT({ scp, client_id: 'test-client', ...claims })
    .setProtectedHeader({ alg: 'RS256', kid, ...(typ ? { typ } : {}) })
    .setIssuedAt(jetzt() - 10).setJti(randomUUID());
  if (iss !== null) j.setIssuer(iss);
  if (aud !== null) j.setAudience(aud);
  if (sub !== null) j.setSubject(sub);
  if (exp !== null) j.setExpirationTime(exp);
  if (nbf !== null) j.setNotBefore(nbf);
  return j.sign(key);
}
const GUT = await token();
const wirft =(env) => { try { loadHttpConfig(env); return null; } catch (e) { return e.message; } };

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
    const init = await anfrage(port, { token: GUT, body: rpc('initialize', INIT) });
    ok('POST /mcp initialize -> 200 JSON', init.status === 200 && /application\/json/.test(init.headers['content-type'] ?? '') && init.json?.result?.serverInfo?.name === 'nexus-test',
      `${init.status} ${init.text}`);
    ok('zustandslos: keine Mcp-Session-Id in der Antwort', init.headers['mcp-session-id'] === undefined);
    const init2 = await anfrage(port, { token: GUT, body: rpc('initialize', INIT) });
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
    const kaputt = await anfrage(port, { token: GUT, body: '{kein json' });
    ok('kaputtes JSON -> 400, kein Stacktrace', kaputt.status === 400 && !/at .*\.js/.test(kaputt.text), `${kaputt.status} ${kaputt.text}`);
    ok('kein X-Powered-By', init.headers['x-powered-by'] === undefined);

    // Kill-Switch
    for (const wert of ['0', 'false', 'off']) {
      const aus = loadHttpConfig({ NEXUS_MCP_ENABLED: wert });
      const p = await starte(createHttpApp({ registry: null, info, config: aus }));
      const a = await anfrage(p, { token: GUT, body: rpc('initialize', INIT) });
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

  // ── 3. Token-Pruefung ──────────────────────────────────────────────────────
  console.log('3. Token-Pruefung');
  {
    const config = loadHttpConfig(ENV);
    const port = await starte(createHttpApp({ registry, info, config }));
    const init = (opt) => anfrage(port, { body: rpc('initialize', INIT), ...opt });
    const META = 'https://mcp.example.com/.well-known/oauth-protected-resource/mcp';
    const ist401 = (r) => r.status === 401 && (r.headers['www-authenticate'] ?? '').startsWith(`Bearer resource_metadata="${META}"`) && !r.json?.result;

    const ohne = await init();
    ok('ohne Token -> 401 + WWW-Authenticate: Bearer resource_metadata="…"', ohne.status === 401 && ohne.headers['www-authenticate'] === `Bearer resource_metadata="${META}"`,
      `${ohne.status} ${ohne.headers['www-authenticate']}`);
    const gut = await init({ token: GUT });
    ok('gueltiges Token -> 200', gut.status === 200 && gut.json?.result?.serverInfo?.name === 'nexus-test', `${gut.status} ${gut.text}`);

    const faelle = [
      ['falsches aud', await token({ aud: ['https://anders.example.com/mcp'] })],
      ['aud nur der Host, ohne Pfad', await token({ aud: ['https://mcp.example.com'] })],
      ['aud fehlt', await token({ aud: null })],
      ['falscher iss', await token({ iss: 'https://boese.example.com' })],
      ['iss mit Schraegstrich am Ende (nicht exakt)', await token({ iss: ISSUER + '/' })],
      ['abgelaufen', await token({ exp: jetzt() - 60 })],
      ['exp fehlt', await token({ exp: null })],
      ['nbf in der Zukunft', await token({ nbf: jetzt() + 600 })],
      ['falsche Signatur (fremder Schluessel, gleiche kid)', await token({ key: fremd.privateKey })],
      ['unbekannte kid', await token({ kid: 'gibt-es-nicht' })],
      ['typ JWT statt at+jwt (z. B. ein ID-Token)', await token({ typ: 'JWT' })],
      ['typ fehlt', await token({ typ: null })],
      ['sub fehlt', await token({ sub: null })],
      ['kein JWT', 'abc.def.ghi'],
    ];
    // alg-Verwechslung: HS256, "signiert" mit dem oeffentlichen Schluessel als Geheimnis.
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const kopf = b64({ alg: 'HS256', typ: 'at+jwt', kid: KID });
    const rumpf = b64({ iss: ISSUER, aud: [RESOURCE], sub: SUB, exp: jetzt() + 300, scp: [] });
    faelle.push(['alg HS256 statt RS256', `${kopf}.${rumpf}.${createHmac('sha256', JSON.stringify(jwk)).update(`${kopf}.${rumpf}`).digest('base64url')}`]);
    faelle.push(['alg none', `${b64({ alg: 'none', typ: 'at+jwt' })}.${rumpf}.`]);
    // manipulierte Nutzlast: gueltige Signatur, anderer sub
    const [k, , sig] = GUT.split('.');
    faelle.push(['Nutzlast nach dem Signieren geaendert', `${k}.${b64({ iss: ISSUER, aud: [RESOURCE], sub: SUB_FREMD, exp: jetzt() + 300 })}.${sig}`]);
    for (const [name, t] of faelle) {
      const r = await init({ token: t });
      ok(`${name} -> 401 invalid_token`, ist401(r) && /error="invalid_token"/.test(r.headers['www-authenticate']), `${r.status} ${r.headers['www-authenticate']} ${r.text}`);
    }
    const basic = await init({ headers: { authorization: 'Basic dXNlcjpwdw==' } });
    ok('Basic statt Bearer -> 401', ist401(basic), `${basic.status}`);
    const query = await anfrage(port, { path: '/mcp?access_token=' + GUT, body: rpc('initialize', INIT) });
    ok('Token in der URL zaehlt nicht -> 401', ist401(query), `${query.status}`);

    const verboten = await init({ token: await token({ sub: SUB_FREMD }) });
    ok('gueltiges Token, sub nicht in der Allowlist -> 403 (kein 401, kein Ergebnis)', verboten.status === 403 && !verboten.json?.result && verboten.headers['www-authenticate'] === undefined,
      `${verboten.status} ${verboten.text}`);
    ok('Fehlerantworten nennen weder Token noch Claims', ![ohne, verboten].some(r => r.text.includes(SUB_FREMD) || r.text.includes('eyJ')), verboten.text);

    ok('JWKS wird gecacht (ein Abruf fuer alle Pruefungen mit bekannter kid)', jwksAbrufe >= 1 && jwksAbrufe <= 2, `Abrufe: ${jwksAbrufe}`);

    // Pflicht-Allowlist + Scopes aus scp
    ok('ohne NEXUS_MCP_ALLOWED_SUBS startet der Server nicht', /NEXUS_MCP_ALLOWED_SUBS fehlt/.test(wirft({ ...ENV, NEXUS_MCP_ALLOWED_SUBS: '' }) ?? ''));
    ok('Allowlist nur aus Kommas/Leerzeichen zaehlt als leer', /NEXUS_MCP_ALLOWED_SUBS fehlt/.test(wirft({ ...ENV, NEXUS_MCP_ALLOWED_SUBS: ' , ,' }) ?? ''));
    ok('ohne NEXUS_MCP_JWKS_URI startet der Server nicht', /NEXUS_MCP_JWKS_URI fehlt/.test(wirft({ ...ENV, NEXUS_MCP_JWKS_URI: '' }) ?? ''));
    const mitScope = loadHttpConfig({ ...ENV, NEXUS_MCP_REQUIRED_SCOPES: 'nexus:read' });
    const pScope = await starte(createHttpApp({ registry, info, config: mitScope }));
    const ohneScope = await anfrage(pScope, { token: GUT, body: rpc('initialize', INIT) });
    ok('Pflicht-Scope fehlt in scp -> 403 insufficient_scope', ohneScope.status === 403 && /error="insufficient_scope", scope="nexus:read"/.test(ohneScope.headers['www-authenticate'] ?? ''),
      `${ohneScope.status} ${ohneScope.headers['www-authenticate']}`);
    const scopeString = await anfrage(pScope, { token: await token({ scp: [], claims: { scope: 'nexus:read' } }), body: rpc('initialize', INIT) });
    ok('scope-String zaehlt nicht – nur der Claim scp (Array)', scopeString.status === 403, `${scopeString.status}`);
    const mitScp = await anfrage(pScope, { token: await token({ scp: ['openid', 'nexus:read'] }), body: rpc('initialize', INIT) });
    ok('Pflicht-Scope in scp -> 200', mitScp.status === 200, `${mitScp.status} ${mitScp.text}`);
    const metaScope = await anfrage(pScope, { method: 'GET', path: '/.well-known/oauth-protected-resource' });
    ok('Metadaten nennen den Pflicht-Scope', metaScope.json?.scopes_supported?.join() === 'nexus:read', metaScope.text);

    // JWKS nicht erreichbar -> 503, nicht 401 (der Client soll sein Token behalten)
    const tot = loadHttpConfig({ ...ENV, NEXUS_MCP_JWKS_URI: 'http://127.0.0.1:1/jwks.json' });
    const pTot = await starte(createHttpApp({ registry, info, config: tot }));
    const r503 = await anfrage(pTot, { token: GUT, body: rpc('initialize', INIT) });
    ok('JWKS nicht erreichbar -> 503 mit Retry-After', r503.status === 503 && r503.headers['retry-after'] !== undefined, `${r503.status} ${r503.text}`);
    const r401 = await anfrage(pTot, { body: rpc('initialize', INIT) });
    ok('  ohne Token trotzdem 401 (kein JWKS-Abruf noetig)', r401.status === 401, `${r401.status}`);
  }

  // ── 4. Policy: nur lesen, nur freigegebene Vaults ──────────────────────────
  console.log('4. Lese-Policy');
  {
    const LESEN = ['search', 'outline', 'read_note', 'read_bild', 'backlinks', 'list_notes', 'query', 'dataview', 'lern_status', 'list_vaults', 'list_trash'];
    ok('REMOTE_READ_TOOLS ist genau die vereinbarte Liste', [...REMOTE_READ_TOOLS].sort().join() === [...LESEN].sort().join(), REMOTE_READ_TOOLS.join());

    // Vollstaendige Tool-Liste des lokalen Servers als Referenz (ohne Policy).
    const [c, s] = InMemoryTransport.createLinkedPair();
    const lokal = new Client({ name: 'referenz', version: '0.0.0' });
    await Promise.all([buildServer({ registry, info }).connect(s), lokal.connect(c)]);
    const alle = (await lokal.listTools()).tools;
    await lokal.close();
    const schreibend = alle.map(t => t.name).filter(n => !LESEN.includes(n));
    ok('Referenz: 23 Tools lokal, davon 12 nicht freigegeben', alle.length === 23 && schreibend.length === 12, `${alle.length}/${schreibend.length}`);
    ok('jedes freigegebene Tool ist lokal als readOnly markiert', LESEN.every(n => alle.find(t => t.name === n)?.annotations?.readOnlyHint === true));
    ok('jedes lokale Tool OHNE readOnlyHint steht nicht auf der Liste', alle.filter(t => t.annotations?.readOnlyHint !== true).every(t => !LESEN.includes(t.name)));

    const config = loadHttpConfig({ ...ENV, NEXUS_MCP_ALLOWED_VAULTS: 'wissen' });
    const port = await starte(createHttpApp({ registry, info, config }));
    const ruf = (name, args = {}, p = port) => anfrage(p, { token: GUT, body: rpc('tools/call', { name, arguments: args }) });
    const text = (r) => (r.json?.result?.content ?? []).filter(x => x.type === 'text').map(x => x.text).join('\n');
    const abgelehnt = (r) => r.json?.error !== undefined || r.json?.result?.isError === true;

    const liste = await anfrage(port, { token: GUT, body: rpc('tools/list') });
    const namen = (liste.json?.result?.tools ?? []).map(t => t.name);
    ok('tools/list (ohne initialize davor): genau die 11 Lese-Tools', liste.status === 200 && [...namen].sort().join() === [...LESEN].sort().join(), `${liste.status} ${namen.join()}`);
    ok('tools/list: kein Schreib-Tool sichtbar', schreibend.every(n => !namen.includes(n)), namen.join());
    ok('tools/list: alle gelisteten Tools tragen readOnlyHint', liste.json.result.tools.every(t => t.annotations?.readOnlyHint === true));
    const hinweise = (await anfrage(port, { token: GUT, body: rpc('initialize', INIT) })).json?.result?.instructions ?? '';
    ok('initialize: Hinweistext nennt keine Schreib-Tools', hinweise.length > 0 && schreibend.every(n => !new RegExp(`\\b${n}\\b`).test(hinweise)), hinweise);

    // Kein Schreib-Tool aufrufbar – und im Vault aendert sich nichts.
    const abbild = () => ['wissen', 'privat'].map(v => readdirSync(join(scratch, v), { recursive: true }).sort().join('|') + '#' +
      readdirSync(join(scratch, v)).filter(f => f.endsWith('.md')).map(f => readFileSync(join(scratch, v, f), 'utf8')).join('')).join('\n');
    const vorher = abbild();
    const versuche = {
      write_note: { path: 'Neu.md', content: '# Neu\n', create: true },
      append_to_section: { path: 'Notiz.md', section: 'Abschnitt', text: 'angehaengt' },
      patch: { path: 'Notiz.md', patches: [{ old_str: 'Leuchtturm', new_str: 'X' }] },
      write_vortrag: { path: 'Notiz.md', segmente: [{ sprich: 'x', art: 'keine' }] },
      write_karten: { path: 'Notiz.md', karten: [{ typ: 'janein', frage: 'x', antwort: true, quelle: 'Zweiter Teil.' }] },
      karten_gliedern: { path: 'Notiz.md' },
      reindex: {},
      create_folder: { path: 'Ordner' },
      move: { from: 'Notiz.md', to: 'Weg.md' },
      delete: { path: 'Notiz.md' },
      restore: { path: 'Notiz.md' },
      vault_check: {},
    };
    ok('Testfaelle decken alle 12 nicht freigegebenen Tools ab', schreibend.every(n => n in versuche), schreibend.filter(n => !(n in versuche)).join());
    for (const n of schreibend) {
      const r = await ruf(n, versuche[n] ?? {});
      ok(`tools/call ${n} -> abgelehnt`, abgelehnt(r), `${r.status} ${r.text}`);
    }
    ok('nach allen Schreibversuchen ist der Vault unveraendert', abbild() === vorher);

    // Lese-Tools arbeiten – nur im freigegebenen Vault.
    const suche = await ruf('search', { q: 'Leuchtturm' });
    ok('search findet im freigegebenen Vault (Standard-Vault = erster freigegebener, obwohl "privat" aktiv ist)',
      suche.json?.result?.isError !== true && suche.json?.result?.structuredContent?.results?.some(x => x.path === 'Notiz.md'), suche.text);
    const lesen = await ruf('read_note', { path: 'Notiz.md', section: 'Abschnitt' });
    ok('read_note liest einen Abschnitt', text(lesen).includes('Zweiter Teil') && !text(lesen).includes('Leuchtturm'), text(lesen));
    const vaults = await ruf('list_vaults');
    const sc = vaults.json?.result?.structuredContent;
    ok('list_vaults zeigt nur den freigegebenen Vault', sc?.vaults?.map(v => v.name).join() === 'wissen' && sc?.activeVault === 'wissen', JSON.stringify(sc));
    ok('list_vaults nennt keine Server-Pfade', sc?.vaults?.every(v => v.path === '') && sc?.server?.dataDir === '' && !vaults.text.includes(scratch.split(/[\\/]/).pop()), vaults.text);
    for (const [name, args] of [['search', { q: 'Zitronenfalter', vault: 'privat' }], ['read_note', { path: 'Geheim.md', vault: 'privat' }], ['list_notes', { vault: 'privat' }], ['list_trash', { vault: 'privat' }]]) {
      const r = await ruf(name, args);
      ok(`${name} im nicht freigegebenen Vault -> Fehler, kein Inhalt`, r.json?.result?.isError === true && !r.text.includes('Zitronenfalter') && !r.text.includes('Geheim'), r.text);
    }
    const unbekannt = await ruf('search', { q: 'x', vault: 'gibt-es-nicht' });
    ok('gleiche Meldung fuer unbekannten und nicht freigegebenen Vault', /Vault nicht verfuegbar: gibt-es-nicht\. Verfuegbar: wissen/.test(text(unbekannt)), text(unbekannt));
    for (const n of LESEN.filter(x => !['search', 'read_note', 'list_vaults'].includes(x))) {
      const args = { outline: { path: 'Notiz.md' }, backlinks: { path: 'Notiz.md' }, read_bild: { path: 'fehlt.png' }, query: { field: 'status', op: 'exists' }, dataview: { source: 'LIST LIMIT 5' } }[n] ?? {};
      const r = await ruf(n, args);
      ok(`${n} ist aufrufbar (kein Protokollfehler)`, r.status === 200 && r.json?.error === undefined && r.json?.result !== undefined, r.text);
    }
    ok('auch die Lese-Tools haben im Vault nichts veraendert', abbild() === vorher);

    // Standard: kein Vault freigegeben.
    const zu = loadHttpConfig(ENV);
    ok('Standard: NEXUS_MCP_ALLOWED_VAULTS leer', zu.allowedVaults.length === 0);
    const pZu = await starte(createHttpApp({ registry, info, config: zu }));
    const leer = await ruf('list_vaults', {}, pZu);
    ok('ohne Freigabe: list_vaults ist leer', leer.json?.result?.structuredContent?.vaults?.length === 0 && leer.json?.result?.structuredContent?.activeVault === null, leer.text);
    for (const v of [undefined, 'wissen', 'privat']) {
      const r = await ruf('search', { q: 'Leuchtturm', ...(v ? { vault: v } : {}) }, pZu);
      ok(`ohne Freigabe: search (vault=${v ?? 'Standard'}) -> Fehler`, r.json?.result?.isError === true && !r.text.includes('Notiz.md'), r.text);
    }
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
// Kein process.exit(): unter Windows bricht Node sonst mit einer libuv-Assertion ab, solange
// fetch (JWKS-Abruf) noch Verbindungen schliesst. Server und Registry sind zu -> der Prozess endet von selbst.
process.exitCode = fail === 0 ? 0 : 1;
