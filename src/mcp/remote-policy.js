// src/mcp/remote-policy.js – was der Remote-Connector darf (R30: lesen, R31: Stufen)
//
// Die Policy steht im Code und in der Server-Konfiguration – NICHT im Token: ein Token sagt
// nur, WER anfragt. Drei Sperren, alle muessen passen:
//   1. Tools:  feste Namenslisten je Stufe. Ein Tool, das zu keiner eingeschalteten Stufe gehoert,
//              wird fuer HTTP-Server gar nicht registriert – es fehlt in tools/list und ist nicht
//              aufrufbar. Lese-Tools muessen zusaetzlich readOnlyHint tragen.
//   2. Vaults: Allowlist aus NEXUS_MCP_ALLOWED_VAULTS (Standard: keiner). Die Registry wird als
//              eingeschraenkte SICHT uebergeben; nicht freigegebene Vaults existieren fuer die
//              Tools nicht (auch nicht als Standard-Vault und nicht in list_vaults).
//   3. Regeln: remoteGuard() prueft die Argumente einzelner Aufrufe (kein endgueltiges Loeschen,
//              _System nicht loeschbar, vault_check ohne Stufe "admin" nur als Trockenlauf).
//
// Stufen (NEXUS_MCP_LEVELS, Standard: nur "read"):
//   read   immer an – die Lese-Tools
//   write  Notizen und Ordner anlegen/aendern/verschieben, aus dem Papierkorb zurueckholen
//   admin  in den Papierkorb loeschen, Index neu aufbauen, vault_check mit Bericht im Vault

export const REMOTE_READ_TOOLS = Object.freeze([
  'search', 'outline', 'read_note', 'read_bild', 'backlinks', 'list_notes',
  'query', 'dataview', 'lern_status', 'list_vaults', 'list_trash',
]);
export const REMOTE_WRITE_TOOLS = Object.freeze([
  'write_note', 'append_to_section', 'patch', 'write_karten', 'write_vortrag', 'karten_gliedern',
  'create_folder', 'move', 'restore', 'vault_check',
]);
export const REMOTE_ADMIN_TOOLS = Object.freeze(['delete', 'reindex']);
export const REMOTE_LEVELS = Object.freeze(['read', 'write', 'admin']);

// levels: eingeschaltete Stufen ("read" gilt immer). extra: weitere Tool-Namen, die der
// HTTP-Einstieg selbst registriert (z. B. datei_link) – ohne Eintrag hier gaebe es sie nicht.
export function remotePolicy({ levels = [], extra = [] } = {}) {
  const lesen = new Set(REMOTE_READ_TOOLS);
  const namen = new Set([
    ...REMOTE_READ_TOOLS,
    ...(levels.includes('write') ? REMOTE_WRITE_TOOLS : []),
    ...(levels.includes('admin') ? REMOTE_ADMIN_TOOLS : []),
    ...extra,
  ]);
  return {
    allow: (name, { annotations } = {}) => namen.has(name) && (!lesen.has(name) || annotations?.readOnlyHint === true),
    tools: Object.freeze([...namen]),
  };
}
// Nur lesen (R30) – bleibt der Standard.
export const readOnlyPolicy = () => remotePolicy();

// Pfad fuer Regel-Vergleiche: Schraegstriche vereinheitlichen, "." und leere Segmente weg,
// klein (Windows/macOS unterscheiden "_system" und "_System" nicht).
const normRel = (p) => String(p ?? '').replace(/\\/g, '/').split('/').filter(s => s && s !== '.').join('/').toLowerCase();
const innerhalb = (rel, ordner) => rel === ordner || rel.startsWith(ordner + '/');

// Regeln fuer einzelne Aufrufe. Rueckgabe: undefined = unveraendert weiter, { error } = ablehnen
// (das Tool laeuft nicht), { args } = mit geaenderten Argumenten weiter.
export function remoteGuard({ levels = [] } = {}) {
  const admin = levels.includes('admin');
  return (name, args = {}) => {
    if (name === 'delete') {
      if (args.permanent) return { error: 'Endgueltiges Loeschen ist ueber den Remote-Zugriff gesperrt – delete ohne permanent verschiebt in den Papierkorb.' };
      if (innerhalb(normRel(args.path), '_system')) return { error: 'Geschuetzt: unter _System wird ueber den Remote-Zugriff nichts geloescht.' };
    }
    if (name === 'move') {
      // Ein move in den Papierkorb waere ein Loeschen an den delete-Regeln vorbei.
      if (innerhalb(normRel(args.to), '.trash')) return { error: 'Ziel im Papierkorb ist nicht erlaubt – zum Loeschen delete verwenden.' };
      if (normRel(args.from) === '_system') return { error: 'Geschuetzt: der Ordner _System wird ueber den Remote-Zugriff nicht verschoben.' };
    }
    // Ohne Stufe "admin" prueft vault_check nur – der Bericht wird nicht in den Vault geschrieben.
    if (name === 'vault_check' && !admin && args.dry_run !== true) return { args: { ...args, dry_run: true } };
    return undefined;
  };
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

// Server-Hinweise fuer den Remote-Zugriff, passend zu den tatsaechlich freigegebenen Tools
// (die lokale Fassung nennt alle Tools und die Pflichtlektuere).
export function remoteInstructions({ tools = REMOTE_READ_TOOLS, levels = [] } = {}) {
  const schreiben = levels.includes('write') || levels.includes('admin');
  return [
    schreiben ? 'Zugriff auf persoenliche Wissens-Vaults ueber die Nexus-Tools' : 'Lesezugriff auf persoenliche Wissens-Vaults ueber die Nexus-Tools',
    `(${tools.join(', ')}).`,
    schreiben
      ? 'Schreiben: bevorzugt append_to_section oder patch statt write_note; den hash aus outline bzw. dem letzten Schreib-Ergebnis als expected_hash mitgeben – die Notiz kann gleichzeitig auf einem anderen Geraet geaendert werden.'
      : 'Schreiben ist ueber diese Verbindung nicht moeglich.',
    ...(levels.includes('admin') ? ['delete verschiebt in den Papierkorb (restore holt zurueck); endgueltiges Loeschen gibt es hier nicht.'] : []),
    ...(schreiben && !levels.includes('admin') ? ['vault_check prueft nur (Trockenlauf), Loeschen ist nicht freigegeben.'] : []),
    'list_vaults zeigt die freigegebenen Vaults; jedes Tool hat einen optionalen vault-Parameter.',
    'Prinzip: maximale Information pro Token – erst search oder outline, dann read_note mit section',
    'oder lines; nicht blind ganze Notizen lesen. Listen mit limit/offset blaettern.',
    'Fehler kommen als Tool-Fehler (isError) mit Klartext – Ursache lesen, nicht blind wiederholen.',
  ].join(' ');
}
// Kurzfassung fuer den reinen Lesezugriff (R30).
export const REMOTE_INSTRUCTIONS = remoteInstructions();
