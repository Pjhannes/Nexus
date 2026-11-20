// src/mcp/http-config.js – Konfiguration des HTTP-Einstiegs (Remote-Connector, R30)
//
// ALLES kommt aus Umgebungsvariablen – im Repo stehen keine Domains, Issuer, Benutzer-IDs
// oder Adressbereiche. loadHttpConfig(env) ist pur (kein process.env-Zugriff, kein I/O) und
// wirft EINEN Fehler mit allen Problemen: ein unvollstaendig konfigurierter Server startet nicht.
// Beschreibung aller Variablen: docs/remote-connector.md

const AUS = new Set(['0', 'false', 'off', 'no']);

const liste = (s) => String(s ?? '').split(',').map(x => x.trim()).filter(Boolean);

function ganzzahl(env, name, def, min, max, fehler) {
  const roh = env[name];
  if (roh === undefined || String(roh).trim() === '') return def;
  const n = Number(roh);
  if (!Number.isInteger(n) || n < min || n > max) { fehler.push(`${name} muss eine ganze Zahl von ${min} bis ${max} sein`); return def; }
  return n;
}

export function loadHttpConfig(env = {}) {
  const fehler = [];
  const config = {
    // Kill-Switch: NEXUS_MCP_ENABLED=0 -> der Prozess laeuft, oeffnet aber keinen Vault und
    // beantwortet jede Anfrage mit 503 (kein Neustart-Karussell im Container).
    enabled: !AUS.has(String(env.NEXUS_MCP_ENABLED ?? '1').trim().toLowerCase()),
    port: ganzzahl(env, 'NEXUS_MCP_PORT', 3100, 0, 65535, fehler),
    bind: String(env.NEXUS_MCP_BIND ?? '').trim() || '127.0.0.1',
  };
  if (fehler.length) throw new Error('Konfiguration ungueltig: ' + fehler.join('; '));
  return Object.freeze(config);
}

export { liste as _liste, ganzzahl as _ganzzahl };
