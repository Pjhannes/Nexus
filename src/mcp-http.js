// src/mcp-http.js – MCP-Einstieg ueber HTTP (Remote-Connector, R30). Start: npm run mcp:http
//
// EIGENER, OPTIONALER Einstieg: weder die Desktop-App noch src/ui-server.js starten ihn.
// Nur Transport + Prozess: die App baut src/mcp/http-app.js, die Tools src/mcp/build-server.js.
// Konfiguration ausschliesslich ueber Umgebungsvariablen (docs/remote-connector.md).
import { loadHttpConfig } from './mcp/http-config.js';
import { createHttpApp } from './mcp/http-app.js';

const log = (m) => console.error('[Nexus-MCP-HTTP] ' + m);

let config;
try { config = loadHttpConfig(process.env); }
catch (e) { log('Start abgebrochen – ' + e.message); process.exit(1); }

let registry = null, info = { name: 'nexus' };
if (config.enabled) {
  // Erst hier laden: bei abgeschaltetem Zugriff wird kein Vault geoeffnet und kein Index gebaut.
  const rt = await import('./mcp/runtime.js');
  info = rt.serverInfo();
  registry = rt.createRegistry({ log });
  log(config.allowedVaults.length
    ? 'Freigegebene Vaults: ' + config.allowedVaults.join(', ')
    : 'WARNUNG: NEXUS_MCP_ALLOWED_VAULTS ist leer – kein Vault ist erreichbar.');
} else {
  log('NEXUS_MCP_ENABLED=0 – Zugriff abgeschaltet, jede Anfrage bekommt 503.');
}

const http = createHttpApp({ registry, info, config }).listen(config.port, config.bind, () => {
  log(`v${info.version ?? '?'} lauscht auf ${config.bind}:${http.address().port}`);
});
http.on('error', (e) => { log('Start abgebrochen – ' + e.message); process.exit(1); });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { http.close(); try { registry?.close(); } catch {} process.exit(0); });
