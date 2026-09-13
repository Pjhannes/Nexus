// src/csp.js – R27c: Content-Security-Policy fuer die eigenen HTML-Seiten
// (index.html, lernen.html, help.html, wizard.html, update.html).
//
// Warum hier und nicht nur in tauri.conf.json: Das Hauptfenster laedt http://localhost:PORT
// (WebviewUrl::External), dort greift NUR der HTTP-Header des UI-Servers – Tauris `csp`
// wirkt allein auf Seiten, die ueber das Tauri-Protokoll aus dem gebuendelten frontendDist
// kommen (wizard/update/help-Fallback im Release). Beide Stellen tragen dieselbe Policy
// (CSP_POLICY_TAURI ist die tauri.conf.json-Fassung; test/security.test.mjs haelt sie synchron).
//
// script-src OHNE 'unsafe-inline': Das grosse Inline-<script> von index.html (und die Import-Map)
// bekommen je einen sha256-Hash; das setzt voraus, dass es KEINE Inline-Event-Handler
// (onclick="…") und keine javascript:-URLs mehr gibt (Event-Delegation, R27c Block 1).
// style-src bleibt vorerst 'unsafe-inline': CM6 (style-mod), KaTeX, Mermaid und die Theme-
// Umschaltung setzen <style>-Bloecke bzw. style-Attribute zur Laufzeit – Offen-Punkt in STATUS.md.
// img-src erlaubt https:/http:, weil Notizen externe Bilder einbetten (![](https://…)).
// connect-src traegt ipc:/http://ipc.localhost fuer Tauris IPC (event.listen/emit im Hauptfenster).
import { createHash } from 'node:crypto';

const DIRECTIVES = [
  "default-src 'self'",
  null, // script-src (wird mit Hashes gefuellt)
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https: http:",
  "font-src 'self' data:",
  "media-src 'self' blob: data:",
  "connect-src 'self' ipc: http://ipc.localhost",
  "worker-src 'self' blob:",
  "frame-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
];

/** sha256-Hashes (CSP-Schreibweise) aller Inline-<script>-Bloecke einer HTML-Seite.
 *  FALLE: Der HTML-Parser normalisiert CRLF/CR zu LF, BEVOR er den Skripttext hasht
 *  (Input-Stream-Preprocessing). Die Dateien liegen auf Windows mit CRLF – ohne dieselbe
 *  Normalisierung passt kein einziger Hash (Befund aus der Browser-Pruefung R27c). */
export function inlineScriptHashes(html) {
  const out = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  let m;
  while ((m = re.exec(html))) {
    if (/\bsrc\s*=/i.test(m[1])) continue;            // externe Skripte laufen ueber 'self'
    if (m[2].trim() === '') continue;
    const text = m[2].replace(/\r\n?/g, '\n');
    out.push("'sha256-" + createHash('sha256').update(text, 'utf8').digest('base64') + "'");
  }
  return out;
}

/** Kompletter Header-Wert fuer eine Seite (Hashes der Inline-Skripte eingerechnet). */
export function buildCsp(html) {
  const hashes = inlineScriptHashes(html);
  return DIRECTIVES.map(d => d ?? ["script-src 'self'", ...hashes].join(' ')).join('; ');
}

/** Fassung fuer tauri.conf.json (Tauri haengt die Hashes/Nonces der gebuendelten Seiten selbst an;
 *  zusaetzlich die localhost-Origins des UI-Servers, weil help.html im Fallback dorthin fetch()t). */
export const CSP_POLICY_TAURI = DIRECTIVES
  .map(d => d ?? "script-src 'self'")
  .map(d => d.startsWith('connect-src') ? d + ' http://localhost:3000 http://localhost:3002' : d)
  .join('; ');

/** Header-Wert je Datei, gecacht ueber mtime (index.html aendert sich im Dev laufend). */
const cache = new Map();
export function cspForFile(path, readFile, mtimeMs) {
  const hit = cache.get(path);
  if (hit && hit.mtimeMs === mtimeMs) return hit.value;
  const value = buildCsp(readFile(path));
  cache.set(path, { mtimeMs, value });
  return value;
}
