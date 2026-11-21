// src/mcp/download.js – Download-Links des Remote-Connectors (R31)
//
// Ein Tool-Ergebnis ist Text im Kontext des Modells – eine Datei von mehreren MB kommt so nicht
// beim Nutzer an. Stattdessen gibt datei_link einen kurzlebigen Link zurueck, den der Browser des
// Nutzers direkt abruft: GET /dl/<token>/<dateiname>.
//
// Der Token ist zustandslos: base64url(JSON { v: Vault, p: Pfad, e: Ablauf (s), s: sub }) + "." +
// base64url(HMAC-SHA256(secret, erster Teil)). Wer den Link hat, kann GENAU DIESE Datei bis zum
// Ablauf abrufen (auch mehrfach) – nichts sonst. Vault und Pfad stehen lesbar im Token.
// Bei jedem Abruf wird neu geprueft: Signatur, Ablauf, Vault freigegeben, Pfad im Vault, Groesse.
import { createHmac, timingSafeEqual } from 'crypto';
import { statSync, realpathSync, createReadStream } from 'fs';
import { basename, sep } from 'path';
import { safeFull } from '../paths.js';

export const SECRET_MIN_ZEICHEN = 32;
const b64 = (v) => Buffer.from(v).toString('base64url');

export function makeDownloads({ secret, ttlS, maxBytes, baseUrl }) {
  if (typeof secret !== 'string' || secret.length < SECRET_MIN_ZEICHEN) throw new Error('makeDownloads: secret fehlt oder ist zu kurz');
  const mac = (teil) => createHmac('sha256', secret).update(teil).digest();

  function token({ vault, path, sub = null, now = Date.now() }) {
    const exp = Math.floor(now / 1000) + ttlS;
    const teil = b64(JSON.stringify({ v: vault, p: path, e: exp, s: sub }));
    return { token: teil + '.' + b64(mac(teil)), exp };
  }

  // { ok: true, vault, path, sub, exp } oder { ok: false, grund: 'form' | 'signatur' | 'abgelaufen' }
  function pruefe(tok, now = Date.now()) {
    const m = /^([A-Za-z0-9_-]{1,4000})\.([A-Za-z0-9_-]{43})$/.exec(String(tok ?? ''));
    if (!m) return { ok: false, grund: 'form' };
    const soll = mac(m[1]), ist = Buffer.from(m[2], 'base64url');
    if (ist.length !== soll.length || !timingSafeEqual(ist, soll)) return { ok: false, grund: 'signatur' };
    let d;
    try { d = JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8')); } catch { return { ok: false, grund: 'form' }; }
    if (!d || typeof d.v !== 'string' || typeof d.p !== 'string' || !Number.isInteger(d.e)) return { ok: false, grund: 'form' };
    if (Math.floor(now / 1000) >= d.e) return { ok: false, grund: 'abgelaufen', vault: d.v, path: d.p, sub: d.s ?? null };
    return { ok: true, vault: d.v, path: d.p, sub: typeof d.s === 'string' ? d.s : null, exp: d.e };
  }

  const url = (tok, name) => `${baseUrl}/dl/${tok}/${encodeURIComponent(name)}`;
  return { token, pruefe, url, ttlS, maxBytes };
}

// Darf diese Datei ausgeliefert werden? { full, bytes, name } oder { error }.
// Nur regulaere Dateien im Vault; nichts aus versteckten Ordnern (.trash, .nexus, .git,
// .stversions ...); Symlinks duerfen nicht aus dem Vault hinausfuehren; Groessengrenze.
export function dateiPruefen(vaultPath, rel, maxBytes) {
  if (typeof rel !== 'string' || !rel) return { error: 'path fehlt' };
  const segmente = rel.replace(/\\/g, '/').split('/').filter(s => s && s !== '.');
  if (segmente.some(s => s.startsWith('.'))) return { error: 'Versteckte Dateien und Ordner werden nicht ausgeliefert: ' + rel };
  const full = safeFull(vaultPath, rel);
  if (!full) return { error: 'Pfad ausserhalb des Vaults oder ungueltig: ' + rel };
  let st, echt, wurzel;
  try { st = statSync(full); echt = realpathSync(full); wurzel = realpathSync(vaultPath); } catch { return { error: 'Datei nicht gefunden: ' + rel }; }
  if (!st.isFile()) return { error: 'Keine Datei: ' + rel };
  if (echt !== wurzel && !echt.startsWith(wurzel + sep)) return { error: 'Pfad ausserhalb des Vaults oder ungueltig: ' + rel };
  if (st.size > maxBytes) return { error: `Datei zu gross fuer einen Download-Link (${st.size} Bytes, Limit ${maxBytes}): ${rel}` };
  return { full, bytes: st.size, name: basename(full) };
}

// Lesestrom ueber GENAU die gepruefte Groesse: waechst die Datei zwischen Pruefung und Auslieferung,
// gehen trotzdem nur die geprueften Bytes hinaus (passend zu Content-Length und zum Limit).
// Leere Datei -> null (createReadStream kennt kein Ende vor dem Anfang); der Aufrufer beendet
// die Antwort dann ohne Inhalt.
export function dateiStrom(full, bytes) {
  return bytes > 0 ? createReadStream(full, { start: 0, end: bytes - 1 }) : null;
}

// Content-Disposition mit ASCII-Rueckfall und UTF-8-Namen (RFC 6266 / RFC 5987).
export function contentDisposition(name) {
  const ascii = name.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
  const utf8 = encodeURIComponent(name).replace(/['()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  return `attachment; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}
