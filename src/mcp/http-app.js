// src/mcp/http-app.js – Express-App des Remote-Connectors (R30), ohne listen()
//
// createHttpApp({ registry, info, config }) liefert die App; src/mcp-http.js haengt nur den
// Port an. So laeuft die ganze Kette im Test im selben Prozess (test/mcp-http.test.mjs).
//
// Zustandslos: JEDE Anfrage bekommt einen frischen McpServer + Transport aus buildServer();
// Registry und Index gibt es genau einmal pro Prozess. Keine Session-ID, keine SSE-Streams –
// die Antwort ist ein JSON-Dokument (enableJsonResponse).
import express from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { buildServer } from './build-server.js';

export const BODY_LIMIT_BYTES = 2 * 1024 * 1024;

// JSON-RPC-Fehler ohne Bezug auf eine Anfrage-ID (Transport-/Zugangsebene).
const rpcFehler = (res, status, message, code = -32000) =>
  res.status(status).json({ jsonrpc: '2.0', error: { code, message }, id: null });

export function createHttpApp({ registry, info = {}, config }) {
  if (!config) throw new Error('createHttpApp: config fehlt');
  const app = express();
  app.disable('x-powered-by');
  app.disable('etag');

  // Kill-Switch: nichts ausliefern, keinen Vault anfassen.
  if (!config.enabled) {
    app.use((req, res) => rpcFehler(res, 503, 'Nexus-Remote-Zugriff ist abgeschaltet.'));
    return app;
  }
  if (!registry || typeof registry.get !== 'function') throw new Error('createHttpApp: registry fehlt');

  // Bis die Lese-Policy steht, ist KEIN Tool freigegeben.
  const policy = { allow: () => false };

  // OAuth Protected Resource Metadata (RFC 9728) – oeffentlich, sagt dem Client nur, WO er sich
  // anmelden muss. Enthaelt nichts ausser der eigenen Adresse und der des Autorisierungsservers.
  const metadaten = {
    resource: config.resource,
    authorization_servers: [config.issuer],
    bearer_methods_supported: ['header'],
  };
  app.all(config.metadataPaths, (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.set('Allow', 'GET'); return res.status(405).json({ error: 'method_not_allowed' }); }
    res.set('Cache-Control', 'public, max-age=300');
    return res.json(metadaten);
  });

  // Nur POST: kein SSE-Stream (GET) und keine Sitzung, die man beenden koennte (DELETE).
  app.all('/mcp', (req, res, next) => {
    if (req.method === 'POST') return next();
    res.set('Allow', 'POST');
    return rpcFehler(res, 405, 'Method not allowed – dieser Server ist zustandslos und nimmt nur POST an.');
  });

  app.post('/mcp', express.json({ limit: BODY_LIMIT_BYTES, type: () => true }), async (req, res) => {
    const server = buildServer({ registry, policy, info });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => {
      transport.close().catch(() => {});
      server.close().catch(() => {});
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (e) {
      console.error('[Nexus-MCP-HTTP] Fehler in /mcp: ' + (e?.message || e));
      if (!res.headersSent) rpcFehler(res, 500, 'Interner Fehler.', -32603);
    }
  });

  app.use((req, res) => res.status(404).json({ error: 'not_found' }));

  // Fehler aus Middleware (kaputtes JSON, zu grosser Body) – nie einen Stacktrace ausliefern.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (res.headersSent) return;
    if (err?.type === 'entity.too.large') return rpcFehler(res, 413, 'Anfrage zu gross.');
    if (err?.type === 'entity.parse.failed') return rpcFehler(res, 400, 'Parse error: kein gueltiges JSON.', -32700);
    console.error('[Nexus-MCP-HTTP] ' + (err?.message || err));
    return rpcFehler(res, 500, 'Interner Fehler.', -32603);
  });

  return app;
}
