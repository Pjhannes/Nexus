// src/mcp/audit.js – Audit-Log des Remote-Connectors (R31)
//
// EINE JSON-Zeile je Aufruf eines nicht nur lesenden Tools (und je Download-Link/-Abruf):
//   zeit, sub, client, tool, vault, pfad, nach, ergebnis (ok | fehler), fehler, hashVorher, hash
// Keine Inhalte: weder Notiztext noch Patches. Die Datei liegt AUSSERHALB der Vaults
// (NEXUS_MCP_AUDIT_LOG) – im Vault wuerde jede Zeile synchronisiert und indexiert.
//
// Fail-closed: pruefe() wird VOR einem Schreib-Tool aufgerufen. Ist das Log nicht beschreibbar,
// wird nicht geschrieben – eine Aenderung ohne Audit-Zeile soll es nicht geben.
import { appendFileSync, mkdirSync } from 'fs';
import { dirname, resolve, sep } from 'path';

const einzeilig = (v, max = 200) => (typeof v === 'string' && v ? v.replace(/\s+/g, ' ').slice(0, max) : undefined);

export function makeAudit(pfad) {
  if (!pfad) return null;
  const datei = resolve(pfad);
  const pruefe = () => { appendFileSync(datei, ''); };
  mkdirSync(dirname(datei), { recursive: true });
  pruefe();   // schon beim Start: ein nicht beschreibbares Log ist ein Konfigurationsfehler
  return {
    pfad: datei,
    pruefe,
    schreibe({ sub = null, client = null, tool, vault = null, pfad: p, nach, ergebnis, fehler, hashVorher, hash }) {
      appendFileSync(datei, JSON.stringify({
        zeit: new Date().toISOString(), sub, client, tool, vault,
        pfad: einzeilig(p, 300) ?? null, nach: einzeilig(nach, 300),
        ergebnis, fehler: einzeilig(fehler), hashVorher, hash,
      }) + '\n');
    },
  };
}

// Liegt datei in (oder auf) einem der Ordner? Fuer die Pruefung "Audit-Log nicht im Vault".
export function liegtIn(datei, ordner = []) {
  const d = resolve(datei);
  return ordner.some(o => { const r = resolve(o); return d === r || d.startsWith(r + sep); });
}

// Aus einem Tool-Ergebnis die Felder fuers Audit lesen (Ergebnistext ist JSON, Fehler sind Klartext).
export function auditFelder(args = {}, ergebnis) {
  const text = ergebnis?.content?.find?.(c => c.type === 'text')?.text ?? '';
  if (ergebnis?.isError) return { ergebnis: 'fehler', fehler: text, vault: args.vault ?? null, pfad: args.path ?? args.from, nach: args.to };
  let j = {};
  try { const p = JSON.parse(text); if (p && typeof p === 'object') j = p; } catch { /* kein JSON – nur ok */ }
  const s = (v) => (typeof v === 'string' ? v : undefined);
  return {
    ergebnis: 'ok', vault: s(j.vault) ?? args.vault ?? null,
    pfad: args.path ?? args.from ?? s(j.path), nach: args.to ?? s(j.trashed),
    hashVorher: j.hashVorher === null ? null : s(j.hashVorher), hash: s(j.hash),
  };
}
