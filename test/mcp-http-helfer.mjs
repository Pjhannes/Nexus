// test/mcp-http-helfer.mjs – gemeinsamer Aufbau fuer Tests des HTTP-Einstiegs (R31).
//
// Scratch-Vaults + Registry, Express-App auf einem freien Loopback-Port, rohe HTTP-Anfragen,
// lokal erzeugtes RSA-Schluesselpaar + lokale JWKS. Nur Platzhalter (example.com).
// (test/mcp-http.test.mjs aus R30 bringt seinen Aufbau selbst mit und bleibt unveraendert.)
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import http from 'http';
import { randomUUID } from 'crypto';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { createHttpApp } from '../src/mcp/http-app.js';
import { makeVaultRegistry } from '../src/vault-registry.js';
import { buildIndexer } from '../src/indexer.js';
import { makeTools } from '../src/tools.js';

export const RESOURCE = 'https://mcp.example.com/mcp';
export const ISSUER = 'https://auth.example.com';
export const SUB = '00000000-0000-4000-8000-000000000001';
const KID = 'test-rs256';

export async function aufbau(praefix = 'nexus-mcp-http-') {
  const scratch = mkdtempSync(join(tmpdir(), praefix));
  const aufraeumen = [];

  // Zwei Vaults: "wissen" (wird freigegeben) und "privat" (nie freigegeben).
  const vaults = [];
  for (const [name, datei, inhalt] of [
    ['wissen', 'Notiz.md', '# Notiz\n\nDer Connector findet das Wort Leuchtturm.\n\n## Abschnitt\n\nZweiter Teil.\n'],
    ['wissen', '_System/Regeln.md', '# Regeln\n\nBleibt.\n'],
    ['privat', 'Geheim.md', '# Geheim\n\nNur lokal: Zitronenfalter.\n'],
  ]) {
    const dir = join(scratch, name);
    mkdirSync(join(dir, datei, '..'), { recursive: true });
    writeFileSync(join(dir, datei), inhalt, 'utf8');
    if (!vaults.some(v => v.name === name)) vaults.push({ name, path: dir });
  }
  const cfgPath = join(scratch, 'nexus.config.json');
  writeFileSync(cfgPath, JSON.stringify({ activeVault: 'privat', vaults, ignore: ['.trash', '.nexus'] }), 'utf8');
  const registry = makeVaultRegistry({
    configPath: cfgPath,
    loadConfig: () => JSON.parse(readFileSync(cfgPath, 'utf8')),
    resolveDbPath: (v) => join(scratch, v.name + '.db'),
    buildIndexer, makeTools,
  });
  aufraeumen.push(() => registry.close());

  const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true });
  const jwk = { ...(await exportJWK(publicKey)), kid: KID, alg: 'RS256', use: 'sig' };
  const jwksServer = http.createServer((req, res) => {
    if (req.url !== '/jwks.json') { res.statusCode = 404; return res.end(); }
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ keys: [jwk] }));
  });
  await new Promise(r => jwksServer.listen(0, '127.0.0.1', r));
  aufraeumen.push(() => new Promise(r => { jwksServer.closeAllConnections?.(); jwksServer.close(r); }));

  const ENV = {
    NEXUS_MCP_RESOURCE_URL: RESOURCE, NEXUS_MCP_ISSUER: ISSUER,
    NEXUS_MCP_JWKS_URI: `http://127.0.0.1:${jwksServer.address().port}/jwks.json`,
    NEXUS_MCP_ALLOWED_SUBS: SUB, NEXUS_MCP_ALLOWED_VAULTS: 'wissen',
  };
  const jetzt = () => Math.floor(Date.now() / 1000);
  const token = ({ sub = SUB } = {}) => new SignJWT({ scp: ['openid'], client_id: 'test-client' })
    .setProtectedHeader({ alg: 'RS256', kid: KID, typ: 'at+jwt' })
    .setIssuedAt(jetzt() - 10).setJti(randomUUID()).setIssuer(ISSUER).setAudience([RESOURCE]).setSubject(sub)
    .setExpirationTime(jetzt() + 300).setNotBefore(jetzt() - 10).sign(privateKey);
  const GUT = await token();

  const logZeilen = [];
  const info = { name: 'nexus-test', version: '9.9.9', gitCommit: null, buildDate: null, dataDir: scratch, dev: true };
  const baueApp = (config) => createHttpApp({ registry, info, config, log: (z) => logZeilen.push(z) });
  async function starte(app) {
    const server = http.createServer(app);
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    aufraeumen.push(() => new Promise(r => { server.closeAllConnections?.(); server.close(r); }));
    return server.address().port;
  }
  // Rohe Anfrage; die Antwort gibt es als Text (utf8) und als Buffer (Downloads).
  function anfrage(port, { method = 'POST', path = '/mcp', headers = {}, body, token: t } = {}) {
    return new Promise((resolve, reject) => {
      const daten = body === undefined ? null : (typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
      const h = { ...(daten !== null ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(daten) } : {}),
        host: 'mcp.example.com', accept: 'application/json, text/event-stream', ...(t ? { authorization: 'Bearer ' + t } : {}), ...headers };
      const rq = http.request({ host: '127.0.0.1', port, method, path, headers: h }, (res) => {
        const teile = [];
        res.on('data', d => teile.push(d));
        res.on('end', () => { const buffer = Buffer.concat(teile); const text = buffer.toString('utf8'); let json = null; try { json = JSON.parse(text); } catch {} resolve({ status: res.statusCode, headers: res.headers, text, json, buffer }); });
      });
      rq.on('error', reject);
      if (daten !== null) rq.write(daten);
      rq.end();
    });
  }
  let seq = 0;
  const rpc = (method, params = {}) => ({ jsonrpc: '2.0', id: ++seq, method, params });
  // Tool-Aufruf mit Token; liefert { fehler, text, json (geparster Ergebnistext), roh }.
  const rufer = (port) => async (name, args = {}) => {
    const r = await anfrage(port, { token: GUT, body: rpc('tools/call', { name, arguments: args }) });
    const text = (r.json?.result?.content ?? []).filter(x => x.type === 'text').map(x => x.text).join('\n');
    let json = null; try { json = JSON.parse(text); } catch {}
    return { fehler: r.json?.error !== undefined || r.json?.result?.isError === true, protokollFehler: r.json?.error !== undefined, text, json, roh: r };
  };
  const toolNamen = async (port) => ((await anfrage(port, { token: GUT, body: rpc('tools/list') })).json?.result?.tools ?? []).map(t => t.name);
  const schliessen = async () => {
    for (const f of aufraeumen.reverse()) { try { await f(); } catch {} }
    try { rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {}
  };
  const vaultPfad = (name, ...rel) => join(scratch, name, ...rel);
  return { scratch, ENV, GUT, token, registry, logZeilen, baueApp, starte, anfrage, rpc, rufer, toolNamen, schliessen, vaultPfad };
}
