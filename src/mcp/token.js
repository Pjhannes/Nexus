// src/mcp/token.js – Pruefung der Bearer-Tokens des Remote-Connectors (R30)
//
// Erwartet ein JWT-Access-Token nach RFC 9068 (Header typ "at+jwt", RS256), signiert vom
// konfigurierten Autorisierungsserver. Geprueft wird LOKAL gegen dessen JWKS (mit Cache):
//   Signatur · alg = RS256 (nichts anderes, kein "none"/HS256) · typ = at+jwt
//   iss zeichengenau · aud enthaelt die Ressourcen-URL · exp · nbf
//   sub steht in der Allowlist  (Pflicht – ohne Allowlist startet der Server nicht)
// Scopes stehen im Claim "scp" (Array) – einen scope-String gibt es beim Aussteller nicht.
//
// Ergebnis statt Exception:
//   { ok: true, sub, scopes, clientId }
//   { ok: false, status: 401 | 403 | 503, error, grund }   grund = Kurzcode fuers Log, nie der Token
import { createRemoteJWKSet, jwtVerify, errors } from 'jose';

const UHR_TOLERANZ_S = 5;

export function makeTokenVerifier({ issuer, resource, jwksUri, allowedSubs = [], requiredScopes = [] }) {
  if (!issuer || !resource || !jwksUri) throw new Error('makeTokenVerifier: issuer, resource und jwksUri sind Pflicht');
  const erlaubt = new Set(allowedSubs);
  if (erlaubt.size === 0) throw new Error('makeTokenVerifier: leere sub-Allowlist');
  // Cache: Schluessel 10 min halten; unbekannte kid -> hoechstens alle 30 s neu laden (Schluesselwechsel).
  const jwks = createRemoteJWKSet(new URL(jwksUri), { cacheMaxAge: 10 * 60_000, cooldownDuration: 30_000, timeoutDuration: 5_000 });

  return async function verify(token) {
    if (!token) return { ok: false, status: 401, error: null, grund: 'kein_token' };
    let payload;
    try {
      ({ payload } = await jwtVerify(token, jwks, {
        issuer, audience: resource, algorithms: ['RS256'], typ: 'at+jwt',
        requiredClaims: ['exp', 'sub'], clockTolerance: UHR_TOLERANZ_S,
      }));
    } catch (e) {
      // JWKS nicht erreichbar ist KEIN ungueltiges Token: 503, damit der Client sein Token behaelt.
      const jwksProblem = e instanceof errors.JWKSTimeout || !(e instanceof errors.JOSEError) || e.code === 'ERR_JOSE_GENERIC';
      if (jwksProblem) return { ok: false, status: 503, error: 'temporarily_unavailable', grund: 'jwks_nicht_erreichbar' };
      return { ok: false, status: 401, error: 'invalid_token', grund: (e.code || 'ERR') + (e.claim ? ':' + e.claim : '') };
    }
    const sub = typeof payload.sub === 'string' ? payload.sub : '';
    const scopes = Array.isArray(payload.scp) ? payload.scp.filter(s => typeof s === 'string') : [];
    if (!sub) return { ok: false, status: 401, error: 'invalid_token', grund: 'sub_fehlt' };
    if (!erlaubt.has(sub)) return { ok: false, status: 403, error: 'forbidden', grund: 'sub_nicht_erlaubt', sub };
    const fehlend = requiredScopes.filter(s => !scopes.includes(s));
    if (fehlend.length) return { ok: false, status: 403, error: 'insufficient_scope', grund: 'scope_fehlt', sub };
    return { ok: true, sub, scopes, clientId: typeof payload.client_id === 'string' ? payload.client_id : null };
  };
}

// "Authorization: Bearer <token>" -> Token oder null. Nur der Header zaehlt (kein Query, kein Body).
export function bearerToken(header) {
  const m = /^Bearer[ ]+([A-Za-z0-9\-._~+/]+=*)$/i.exec(String(header ?? '').trim());
  return m ? m[1] : null;
}
