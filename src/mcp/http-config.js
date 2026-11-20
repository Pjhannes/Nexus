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

// Lokale Namen duerfen ohne TLS laufen (Tests, Entwicklung) – alles andere nur https.
const LOKAL = new Set(['localhost', '127.0.0.1', '[::1]']);

function url(env, name, fehler) {
  const roh = String(env[name] ?? '').trim();
  if (!roh) { fehler.push(`${name} fehlt`); return null; }
  let u;
  try { u = new URL(roh); } catch { fehler.push(`${name} ist keine URL`); return null; }
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && LOKAL.has(u.hostname))) { fehler.push(`${name} muss https sein`); return null; }
  if (u.search || u.hash || u.username || u.password) { fehler.push(`${name} darf weder Query, Fragment noch Zugangsdaten enthalten`); return null; }
  return { roh, u };
}

export const WELL_KNOWN = '/.well-known/oauth-protected-resource';

export function loadHttpConfig(env = {}) {
  const fehler = [];
  const config = {
    // Kill-Switch: NEXUS_MCP_ENABLED=0 -> der Prozess laeuft, oeffnet aber keinen Vault und
    // beantwortet jede Anfrage mit 503 (kein Neustart-Karussell im Container).
    enabled: !AUS.has(String(env.NEXUS_MCP_ENABLED ?? '1').trim().toLowerCase()),
    port: ganzzahl(env, 'NEXUS_MCP_PORT', 3100, 0, 65535, fehler),
    bind: String(env.NEXUS_MCP_BIND ?? '').trim() || '127.0.0.1',
  };
  // Abgeschaltet braucht es keine weitere Konfiguration – der Kill-Switch wirkt immer.
  if (config.enabled) {
    // Ressourcen-URL: exakt die Adresse, die im Connector-Dialog eingetragen wird (inkl. Pfad).
    // Sie ist zugleich der erwartete aud-Wert der Tokens.
    const resource = url(env, 'NEXUS_MCP_RESOURCE_URL', fehler);
    const issuer = url(env, 'NEXUS_MCP_ISSUER', fehler);
    if (resource) {
      config.resource = resource.roh;
      // RFC 9728: Metadaten unter /.well-known/oauth-protected-resource, bei einer Ressource
      // mit Pfad zusaetzlich mit diesem Pfad als Suffix. Beide Formen werden bedient.
      const suffix = resource.u.pathname === '/' ? '' : resource.u.pathname.replace(/\/+$/, '');
      config.metadataPaths = [...new Set([WELL_KNOWN, WELL_KNOWN + suffix])];
      config.metadataUrl = resource.u.origin + WELL_KNOWN + suffix;
    }
    if (issuer) config.issuer = issuer.roh; // unveraendert: iss wird zeichengenau verglichen

    // Token-Pruefung: JWKS des Issuers + Pflicht-Allowlist der Benutzer (sub-Claim).
    // Ohne Allowlist kein Start – "jeder mit gueltigem Token" ist nie die Absicht.
    const jwks = url(env, 'NEXUS_MCP_JWKS_URI', fehler);
    if (jwks) config.jwksUri = jwks.roh;
    config.allowedSubs = liste(env.NEXUS_MCP_ALLOWED_SUBS);
    if (config.allowedSubs.length === 0) fehler.push('NEXUS_MCP_ALLOWED_SUBS fehlt (Pflicht: erlaubte sub-Werte, kommagetrennt)');
    // Freigegebene Vaults (Namen aus nexus.config.json). Standard: KEINER – ohne diese Variable
    // laeuft der Server, liefert aber aus keinem Vault etwas.
    config.allowedVaults = liste(env.NEXUS_MCP_ALLOWED_VAULTS);

    // Haertung: erlaubte Host-Header (Standard: der Host der Ressourcen-URL) und erlaubte
    // Origins (Standard: nur der eigene). Alles andere wird mit 403 abgewiesen.
    const klein = (s) => liste(s).map(x => x.toLowerCase());
    config.allowedHosts = klein(env.NEXUS_MCP_ALLOWED_HOSTS);
    if (config.allowedHosts.length === 0 && resource) config.allowedHosts = [resource.u.host];
    config.allowedOrigins = [...new Set([...(resource ? [resource.u.origin] : []), ...klein(env.NEXUS_MCP_ALLOWED_ORIGINS)])];
    // Groessenlimit je Tool-Antwort in Bytes (serialisiertes Ergebnis inkl. Bilddaten).
    config.maxResponseBytes = ganzzahl(env, 'NEXUS_MCP_MAX_RESPONSE_BYTES', 512 * 1024, 1024, 16 * 1024 * 1024, fehler);
    // Optional: Scopes, die im scp-Claim stehen muessen (Standard: keine Scope-Pflicht).
    config.requiredScopes = liste(String(env.NEXUS_MCP_REQUIRED_SCOPES ?? '').replace(/\s+/g, ','));
  }
  if (fehler.length) throw new Error('Konfiguration ungueltig: ' + fehler.join('; '));
  return Object.freeze(config);
}

export { liste as _liste, ganzzahl as _ganzzahl };
