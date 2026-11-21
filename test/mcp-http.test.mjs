// test/mcp-http.test.mjs – R30: HTTP-Einstieg des Remote-Connectors (src/mcp/http-app.js).
//
// Alles im selben Prozess: Scratch-Vault + Registry, die Express-App auf einem freien
// Loopback-Port, rohe HTTP-Anfragen ueber node:http (damit auch der Host-Header frei setzbar ist).
// Tokens: lokal erzeugtes RSA-Schluesselpaar + lokale JWKS auf einem Loopback-Port.
// In Tests und Doku nur example.com – keine echten Domains/IDs (Abschnitt 6c prueft das).
//
// Wo die Pflichtfaelle stehen:
//   ohne Token, falsches aud, falscher iss, abgelaufen, falsche Signatur, sub nicht erlaubt -> 3
//   falscher Host -> 5 · GET -> 405 -> 1 · Metadaten-Endpoint -> 2
//   erfolgreicher tools/list und search -> 4 (roh), 6a (SDK-Client), 6b (echter Prozess)
//   kein Schreib-Tool sichtbar oder aufrufbar -> 4
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
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { spawn } from 'child_process';
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
    ['wissen', 'Gross.md', '# Gross\n\n' + 'Murmeltier schlaeft lange. '.repeat(400) + '\n'],
    ['privat', 'Geheim.md', '# Geheim\n\nNur lokal: Zitronenfalter.\n'],
  ]) {
    const dir = join(scratch, name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, datei), inhalt, 'utf8');
    if (!vaults.some(v => v.name === name)) vaults.push({ name, path: dir });
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
      host: 'mcp.example.com', accept: 'application/json, text/event-stream', ...(token ? { authorization: 'Bearer ' + token } : {}), ...headers };
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

// Aufruf-Log der App landet hier statt auf stdout.
const logZeilen = [];
const baueApp = (config, reg = registry) => createHttpApp({ registry: reg, info, config, log: (z) => logZeilen.push(z) });
let registry = null;

const info = { name: 'nexus-test', version: '9.9.9', gitCommit: null, buildDate: null, dataDir: scratch, dev: true };

try {
  registry = baueRegistry();

  // ── 1. HTTP-Einstieg ───────────────────────────────────────────────────────
  console.log('1. HTTP-Einstieg');
  {
    const config = loadHttpConfig(ENV);
    ok('Standard: eingeschaltet, Port 3100, Bind nur Loopback', config.enabled === true && config.port === 3100 && config.bind === '127.0.0.1', JSON.stringify(config));
    ok('ungueltiger Port -> Konfigurationsfehler', /NEXUS_MCP_PORT/.test(wirft({ ...ENV, NEXUS_MCP_PORT: 'abc' }) ?? ''));

    const port = await starte(baueApp(config));
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
      const p = await starte(baueApp(aus, null));
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
    const port = await starte(baueApp(config));
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
    const port = await starte(baueApp(config));
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
    const pScope = await starte(baueApp(mitScope));
    const ohneScope = await anfrage(pScope, { token: GUT, body: rpc('initialize', INIT) });
    ok('Pflicht-Scope fehlt in scp -> 403 insufficient_scope', ohneScope.status === 403 && /error="insufficient_scope", scope="nexus:read"/.test(ohneScope.headers['www-authenticate'] ?? ''),
      `${ohneScope.status} ${ohneScope.headers['www-authenticate']}`);
    const scopeString = await anfrage(pScope, { token: await token({ scp: [], claims: { scope: 'nexus:read' } }), body: rpc('initialize', INIT) });
    ok('scope-String zaehlt nicht – nur der Claim scp (Array)', scopeString.status === 403, `${scopeString.status}`);
    const mitScp = await anfrage(pScope, { token: await token({ scp: ['openid', 'nexus:read'] }), body: rpc('initialize', INIT) });
    ok('Pflicht-Scope in scp -> 200', mitScp.status === 200, `${mitScp.status} ${mitScp.text}`);
    const metaScope = await anfrage(pScope, { method: 'GET', path: '/.well-known/oauth-protected-resource' });
    ok('Metadaten nennen den Pflicht-Scope', metaScope.json?.scopes_supported?.join() === 'nexus:read', metaScope.text);

    ok('  und die 401-Challenge ebenfalls (Pflicht-Scopes zaehlen zu den angebotenen)',
      (await anfrage(pScope, { body: rpc('initialize', INIT) })).headers['www-authenticate'] === `Bearer resource_metadata="${META}", scope="nexus:read"`);

    // Angebotene Scopes (NEXUS_MCP_SCOPES_SUPPORTED): Metadaten + 401-Challenge, ohne Pflicht
    const std = loadHttpConfig(ENV);
    ok('Standard: keine Scopes angeboten', std.scopesSupported.length === 0 && std.requiredScopes.length === 0);
    const metaStd = await anfrage(port, { method: 'GET', path: '/.well-known/oauth-protected-resource' });
    ok('Standard: Metadaten ohne scopes_supported', metaStd.status === 200 && !('scopes_supported' in metaStd.json), metaStd.text);
    ok('Standard: 401-Challenge ohne scope=', !/scope=/.test(ohne.headers['www-authenticate']) && !/scope=/.test((await init({ token: 'abc.def.ghi' })).headers['www-authenticate']));
    const angebot = loadHttpConfig({ ...ENV, NEXUS_MCP_SCOPES_SUPPORTED: 'openid, offline_access  openid' });
    ok('Liste: Komma oder Leerzeichen, ohne Doppelte, Reihenfolge bleibt', angebot.scopesSupported.join() === 'openid,offline_access', angebot.scopesSupported.join());
    const pA = await starte(baueApp(angebot));
    const metaA = await anfrage(pA, { method: 'GET', path: '/.well-known/oauth-protected-resource/mcp' });
    ok('Metadaten: scopes_supported = konfigurierte Liste', metaA.json?.scopes_supported?.join() === 'openid,offline_access', metaA.text);
    const a401 = await anfrage(pA, { body: rpc('initialize', INIT) });
    ok('401 ohne Token: scope="…" in der Challenge', a401.status === 401 && a401.headers['www-authenticate'] === `Bearer resource_metadata="${META}", scope="openid offline_access"`, a401.headers['www-authenticate']);
    const aUng = await anfrage(pA, { token: await token({ exp: jetzt() - 60 }), body: rpc('initialize', INIT) });
    ok('401 ungueltiges Token: scope="…" und error="invalid_token"', aUng.headers['www-authenticate'] === `Bearer resource_metadata="${META}", scope="openid offline_access", error="invalid_token"`, aUng.headers['www-authenticate']);
    const aGut = await anfrage(pA, { token: await token({ scp: [] }), body: rpc('initialize', INIT) });
    ok('angebotene Scopes sind keine Pflicht: Token ohne sie -> 200', aGut.status === 200, `${aGut.status}`);
    const beides = loadHttpConfig({ ...ENV, NEXUS_MCP_SCOPES_SUPPORTED: 'openid', NEXUS_MCP_REQUIRED_SCOPES: 'nexus:read' });
    ok('angeboten + Pflicht: Vereinigung', beides.scopesSupported.join() === 'openid,nexus:read', beides.scopesSupported.join());
    ok('Scope mit Anfuehrungszeichen -> Start verweigert (landet in einem Header)', /NEXUS_MCP_SCOPES_SUPPORTED enthaelt ungueltige/.test(wirft({ ...ENV, NEXUS_MCP_SCOPES_SUPPORTED: 'a"b' }) ?? ''));
    ok('Scope mit Backslash -> Start verweigert', /ungueltige Scope-Namen/.test(wirft({ ...ENV, NEXUS_MCP_REQUIRED_SCOPES: 'a\\b' }) ?? ''));

    // JWKS nicht erreichbar -> 503, nicht 401 (der Client soll sein Token behalten)
    const tot = loadHttpConfig({ ...ENV, NEXUS_MCP_JWKS_URI: 'http://127.0.0.1:1/jwks.json' });
    const pTot = await starte(baueApp(tot));
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
    ok('Referenz: 24 Tools lokal, davon 13 nicht freigegeben', alle.length === 24 && schreibend.length === 13, `${alle.length}/${schreibend.length}`);
    ok('jedes freigegebene Tool ist lokal als readOnly markiert', LESEN.every(n => alle.find(t => t.name === n)?.annotations?.readOnlyHint === true));
    ok('jedes lokale Tool OHNE readOnlyHint steht nicht auf der Liste', alle.filter(t => t.annotations?.readOnlyHint !== true).every(t => !LESEN.includes(t.name)));

    const config = loadHttpConfig({ ...ENV, NEXUS_MCP_ALLOWED_VAULTS: 'wissen' });
    const port = await starte(baueApp(config));
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
      capture: { text: 'schnell notiert' },
    };
    ok('Testfaelle decken alle 13 nicht freigegebenen Tools ab', schreibend.every(n => n in versuche), schreibend.filter(n => !(n in versuche)).join());
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
    const pZu = await starte(baueApp(zu));
    const leer = await ruf('list_vaults', {}, pZu);
    ok('ohne Freigabe: list_vaults ist leer', leer.json?.result?.structuredContent?.vaults?.length === 0 && leer.json?.result?.structuredContent?.activeVault === null, leer.text);
    for (const v of [undefined, 'wissen', 'privat']) {
      const r = await ruf('search', { q: 'Leuchtturm', ...(v ? { vault: v } : {}) }, pZu);
      ok(`ohne Freigabe: search (vault=${v ?? 'Standard'}) -> Fehler`, r.json?.result?.isError === true && !r.text.includes('Notiz.md'), r.text);
    }
  }

  // ── 5. Haertung ────────────────────────────────────────────────────────────
  console.log('5. Haertung');
  {
    const config = loadHttpConfig({ ...ENV, NEXUS_MCP_ALLOWED_VAULTS: 'wissen' });
    const port = await starte(baueApp(config));
    const init = (opt = {}) => anfrage(port, { token: GUT, body: rpc('initialize', INIT), ...opt });
    const ruf = (name, args = {}, p = port) => anfrage(p, { token: GUT, body: rpc('tools/call', { name, arguments: args }) });
    const text = (r) => (r.json?.result?.content ?? []).filter(x => x.type === 'text').map(x => x.text).join('\n');
    const letzte = () => JSON.parse(logZeilen.at(-1));

    // Host-Allowlist
    ok('Standard-Host = Host der Ressourcen-URL', config.allowedHosts.join() === 'mcp.example.com', config.allowedHosts.join());
    for (const host of ['boese.example.com', '127.0.0.1', 'mcp.example.com.boese.example.com', 'mcp.example.com:8443']) {
      logZeilen.length = 0;
      const r = await init({ headers: { host } });
      ok(`falscher Host ${host} -> 403, trotz gueltigem Token`, r.status === 403 && !r.json?.result, `${r.status} ${r.text}`);
      ok('  im Log als host_abgelehnt, ohne sub', logZeilen.length === 1 && letzte().ergebnis === 'host_abgelehnt' && letzte().sub === null, logZeilen.join());
    }
    const metaFremd = await anfrage(port, { method: 'GET', path: '/.well-known/oauth-protected-resource', headers: { host: 'boese.example.com' } });
    ok('falscher Host gilt auch fuer die Metadaten', metaFremd.status === 403, `${metaFremd.status}`);
    const gross = await init({ headers: { host: 'MCP.Example.COM' } });
    ok('Host-Vergleich ohne Gross-/Kleinschreibung', gross.status === 200, `${gross.status}`);
    const mehr = loadHttpConfig({ ...ENV, NEXUS_MCP_ALLOWED_HOSTS: 'Intern.example.com:3100, mcp.example.com' });
    ok('NEXUS_MCP_ALLOWED_HOSTS ersetzt den Standard (kleingeschrieben)', mehr.allowedHosts.join() === 'intern.example.com:3100,mcp.example.com', mehr.allowedHosts.join());

    // Origin
    const fremderOrigin = await init({ headers: { origin: 'https://boese.example.com' } });
    ok('fremder Origin -> 403', fremderOrigin.status === 403 && letzte().ergebnis === 'origin_abgelehnt', `${fremderOrigin.status}`);
    const nullOrigin = await init({ headers: { origin: 'null' } });
    ok('Origin "null" -> 403', nullOrigin.status === 403, `${nullOrigin.status}`);
    const eigener = await init({ headers: { origin: 'https://mcp.example.com' } });
    ok('eigener Origin -> 200', eigener.status === 200, `${eigener.status}`);
    ok('ohne Origin (Server-zu-Server) -> 200', (await init()).status === 200);
    const mitOrigin = loadHttpConfig({ ...ENV, NEXUS_MCP_ALLOWED_ORIGINS: 'https://werkzeug.example.com' });
    const pO = await starte(baueApp(mitOrigin));
    const zus = await anfrage(pO, { token: GUT, body: rpc('initialize', INIT), headers: { origin: 'https://werkzeug.example.com' } });
    ok('NEXUS_MCP_ALLOWED_ORIGINS gibt weitere Origins frei', zus.status === 200, `${zus.status}`);

    // Body-Limit 2 MB
    const riesig = JSON.stringify(rpc('tools/call', { name: 'search', arguments: { q: 'x'.repeat(2 * 1024 * 1024 + 10) } }));
    const zuGross = await anfrage(port, { token: GUT, body: riesig });
    ok('Body ueber 2 MB -> 413', zuGross.status === 413 && letzte().ergebnis === 'body_zu_gross', `${zuGross.status} ${zuGross.text.slice(0, 100)}`);
    const knapp = await anfrage(port, { token: GUT, body: JSON.stringify(rpc('tools/call', { name: 'search', arguments: { q: 'Leuchtturm', tag: 'y'.repeat(1024 * 1024) } })) });
    ok('Body unter 2 MB wird angenommen', knapp.status === 200, `${knapp.status}`);
    const stapel = await anfrage(port, { token: GUT, body: [rpc('tools/list'), rpc('tools/list')] });
    ok('JSON-RPC-Batch -> 400', stapel.status === 400 && stapel.json?.error?.code === -32600, `${stapel.status} ${stapel.text}`);

    // Groessenlimit je Tool-Antwort
    ok('Standard-Antwortlimit 512 KiB', config.maxResponseBytes === 512 * 1024);
    ok('Antwortlimit unter 1024 -> Konfigurationsfehler', /NEXUS_MCP_MAX_RESPONSE_BYTES/.test(wirft({ ...ENV, NEXUS_MCP_MAX_RESPONSE_BYTES: '10' }) ?? ''));
    const eng = loadHttpConfig({ ...ENV, NEXUS_MCP_ALLOWED_VAULTS: 'wissen', NEXUS_MCP_MAX_RESPONSE_BYTES: '2048' });
    const pEng = await starte(baueApp(eng));
    const grosseNotiz = await ruf('read_note', { path: 'Gross.md' }, pEng);
    ok('Antwort ueber dem Limit -> Tool-Fehler mit Ausweg statt Inhalt', grosseNotiz.json?.result?.isError === true && /Antwort zu gross \(\d+ Bytes, Limit 2048\)/.test(text(grosseNotiz)) && !grosseNotiz.text.includes('Murmeltier'),
      grosseNotiz.text.slice(0, 300));
    ok('  im Log als zu_gross', letzte().ergebnis === 'zu_gross' && letzte().tool === 'read_note' && letzte().pfad === 'Gross.md', logZeilen.at(-1));
    const kleinerTeil = await ruf('read_note', { path: 'Gross.md', lines: 1 }, pEng);
    ok('derselbe Aufruf enger gefasst (lines) geht durch', kleinerTeil.json?.result?.isError !== true && text(kleinerTeil).includes('# Gross'), kleinerTeil.text.slice(0, 200));
    const normal = await ruf('read_note', { path: 'Gross.md' });
    ok('mit Standardlimit kommt die Notiz ganz', text(normal).includes('Murmeltier'), normal.text.slice(0, 100));

    // Aufruf-Log: eine Zeile je Aufruf, ohne Inhalte
    logZeilen.length = 0;
    await ruf('search', { q: 'Leuchtturm', vault: 'wissen' });
    ok('eine Logzeile je Aufruf', logZeilen.length === 1, logZeilen.join('\n'));
    let z = letzte();
    ok('Logzeile: Zeit, sub, Tool, Ergebnis', !Number.isNaN(Date.parse(z.zeit)) && z.sub === SUB && z.methode === 'tools/call' && z.tool === 'search' && z.vault === 'wissen' && z.ergebnis === 'ok' && z.status === 200,
      logZeilen.at(-1));
    ok('Logzeile hat genau die vereinbarten Felder', Object.keys(z).sort().join() === 'ergebnis,methode,ms,pfad,status,sub,tool,vault,zeit', Object.keys(z).join());
    ok('Suchbegriff steht NICHT im Log', !logZeilen.at(-1).includes('Leuchtturm'), logZeilen.at(-1));
    await ruf('read_note', { path: 'Notiz.md' });
    z = letzte();
    ok('Logzeile nennt den Pfad, aber keinen Notiztext', z.pfad === 'Notiz.md' && z.tool === 'read_note' && !logZeilen.at(-1).includes('Connector findet'), logZeilen.at(-1));
    await ruf('list_notes', { prefix: 'Uni/' });
    ok('list_notes: prefix als Pfad', letzte().pfad === 'Uni/', logZeilen.at(-1));
    await ruf('dataview', { source: 'LIST FROM "Geheimes Projekt"' });
    ok('dataview: Abfrage steht nicht im Log', !logZeilen.at(-1).includes('Geheimes Projekt') && letzte().tool === 'dataview', logZeilen.at(-1));
    await ruf('read_note', { path: 'gibt-es-nicht.md' });
    ok('Tool-Fehler -> ergebnis tool_fehler', letzte().ergebnis === 'tool_fehler', logZeilen.at(-1));
    await ruf('write_note', { path: 'Neu.md', content: 'streng geheimer Inhalt', create: true });
    ok('nicht freigegebenes Tool -> tool_abgelehnt, Inhalt nicht im Log', letzte().ergebnis === 'tool_abgelehnt' && letzte().tool === 'write_note' && !logZeilen.at(-1).includes('geheimer'), logZeilen.at(-1));
    await ruf('read_note', { path: 42 });
    ok('ungueltige Argumente -> aufruf_fehler, Pfad nur als Text', letzte().ergebnis === 'aufruf_fehler' && letzte().pfad === null, logZeilen.at(-1));
    await anfrage(port, { token: GUT, body: rpc('tools/list') });
    ok('tools/list: Methode im Log, kein Tool', letzte().methode === 'tools/list' && letzte().tool === null && letzte().ergebnis === 'ok', logZeilen.at(-1));
    await anfrage(port, { body: rpc('tools/list') });
    ok('ohne Token: sub null, ergebnis kein_token', letzte().sub === null && letzte().ergebnis === 'kein_token' && letzte().status === 401, logZeilen.at(-1));
    await anfrage(port, { token: await token({ exp: jetzt() - 60 }), body: rpc('tools/list') });
    ok('abgelaufenes Token: Grund im Log, sub nicht (ungeprueft)', letzte().sub === null && letzte().ergebnis === 'ERR_JWT_EXPIRED:exp', logZeilen.at(-1));
    await anfrage(port, { token: await token({ sub: SUB_FREMD }), body: rpc('tools/list') });
    ok('nicht erlaubter sub: steht im Log (Signatur war echt)', letzte().sub === SUB_FREMD && letzte().ergebnis === 'sub_nicht_erlaubt' && letzte().status === 403, logZeilen.at(-1));
    const davor = logZeilen.length;
    await anfrage(port, { method: 'GET', path: '/.well-known/oauth-protected-resource' });
    ok('Metadaten-Abruf erzeugt keine Logzeile', logZeilen.length === davor);
    ok('keine Logzeile enthaelt ein Token', logZeilen.every(l => !l.includes('eyJ') && !/Bearer/i.test(l)));
    ok('jede Logzeile ist einzeiliges JSON', logZeilen.every(l => !l.includes('\n') && typeof JSON.parse(l) === 'object'));
    await ruf('read_note', { path: 'Zeile1\nZeile2.md' });
    ok('Zeilenumbruch im Pfad bricht die Logzeile nicht', !logZeilen.at(-1).includes('\n') && letzte().pfad === 'Zeile1\nZeile2.md');

    // /healthz: ohne Token, ohne Host-Pruefung, ohne Vault-Informationen
    logZeilen.length = 0;
    const hz = await anfrage(port, { method: 'GET', path: '/healthz', headers: { host: '127.0.0.1:3100' } });
    ok('GET /healthz -> 200 ohne Token, auch mit fremdem Host (Healthcheck ueber localhost)', hz.status === 200 && hz.json?.status === 'ok', `${hz.status} ${hz.text}`);
    ok('/healthz verraet nichts: genau {"status":"ok"}', hz.text === '{"status":"ok"}' && !/wissen|privat|9\.9\.9|example/.test(hz.text + JSON.stringify(hz.headers)), hz.text + JSON.stringify(hz.headers));
    const hzOrigin = await anfrage(port, { method: 'GET', path: '/healthz', headers: { origin: 'https://boese.example.com' } });
    ok('/healthz setzt keine CORS-Header (fremde Seiten koennen die Antwort nicht lesen)', hzOrigin.status === 200 && hzOrigin.headers['access-control-allow-origin'] === undefined);
    const hzPost = await anfrage(port, { method: 'POST', path: '/healthz', body: {} });
    ok('POST /healthz -> 405', hzPost.status === 405 && hzPost.headers.allow === 'GET', `${hzPost.status}`);
    ok('/healthz erzeugt keine Logzeile', logZeilen.length === 0, logZeilen.join());
    const nachbar = await anfrage(port, { method: 'GET', path: '/healthz/x', headers: { host: '127.0.0.1:3100' } });
    ok('die Ausnahme gilt nur fuer /healthz selbst (Nachbarpfad mit fremdem Host -> 403)', nachbar.status === 403, `${nachbar.status}`);
    const pAus = await starte(baueApp(loadHttpConfig({ NEXUS_MCP_ENABLED: '0' }), null));
    const hzAus = await anfrage(pAus, { method: 'GET', path: '/healthz' });
    ok('/healthz bei NEXUS_MCP_ENABLED=0 -> 503', hzAus.status === 503, `${hzAus.status}`);

    const kopf = await init();
    ok('Antwort-Header: nosniff + no-store', kopf.headers['x-content-type-options'] === 'nosniff' && kopf.headers['cache-control'] === 'no-store', JSON.stringify(kopf.headers));
  }

  // ── 6. Ende-zu-Ende: echter MCP-Client, echter Prozess ─────────────────────
  console.log('6. Ende-zu-Ende');
  {
    // 6a. SDK-Client ueber Streamable HTTP (so spricht auch ein Connector): initialize,
    //     notifications/initialized, tools/list, tools/call – alles mit Bearer-Token.
    const srv = http.createServer();
    await new Promise(r => srv.listen(0, '127.0.0.1', r));
    aufraeumen.push(() => new Promise(r => { srv.closeAllConnections?.(); srv.close(r); }));
    const p = srv.address().port;
    srv.on('request', baueApp(loadHttpConfig({ ...ENV, NEXUS_MCP_ALLOWED_VAULTS: 'wissen', NEXUS_MCP_ALLOWED_HOSTS: `127.0.0.1:${p}` })));
    const verbinde = async (kopf) => {
      const client = new Client({ name: 'mcp-http-e2e', version: '0.0.0' });
      await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${p}/mcp`), { requestInit: { headers: kopf } }));
      return client;
    };
    const client = await verbinde({ Authorization: 'Bearer ' + GUT });
    ok('SDK-Client verbindet sich (initialize + initialized)', client.getServerVersion()?.name === 'nexus-test', JSON.stringify(client.getServerVersion()));
    const tools = (await client.listTools()).tools.map(t => t.name).sort();
    ok('SDK-Client: tools/list liefert die 11 Lese-Tools', tools.join() === [...REMOTE_READ_TOOLS].sort().join(), tools.join());
    const treffer = await client.callTool({ name: 'search', arguments: { q: 'Leuchtturm' } });
    ok('SDK-Client: search liefert den Treffer (structuredContent besteht das outputSchema)', treffer.isError !== true && treffer.structuredContent?.results?.[0]?.path === 'Notiz.md', JSON.stringify(treffer).slice(0, 300));
    const gliederung = await client.callTool({ name: 'outline', arguments: { path: 'Notiz.md' } });
    ok('SDK-Client: outline', gliederung.isError !== true && JSON.stringify(gliederung.content).includes('Abschnitt'), JSON.stringify(gliederung).slice(0, 300));
    let schreibFehler = null;
    try { const r = await client.callTool({ name: 'write_note', arguments: { path: 'E2E.md', content: 'x', create: true } }); if (r.isError) schreibFehler = 'isError'; }
    catch (e) { schreibFehler = e.message; }
    ok('SDK-Client: write_note ist nicht aufrufbar', schreibFehler !== null && !existsSync(join(scratch, 'wissen', 'E2E.md')), String(schreibFehler));
    await client.close();
    let ohneToken = null;
    try { const c = await verbinde({}); await c.close(); } catch (e) { ohneToken = e; }
    ok('SDK-Client ohne Token: Verbindung scheitert (401)', ohneToken !== null && /401|unauthorized/i.test(String(ohneToken?.message ?? ohneToken) + (ohneToken?.code ?? '')), String(ohneToken?.message));

    // 6b. Der echte Einstieg als Prozess: node src/mcp-http.js
    const EINSTIEG = join(ROOT, 'src', 'mcp-http.js');
    const daten = join(scratch, 'daten');
    mkdirSync(daten, { recursive: true });
    writeFileSync(join(daten, 'nexus.config.json'), JSON.stringify({
      vaultsRoot: scratch, activeVault: 'privat',
      vaults: [{ name: 'wissen', path: join(scratch, 'wissen'), dbPath: '.nexus/wissen.db' }, { name: 'privat', path: join(scratch, 'privat'), dbPath: '.nexus/privat.db' }],
      ignore: ['.trash', '.nexus'],
    }), 'utf8');
    // Saubere Umgebung: keine NEXUS_MCP_*-Werte des Entwicklers erben.
    const basisEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('NEXUS_')));
    const starteProzess = (env) => {
      const kind = spawn(process.execPath, [EINSTIEG], { env: { ...basisEnv, NEXUS_DATA_DIR: daten, NEXUS_MCP_PORT: '0', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
      const st = { kind, out: '', err: '', code: undefined };
      kind.stdout.on('data', d => { st.out += d; });
      kind.stderr.on('data', d => { st.err += d; });
      st.ende = new Promise(r => kind.once('exit', (c) => { st.code = c; r(c); }));
      aufraeumen.push(() => { try { kind.kill(); } catch {} return st.ende; });
      return st;
    };
    const wartePort = async (st) => {
      for (let i = 0; i < 300 && st.code === undefined; i++) {
        const m = /lauscht auf 127\.0\.0\.1:(\d+)/.exec(st.err);
        if (m) return Number(m[1]);
        await new Promise(r => setTimeout(r, 50));
      }
      return null;
    };

    const ohneSubs = starteProzess({ ...ENV, NEXUS_MCP_ALLOWED_SUBS: '' });
    const code = await Promise.race([ohneSubs.ende, new Promise(r => setTimeout(() => r('laeuft'), 15000))]);
    ok('Prozess ohne sub-Allowlist startet nicht (Exit 1, nennt die Variable)', code === 1 && /NEXUS_MCP_ALLOWED_SUBS/.test(ohneSubs.err), `code ${code} ${ohneSubs.err.slice(-300)}`);
    ok('  und hat davor keinen Vault geoeffnet', !/indexiert|Lade Vaults/.test(ohneSubs.err), ohneSubs.err.slice(-300));
    const leer = starteProzess({});
    const codeLeer = await Promise.race([leer.ende, new Promise(r => setTimeout(() => r('laeuft'), 15000))]);
    ok('Prozess ganz ohne Konfiguration startet nicht', codeLeer === 1 && /NEXUS_MCP_RESOURCE_URL fehlt/.test(leer.err), `code ${codeLeer} ${leer.err.slice(-300)}`);

    const lauf = starteProzess({ ...ENV, NEXUS_MCP_ALLOWED_VAULTS: 'wissen' });
    const port = await wartePort(lauf);
    ok('Prozess mit vollstaendiger Konfiguration lauscht (nur Loopback)', Number.isInteger(port) && port > 0, lauf.err.slice(-400));
    if (port) {
      const m = await anfrage(port, { method: 'GET', path: '/.well-known/oauth-protected-resource/mcp' });
      ok('Prozess: Metadaten-Endpoint', m.status === 200 && m.json?.resource === RESOURCE, `${m.status} ${m.text}`);
      const kein = await anfrage(port, { body: rpc('tools/list') });
      const h = await anfrage(port, { method: 'GET', path: '/healthz', headers: { host: `127.0.0.1:${port}` } });
      ok('Prozess: /healthz ueber die Loopback-Adresse -> 200', h.status === 200 && h.json?.status === 'ok', `${h.status} ${h.text}`);
      ok('Prozess: ohne Token 401', kein.status === 401 && /resource_metadata=/.test(kein.headers['www-authenticate'] ?? ''), `${kein.status}`);
      const tl = await anfrage(port, { token: GUT, body: rpc('tools/list') });
      ok('Prozess: tools/list mit Token -> 11 Lese-Tools', tl.status === 200 && tl.json?.result?.tools?.length === 11, `${tl.status} ${tl.text.slice(0, 200)}`);
      const su = await anfrage(port, { token: GUT, body: rpc('tools/call', { name: 'search', arguments: { q: 'Leuchtturm' } }) });
      ok('Prozess: search findet im freigegebenen Vault', su.json?.result?.structuredContent?.results?.some(x => x.path === 'Notiz.md'), su.text.slice(0, 300));
      const pr = await anfrage(port, { token: GUT, body: rpc('tools/call', { name: 'read_note', arguments: { path: 'Geheim.md', vault: 'privat' } }) });
      ok('Prozess: nicht freigegebener Vault bleibt zu', pr.json?.result?.isError === true && !pr.text.includes('Zitronenfalter'), pr.text.slice(0, 300));
      await new Promise(r => setTimeout(r, 150));
      const zeilen = lauf.out.trim().split('\n').filter(Boolean);
      ok('Prozess: stdout enthaelt nur JSON-Logzeilen (eine je /mcp-Aufruf)', zeilen.length === 4 && zeilen.every(l => { try { return typeof JSON.parse(l).zeit === 'string'; } catch { return false; } }), lauf.out);
      ok('Prozess: Log nennt sub und Tool, nicht den Suchbegriff', zeilen.some(l => JSON.parse(l).tool === 'search' && JSON.parse(l).sub === SUB) && !lauf.out.includes('Leuchtturm'), lauf.out);
      ok('Prozess: Papierkorb wird beim Start nicht aufgeraeumt (kein Schreibzugriff)', !/Papierkorb/.test(lauf.err), lauf.err.slice(-300));
    }
    lauf.kind.kill();

    const aus = starteProzess({ NEXUS_MCP_ENABLED: '0' });
    const portAus = await wartePort(aus);
    if (portAus) {
      const r = await anfrage(portAus, { token: GUT, body: rpc('tools/list') });
      ok('Prozess mit NEXUS_MCP_ENABLED=0: 503, kein Vault geladen', r.status === 503 && !/indexiert|Lade Vaults/.test(aus.err), `${r.status} ${aus.err.slice(-300)}`);
    } else ok('Prozess mit NEXUS_MCP_ENABLED=0 lauscht', false, aus.err.slice(-300));
    aus.kind.kill();

    // 6c. Keine persoenlichen Werte im Repo: in Code, Test und Doku des Connectors nur example.com.
    const dateien = ['src/mcp-http.js', 'src/mcp/http-app.js', 'src/mcp/http-config.js', 'src/mcp/token.js', 'src/mcp/remote-policy.js', 'test/mcp-http.test.mjs', 'docs/remote-connector.md',
      'src/mcp/audit.js', 'src/mcp/download.js', 'test/mcp-http-write.test.mjs', 'test/mcp-http-helfer.mjs']
      .filter(f => existsSync(join(ROOT, f)));
    const ERLAUBT = /(^|\.)example\.com$|^127\.0\.0\.1$|^localhost$|^claude\.ai$/;
    const funde = [];
    for (const f of dateien) {
      const inhalt = readFileSync(join(ROOT, f), 'utf8');
      for (const m of inhalt.matchAll(/https?:\/\/([A-Za-z0-9.-]+)/g)) if (!ERLAUBT.test(m[1].replace(/\.$/, ''))) funde.push(`${f}: ${m[0]}`);
      // Adressbereiche: nur Dokumentationsnetze (RFC 5737) oder Loopback.
      for (const m of inhalt.matchAll(/\b(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}\/\d{1,2}\b/g)) if (!['192.0.2', '198.51.100', '203.0.113', '127.0.0'].includes(m[1])) funde.push(`${f}: ${m[0]}`);
      // UUIDs: nur die offensichtlichen Test-IDs (0000…).
      for (const m of inhalt.matchAll(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi)) if (!m[0].startsWith('00000000-0000-')) funde.push(`${f}: ${m[0]}`);
    }
    ok(`keine echten Domains, Adressbereiche oder Benutzer-IDs in ${dateien.length} Connector-Dateien`, funde.length === 0, funde.join(' | '));

    // 6d. Doku: jede Umgebungsvariable aus dem Code ist beschrieben (und keine, die es nicht gibt).
    const doku = existsSync(join(ROOT, 'docs', 'remote-connector.md')) ? readFileSync(join(ROOT, 'docs', 'remote-connector.md'), 'utf8') : '';
    const imCode = new Set([...readFileSync(join(ROOT, 'src', 'mcp', 'http-config.js'), 'utf8').matchAll(/NEXUS_MCP_[A-Z_]+/g)].map(m => m[0]));
    const inDoku = new Set([...doku.matchAll(/NEXUS_MCP_[A-Z_]+/g)].map(m => m[0]));
    ok('docs/remote-connector.md beschreibt alle Variablen aus http-config.js', doku.length > 0 && [...imCode].every(v => inDoku.has(v)), [...imCode].filter(v => !inDoku.has(v)).join());
    ok('die Doku nennt keine Variable, die der Code nicht kennt', [...inDoku].every(v => imCode.has(v)), [...inDoku].filter(v => !imCode.has(v)).join());
    ok('die Doku nennt alle freigegebenen Tools', REMOTE_READ_TOOLS.every(t => doku.includes('`' + t + '`')));
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
