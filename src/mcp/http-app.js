// src/mcp/http-app.js – Express-App des Remote-Connectors (R30), ohne listen()
//
// createHttpApp({ registry, info, config, log }) liefert die App; src/mcp-http.js haengt nur den
// Port an. So laeuft die ganze Kette im Test im selben Prozess (test/mcp-http.test.mjs).
//
// Zustandslos: JEDE Anfrage bekommt einen frischen McpServer + Transport aus buildServer();
// Registry und Index gibt es genau einmal pro Prozess. Keine Session-ID, keine SSE-Streams –
// die Antwort ist ein JSON-Dokument (enableJsonResponse).
//
// Reihenfolge der Pruefungen (jede bricht ab, bevor die naechste Arbeit macht):
//   Kill-Switch -> (/healthz) -> Host-Allowlist -> Origin -> Methode -> Token -> Body (max. 2 MB) -> Policy -> Regeln
import express from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { buildServer } from './build-server.js';
import { makeTokenVerifier, bearerToken } from './token.js';
import { remotePolicy, remoteGuard, restrictRegistry, remoteInstructions, REMOTE_READ_TOOLS } from './remote-policy.js';
import { makeAudit, liegtIn, auditFelder } from './audit.js';
import { makeDownloads, dateiPruefen, contentDisposition } from './download.js';
import { createReadStream } from 'fs';

export const BODY_LIMIT_BYTES = 2 * 1024 * 1024;

// JSON-RPC-Fehler ohne Bezug auf eine Anfrage-ID (Transport-/Zugangsebene).
const rpcFehler = (res, status, message, code = -32000) =>
  res.status(status).json({ jsonrpc: '2.0', error: { code, message }, id: null });

// Fuers Log: nur kurze, einzeilige Zeichenketten – nie Objekte, nie Notiztext.
const kurz = (v) => (typeof v === 'string' && v ? v.slice(0, 300) : null);

const stdoutLog = (zeile) => process.stdout.write(zeile + '\n');

export function createHttpApp({ registry, info = {}, config, log = stdoutLog }) {
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

  // Stufen + Regeln + nur freigegebene Vaults (src/mcp/remote-policy.js). Standard: nur lesen.
  // Kein Server-Pfad nach aussen.
  const levels = config.levels ?? ['read'];
  // Download-Links (src/mcp/download.js): nur mit NEXUS_MCP_DOWNLOAD_SECRET – dann gibt es das Tool
  // datei_link und die Route /dl/<token>/<name>.
  const downloads = config.download ? makeDownloads(config.download) : null;
  const policy = remotePolicy({ levels, extra: downloads ? ['datei_link'] : [] });
  const guard = remoteGuard({ levels });
  const sicht = restrictRegistry(registry, config.allowedVaults);
  const identitaet = { ...info, dataDir: '' };
  const freigegeben = new Set(policy.tools);
  const hinweise = remoteInstructions({ tools: policy.tools, levels, download: !!downloads });

  // Audit-Log (src/mcp/audit.js): Pflicht bei Schreibstufen (http-config.js), nie in einem Vault.
  // Erst pruefen, dann anlegen: makeAudit erzeugt Ordner und Datei.
  if (config.auditLog && liegtIn(config.auditLog, registry.entries().map(e => e.vault.path)))
    throw new Error('NEXUS_MCP_AUDIT_LOG liegt in einem Vault – das Audit-Log gehoert ausserhalb der Vaults.');
  const audit = makeAudit(config.auditLog);
  const nurLesend = new Set(REMOTE_READ_TOOLS);
  // Vor dem Aufruf: erst die Regeln, dann (nur fuer aendernde Tools) die Probe aufs Audit-Log.
  const vorAufruf = (name, args) => {
    const r = guard(name, args);
    if (r?.error || nurLesend.has(name) || !audit) return r;
    try { audit.pruefe(); } catch { return { error: 'Audit-Log nicht beschreibbar – Aenderung abgelehnt, nichts geschrieben.' }; }
    return r;
  };
  // Nach dem Aufruf: eine Audit-Zeile je aenderndem Tool (auch bei Fehler oder abgelehnter Regel).
  const auditiere = (req, name, args, ergebnis) => {
    if (!audit || nurLesend.has(name)) return;
    try { audit.schreibe({ sub: req.nexusAuth?.sub, client: req.nexusAuth?.clientId, tool: name, ...auditFelder(args, ergebnis) }); }
    catch (err) { console.error('[Nexus-MCP-HTTP] Audit-Zeile nicht geschrieben: ' + (err?.message || err)); }
  };

  // ── Aufruf-Log: EINE JSON-Zeile je Anfrage – Zeit, sub, Tool, Pfad, Ergebnis. Keine Inhalte:
  // weder Suchbegriffe noch Abfragen, Notiztext, Token oder Header. Die Felder fuellen die
  // Stufen darunter; geschrieben wird, wenn die Antwort raus ist.
  app.use((req, res, next) => {
    const start = Date.now();
    const e = res.locals.log = { sub: null, methode: null, tool: null, vault: null, pfad: null, ergebnis: null, still: false };
    res.on('finish', () => {
      if (e.still) return;
      try {
        log(JSON.stringify({
          zeit: new Date(start).toISOString(), sub: e.sub, methode: e.methode, tool: e.tool, vault: e.vault, pfad: e.pfad,
          ergebnis: e.ergebnis ?? (res.statusCode < 400 ? 'ok' : 'http_' + res.statusCode), status: res.statusCode, ms: Date.now() - start,
        }));
      } catch { /* Logging darf keine Anfrage kippen */ }
    });
    res.set('X-Content-Type-Options', 'nosniff');
    next();
  });

  // ── /healthz: Lebenszeichen fuer Container-Healthcheck und Proxy. Bewusst VOR der Host-
  // Allowlist (der Healthcheck fragt ueber localhost) und ohne Token – dafuer ohne jede
  // Information ueber Vaults, Version oder Konfiguration. Bei Kill-Switch: 503 (siehe oben).
  app.all('/healthz', (req, res) => {
    res.locals.log.still = true;
    res.set('Cache-Control', 'no-store');
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.set('Allow', 'GET'); return res.status(405).json({ error: 'method_not_allowed' }); }
    return res.json({ status: 'ok' });
  });

  // ── Host-Allowlist + Origin (Schutz vor DNS-Rebinding und fremden Webseiten). Anfragen aus
  // Anthropics Cloud tragen keinen Origin; ist einer gesetzt, muss er bekannt sein.
  const hosts = new Set(config.allowedHosts);
  const origins = new Set(config.allowedOrigins);
  app.use((req, res, next) => {
    const host = String(req.headers.host ?? '').toLowerCase();
    if (!hosts.has(host)) { res.locals.log.ergebnis = 'host_abgelehnt'; return res.status(403).json({ error: 'forbidden' }); }
    const origin = req.headers.origin;
    if (origin !== undefined && !origins.has(String(origin).toLowerCase())) { res.locals.log.ergebnis = 'origin_abgelehnt'; return res.status(403).json({ error: 'forbidden' }); }
    next();
  });

  // ── OAuth Protected Resource Metadata (RFC 9728) – oeffentlich, sagt dem Client nur, WO er sich
  // anmelden muss. Enthaelt nichts ausser der eigenen Adresse und der des Autorisierungsservers.
  const metadaten = {
    resource: config.resource,
    authorization_servers: [config.issuer],
    bearer_methods_supported: ['header'],
    ...(config.scopesSupported.length ? { scopes_supported: config.scopesSupported } : {}),
  };
  app.all(config.metadataPaths, (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.set('Allow', 'GET'); return res.status(405).json({ error: 'method_not_allowed' }); }
    res.locals.log.still = true; // oeffentliche Discovery-Abrufe fuellen das Log nicht
    res.set('Cache-Control', 'public, max-age=300');
    return res.json(metadaten);
  });

  // ── /dl/<token>/<name>: Download ueber einen Link aus datei_link. Kein Bearer-Token – der
  // signierte, kurzlebige Token im Pfad IST die Berechtigung (der Browser des Nutzers ruft ab).
  // Immer als Anhang und als Binaerdaten: eine HTML-Datei aus dem Vault wird hier nie ausgefuehrt.
  // Unbekannt/ungueltig -> 404 ohne Begruendung; abgelaufen (Signatur echt) -> 410.
  if (downloads) {
    app.all(['/dl/:token', '/dl/:token/:name'], (req, res) => {
      const e = res.locals.log;
      e.methode = 'download'; e.tool = 'download';
      res.set('Cache-Control', 'no-store');
      res.set('Referrer-Policy', 'no-referrer');
      if (req.method !== 'GET' && req.method !== 'HEAD') { res.set('Allow', 'GET'); return res.status(405).json({ error: 'method_not_allowed' }); }
      const t = downloads.pruefe(req.params.token);
      e.sub = t.sub ?? null; e.vault = kurz(t.vault); e.pfad = kurz(t.path);
      if (!t.ok) {
        e.ergebnis = 'link_' + t.grund;
        return t.grund === 'abgelaufen'
          ? res.status(410).json({ error: 'gone', error_description: 'Der Download-Link ist abgelaufen – bitte einen neuen anfordern.' })
          : res.status(404).json({ error: 'not_found' });
      }
      let d;
      try { d = dateiPruefen(sicht.get(t.vault).vault.path, t.path, downloads.maxBytes); } catch { d = { error: 'vault' }; }
      if (d.error) { e.ergebnis = 'datei_fehlt'; return res.status(404).json({ error: 'not_found' }); }
      res.set({
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': contentDisposition(d.name),
        'Content-Length': String(d.bytes),
        'Content-Security-Policy': "sandbox; default-src 'none'",
      });
      e.ergebnis = 'ok';
      if (audit) { try { audit.schreibe({ sub: t.sub, tool: 'download', vault: t.vault, pfad: t.path, ergebnis: 'ok' }); } catch (err) { console.error('[Nexus-MCP-HTTP] Audit-Zeile nicht geschrieben: ' + (err?.message || err)); } }
      if (req.method === 'HEAD') return res.end();
      const strom = createReadStream(d.full);
      strom.on('error', () => { e.ergebnis = 'lese_fehler'; res.destroy(); });
      strom.pipe(res);
    });
  }

  // ── /mcp: nur POST – kein SSE-Stream (GET) und keine Sitzung, die man beenden koennte (DELETE).
  app.all('/mcp', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (req.method === 'POST') return next();
    res.set('Allow', 'POST');
    return rpcFehler(res, 405, 'Method not allowed – dieser Server ist zustandslos und nimmt nur POST an.');
  });

  // Token-Pruefung VOR dem Body-Parser: ohne gueltiges Token wird kein Byte der Anfrage gelesen.
  // 401 nennt per WWW-Authenticate die Metadaten-URL (RFC 9728) – daran erkennt der Client,
  // wo er sich anmelden muss. 403 = Token echt, aber dieser Benutzer darf nicht.
  const pruefeToken = makeTokenVerifier(config);
  const challenge = (zusatz = '') => `Bearer resource_metadata="${config.metadataUrl}"${zusatz}`;
  // 401: dem Client sagen, welche Scopes er anfragen soll (nur wenn konfiguriert).
  const scopeHinweis = config.scopesSupported.length ? `, scope="${config.scopesSupported.join(' ')}"` : '';
  async function auth(req, res, next) {
    const r = await pruefeToken(bearerToken(req.headers.authorization));
    if (r.ok) { req.nexusAuth = { sub: r.sub, scopes: r.scopes, clientId: r.clientId }; res.locals.log.sub = r.sub; return next(); }
    res.locals.log.sub = r.sub ?? null; // nur gesetzt, wenn die Signatur echt war (403)
    res.locals.log.ergebnis = r.grund;
    if (r.status === 401) {
      res.set('WWW-Authenticate', challenge(scopeHinweis + (r.error ? `, error="${r.error}"` : '')));
      return res.status(401).json({ error: r.error ?? 'unauthorized', error_description: 'Bearer-Token fehlt oder ist ungueltig.' });
    }
    if (r.status === 403) {
      if (r.error === 'insufficient_scope') res.set('WWW-Authenticate', challenge(`, error="insufficient_scope", scope="${config.requiredScopes.join(' ')}"`));
      return res.status(403).json({ error: r.error, error_description: 'Dieses Konto ist fuer den Zugriff nicht freigegeben.' });
    }
    res.set('Retry-After', '30');
    return res.status(503).json({ error: r.error, error_description: 'Token-Pruefung derzeit nicht moeglich.' });
  }

  // Groessenlimit je Tool-Antwort: mobile Kontexte sind knapp, und eine Riesenantwort ist fast
  // immer ein zu weit gefasster Aufruf. Statt der Daten kommt ein Tool-Fehler mit dem Ausweg.
  function begrenze(e) {
    return (name, args, ergebnis) => {
      const bytes = Buffer.byteLength(JSON.stringify(ergebnis ?? null));
      if (bytes > config.maxResponseBytes) {
        e.ergebnis = 'zu_gross';
        return { isError: true, content: [{ type: 'text', text:
          `Antwort zu gross (${bytes} Bytes, Limit ${config.maxResponseBytes}). Enger fassen: read_note mit section oder lines, ` +
          'search/list_notes/query mit kleinerem limit bzw. offset, dataview mit LIMIT.' }] };
      }
      e.ergebnis = ergebnis?.isError ? 'tool_fehler' : 'ok';
      return ergebnis;
    };
  }

  // Tool datei_link (nur mit Download-Konfiguration): Link auf eine Datei des Vaults.
  const dateiLinkTool = (req) => ({ tool, z, registry: reg, antwort, annotations }) => {
    tool('datei_link', {
      title: 'Download-Link',
      description: 'Eine Datei aus dem Vault zum HERUNTERLADEN bereitstellen (HTML, PDF, Excel, Bilder, auch Notizen): liefert einen Link, ' +
        `den der Nutzer im Browser oeffnet. Der Link gilt ${Math.round(downloads.ttlS / 60) || 1} Minuten und nur fuer diese Datei. Die url dem Nutzer unveraendert als Link geben – ` +
        'nicht selbst abrufen. Zum LESEN von Notizen weiter read_note verwenden.',
      input: {
        path:  z.string().describe('Relativer Pfad der Datei im Vault (mit Endung)'),
        vault: z.string().optional().describe('Vault-Name (Standard: der aktive Vault; alle Namen: list_vaults)'),
      },
      annotations: annotations.RO,
    }, ({ path, vault }) => {
      const e = reg.get(vault);
      const d = dateiPruefen(e.vault.path, path, downloads.maxBytes);
      if (d.error) return antwort.fail(`[${e.vault.name}] ${d.error}`);
      const rel = path.replace(/\\/g, '/');
      const { token, exp } = downloads.token({ vault: e.vault.name, path: rel, sub: req.nexusAuth?.sub ?? null });
      return antwort.asJson({ vault: e.vault.name, path: rel, bytes: d.bytes, url: downloads.url(token, d.name), gueltigBis: new Date(exp * 1000).toISOString() });
    });
  };

  app.post('/mcp', (req, res, next) => auth(req, res, next).catch(next), express.json({ limit: BODY_LIMIT_BYTES, type: () => true }), async (req, res) => {
    const e = res.locals.log;
    const msg = req.body;
    // Genau EINE JSON-RPC-Nachricht je Anfrage (Batches gibt es seit MCP 2025-06-18 nicht mehr).
    if (!msg || typeof msg !== 'object' || Array.isArray(msg)) { e.ergebnis = 'kein_einzelaufruf'; return rpcFehler(res, 400, 'Invalid Request: genau eine JSON-RPC-Nachricht erwartet.', -32600); }
    e.methode = kurz(msg.method);
    if (msg.method === 'tools/call') {
      const a = msg.params?.arguments ?? {};
      e.tool = kurz(msg.params?.name);
      e.vault = kurz(a.vault);
      e.pfad = kurz(a.path) ?? kurz(a.from) ?? kurz(a.prefix);
      // Vorbelegung, falls der Aufruf das Tool nie erreicht (nicht freigegeben / ungueltige Argumente).
      e.ergebnis = freigegeben.has(msg.params?.name) ? 'aufruf_fehler' : 'tool_abgelehnt';
    }
    const grenze = begrenze(e);
    const nachAufruf = (name, args, ergebnis) => { auditiere(req, name, args, ergebnis); return grenze(name, args, ergebnis); };
    const server = buildServer({ registry: sicht, policy, info: identitaet, instructions: hinweise, onResult: nachAufruf, onCall: vorAufruf,
      erweitern: downloads ? dateiLinkTool(req) : null });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => {
      transport.close().catch(() => {});
      server.close().catch(() => {});
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, msg);
    } catch (err) {
      console.error('[Nexus-MCP-HTTP] Fehler in /mcp: ' + (err?.message || err));
      if (!res.headersSent) rpcFehler(res, 500, 'Interner Fehler.', -32603);
    }
  });

  app.use((req, res) => res.status(404).json({ error: 'not_found' }));

  // Fehler aus Middleware (kaputtes JSON, zu grosser Body) – nie einen Stacktrace ausliefern.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (res.headersSent) return;
    if (err?.type === 'entity.too.large') { res.locals.log.ergebnis = 'body_zu_gross'; return rpcFehler(res, 413, 'Anfrage zu gross (max. 2 MB).'); }
    if (err?.type === 'entity.parse.failed') return rpcFehler(res, 400, 'Parse error: kein gueltiges JSON.', -32700);
    console.error('[Nexus-MCP-HTTP] ' + (err?.message || err));
    return rpcFehler(res, 500, 'Interner Fehler.', -32603);
  });

  return app;
}
