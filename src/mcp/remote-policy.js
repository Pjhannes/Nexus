// src/mcp/remote-policy.js – was der Remote-Connector darf (R30: nur lesen)
//
// Die Policy steht im Code und in der Server-Konfiguration – NICHT im Token: ein Token sagt
// nur, WER anfragt. Zwei Sperren, beide muessen passen:
//   1. Tools:  feste Namensliste UND readOnlyHint. Ein Tool, das hier nicht steht, wird fuer
//              HTTP-Server gar nicht registriert – es fehlt in tools/list und ist nicht aufrufbar.
//   2. Vaults: Allowlist aus NEXUS_MCP_ALLOWED_VAULTS (Standard: keiner). Die Registry wird als
//              eingeschraenkte SICHT uebergeben; nicht freigegebene Vaults existieren fuer die
//              Tools nicht (auch nicht als Standard-Vault und nicht in list_vaults).

export const REMOTE_READ_TOOLS = Object.freeze([
  'search', 'outline', 'read_note', 'read_bild', 'backlinks', 'list_notes',
  'query', 'dataview', 'lern_status', 'list_vaults', 'list_trash',
]);

export function readOnlyPolicy() {
  const namen = new Set(REMOTE_READ_TOOLS);
  return { allow: (name, { annotations } = {}) => namen.has(name) && annotations?.readOnlyHint === true };
}

// Sicht auf die Registry, die nur freigegebene Vaults kennt.
export function restrictRegistry(registry, allowedVaults = []) {
  const erlaubt = new Set(allowedVaults);
  const sichtbar = () => registry.list().vaults.filter(v => erlaubt.has(v.name));
  // Standard-Vault: der in der Config aktive, wenn freigegeben – sonst der erste freigegebene.
  const standard = () => {
    const l = registry.list();
    if (l.activeVault && erlaubt.has(l.activeVault) && l.vaults.some(v => v.name === l.activeVault)) return l.activeVault;
    return l.vaults.find(v => erlaubt.has(v.name))?.name ?? null;
  };
  return {
    get(name) {
      const n = name ?? standard();
      const da = sichtbar().map(v => v.name);
      if (!n) throw new Error('Fuer den Remote-Zugriff ist kein Vault freigegeben.');
      // Gleiche Meldung fuer "gibt es nicht" und "nicht freigegeben" – kein Ausforschen von Namen.
      if (!da.includes(n)) throw new Error(`Vault nicht verfuegbar: ${n}. Verfuegbar: ${da.join(', ') || '(keine)'}`);
      return registry.get(n);
    },
    list() {
      const aktiv = standard();
      // Kein Dateisystem-Pfad des Servers nach aussen.
      return { activeVault: aktiv, vaults: sichtbar().map(v => ({ ...v, path: '', active: v.name === aktiv })) };
    },
    config: () => registry.config(),
    entries: () => registry.entries().filter(e => erlaubt.has(e.vault.name)),
    refresh: () => registry.refresh(),
    size: () => sichtbar().length,
  };
}

// Kurzfassung der Server-Hinweise fuer den Lesezugriff (die lokale Fassung nennt Schreib-Tools).
export const REMOTE_INSTRUCTIONS = [
  'Lesezugriff auf persoenliche Wissens-Vaults ueber die Nexus-Tools',
  `(${REMOTE_READ_TOOLS.join(', ')}). Schreiben ist ueber diese Verbindung nicht moeglich.`,
  'list_vaults zeigt die freigegebenen Vaults; jedes Tool hat einen optionalen vault-Parameter.',
  'Prinzip: maximale Information pro Token – erst search oder outline, dann read_note mit section',
  'oder lines; nicht blind ganze Notizen lesen. Listen mit limit/offset blaettern.',
  'Fehler kommen als Tool-Fehler (isError) mit Klartext – Ursache lesen, nicht blind wiederholen.',
].join(' ');
