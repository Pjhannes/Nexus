// src/mcp/http-config.js – Konfiguration des HTTP-Einstiegs (Remote-Connector, R30)
//
// ALLES kommt aus Umgebungsvariablen – im Repo stehen keine Domains, Issuer, Benutzer-IDs
// oder Adressbereiche. loadHttpConfig(env) ist pur (kein process.env-Zugriff, kein I/O) und
// wirft EINEN Fehler mit allen Problemen: ein unvollstaendig konfigurierter Server startet nicht.
// Beschreibung aller Variablen: docs/remote-connector.md

import { isAbsolute } from 'path';
import { REMOTE_LEVELS } from './remote-policy.js';

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
    // Stufen (R31): "read" gilt immer; "write" und "admin" werden einzeln eingeschaltet.
    // Standard: nur lesen. Welche Tools zu welcher Stufe gehoeren: src/mcp/remote-policy.js.
    const stufen = [...new Set(liste(env.NEXUS_MCP_LEVELS).map(x => x.toLowerCase()))];
    const fremd = stufen.filter(x => !REMOTE_LEVELS.includes(x));
    if (fremd.length) fehler.push(`NEXUS_MCP_LEVELS kennt nur ${REMOTE_LEVELS.join(', ')} (unbekannt: ${fremd.join(', ')})`);
    config.levels = Object.freeze(REMOTE_LEVELS.filter(x => x === 'read' || stufen.includes(x)));
    // Audit-Log (R31): Datei AUSSERHALB der Vaults, eine JSON-Zeile je Schreibaufruf. Pflicht, sobald
    // eine Schreibstufe eingeschaltet ist – ohne Audit-Log startet der Server dann nicht.
    config.auditLog = String(env.NEXUS_MCP_AUDIT_LOG ?? '').trim() || null;
    if (config.auditLog && !isAbsolute(config.auditLog)) fehler.push('NEXUS_MCP_AUDIT_LOG muss ein absoluter Pfad sein');
    if (!config.auditLog && config.levels.length > 1) fehler.push('NEXUS_MCP_AUDIT_LOG fehlt (Pflicht, sobald NEXUS_MCP_LEVELS write oder admin enthaelt)');

    // Haertung: erlaubte Host-Header (Standard: der Host der Ressourcen-URL) und erlaubte
    // Origins (Standard: nur der eigene). Alles andere wird mit 403 abgewiesen.
    const klein = (s) => liste(s).map(x => x.toLowerCase());
    config.allowedHosts = klein(env.NEXUS_MCP_ALLOWED_HOSTS);
    if (config.allowedHosts.length === 0 && resource) config.allowedHosts = [resource.u.host];
    config.allowedOrigins = [...new Set([...(resource ? [resource.u.origin] : []), ...klein(env.NEXUS_MCP_ALLOWED_ORIGINS)])];
    // Groessenlimit je Tool-Antwort in Bytes (serialisiertes Ergebnis inkl. Bilddaten).
    config.maxResponseBytes = ganzzahl(env, 'NEXUS_MCP_MAX_RESPONSE_BYTES', 512 * 1024, 1024, 16 * 1024 * 1024, fehler);
    // Download-Links (R31): eingeschaltet, sobald ein Geheimnis gesetzt ist. Der Link fuehrt auf
    // /dl/<token>/<name> an der Basis-URL (Standard: Ursprung der Ressourcen-URL); deren Host
    // zaehlt automatisch zu den erlaubten Hosts.
    const geheim = String(env.NEXUS_MCP_DOWNLOAD_SECRET ?? '');
    config.download = null;
    if (geheim) {
      if (geheim.length < 32) fehler.push('NEXUS_MCP_DOWNLOAD_SECRET ist zu kurz (mindestens 32 Zeichen)');
      let basis = resource ? resource.u.origin : null;
      if (String(env.NEXUS_MCP_DOWNLOAD_BASE_URL ?? '').trim()) {
        const b = url(env, 'NEXUS_MCP_DOWNLOAD_BASE_URL', fehler);
        if (b) {
          basis = b.u.origin + b.u.pathname.replace(/\/+$/, '');
          if (!config.allowedHosts.includes(b.u.host)) config.allowedHosts.push(b.u.host);
        }
      }
      config.download = Object.freeze({
        secret: geheim, baseUrl: basis,
        ttlS: ganzzahl(env, 'NEXUS_MCP_DOWNLOAD_TTL_S', 300, 30, 3600, fehler),
        maxBytes: ganzzahl(env, 'NEXUS_MCP_DOWNLOAD_MAX_BYTES', 50 * 1024 * 1024, 1024, 1024 * 1024 * 1024, fehler),
      });
    }
    // Optional: Scopes, die im scp-Claim stehen muessen (Standard: keine Scope-Pflicht).
    const scopes = (name) => {
      const l = [...new Set(liste(String(env[name] ?? '').replace(/\s+/g, ',')))];
      // scope-token nach RFC 6749 – die Werte landen in einem HTTP-Header (keine Anfuehrungszeichen o. ae.).
      const kaputt = l.filter(s => !/^[\x21\x23-\x5B\x5D-\x7E]+$/.test(s));
      if (kaputt.length) fehler.push(`${name} enthaelt ungueltige Scope-Namen: ${kaputt.join(' ')}`);
      return l;
    };
    config.requiredScopes = scopes('NEXUS_MCP_REQUIRED_SCOPES');
    // Scopes, die der Client beim Anmelden anfragen soll: erscheinen als scopes_supported in den
    // Metadaten und als scope="…" in der 401-Challenge. Standard: leer – dann fehlen beide Angaben.
    // Pflicht-Scopes gehoeren immer dazu (sonst koennte der Client sie nie anfragen).
    config.scopesSupported = [...new Set([...scopes('NEXUS_MCP_SCOPES_SUPPORTED'), ...config.requiredScopes])];
  }
  if (fehler.length) throw new Error('Konfiguration ungueltig: ' + fehler.join('; '));
  return Object.freeze(config);
}
