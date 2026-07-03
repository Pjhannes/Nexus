// src/vault-registry.js – Multi-Vault-Registry fuer den MCP-Server
//
// Problem: server.js bediente genau EINEN Vault (activeVault beim Start). In der
// App angelegte weitere Vaults standen zwar in nexus.config.json, waren fuer
// Claude aber unsichtbar, bis man die Desktop-Config anfasste und neu startete.
//
// Loesung: Registry ueber ALLE Vaults der Config. Jeder Tool-Aufruf loest den
// Ziel-Vault per Name auf (Standard: activeVault). Vor jeder Aufloesung wird die
// Config per mtime+size-Signatur billig auf Aenderungen geprueft (1x statSync)
// und bei Bedarf neu geladen -> in der App neu angelegte Vaults sind sofort
// erreichbar, ohne Neustart von Claude Desktop; entfernte werden abgemeldet.
//
// Abhaengigkeiten (buildIndexer, makeTools, Watcher, ...) werden injiziert ->
// ohne MCP-Transport testbar (test/smoke.js).

import { statSync } from 'fs';

export function makeVaultRegistry({
  configPath,          // absoluter Pfad zur nexus.config.json (fuer die Aenderungs-Signatur)
  loadConfig,          // () => cfg; wirft, wenn die Config fehlt
  resolveDbPath,       // (vault) => absoluter DB-Pfad
  buildIndexer,        // (vaultPath, dbPath, ignore) => indexer
  makeTools,           // (indexer, vaultPath) => tools
  startWatch = null,   // async (vault, indexer, ignore) => FSWatcher; optional (Tests: weglassen)
  log = () => {},      // (msg) => void
}) {
  let cfg = loadConfig(); // wirft beim Serverstart, wenn Config fehlt – gewollt, wie bisher
  const entries = new Map(); // name -> { vault, indexer, tools, watcherP }
  let configSig = sig();

  function sig() {
    try { const s = statSync(configPath); return s.mtimeMs + ':' + s.size; }
    catch { return null; }
  }

  function register(v) {
    const indexer = buildIndexer(v.path, resolveDbPath(v), cfg.ignore ?? []);
    const n = indexer.reindex();
    const entry = {
      vault: v,
      indexer,
      tools: makeTools(indexer, v.path),
      watcherP: startWatch
        ? startWatch(v, indexer, cfg.ignore ?? []).catch(err => {
            log(`File-Watcher fuer Vault "${v.name}" konnte nicht starten: ${err.message}`);
            return null;
          })
        : null,
    };
    entries.set(v.name, entry);
    log(`Vault "${v.name}" (${v.path}): ${n} Dateien indexiert`);
    return entry;
  }

  function unregister(name) {
    const e = entries.get(name);
    if (!e) return;
    entries.delete(name);
    if (e.watcherP) e.watcherP.then(w => w?.close()).catch(() => {});
    try { e.indexer.db.close(); } catch { /* schon geschlossen */ }
    log(`Vault "${name}" abgemeldet (aus der Config entfernt)`);
  }

  // Config bei Aenderung neu einlesen: neue Vaults registrieren, entfernte abmelden.
  // Nicht lesbare Config (halbfertiger Schreibvorgang) -> letzten Stand behalten.
  function refresh() {
    const s = sig();
    if (s === configSig) return;
    let fresh;
    try { fresh = loadConfig(); }
    catch (err) { log('Config nicht lesbar – behalte letzten Stand: ' + err.message); return; }
    configSig = s;
    cfg = fresh;
    for (const v of cfg.vaults ?? []) {
      if (!entries.has(v.name)) {
        try { register(v); }
        catch (err) { log(`Vault "${v.name}" (${v.path}) uebersprungen: ${err.message}`); }
      }
    }
    for (const name of [...entries.keys()]) {
      if (!(cfg.vaults ?? []).some(v => v.name === name)) unregister(name);
    }
  }

  // Initiale Registrierung aller Vaults; ein kaputter Vault blockiert nicht die anderen.
  for (const v of cfg.vaults ?? []) {
    try { register(v); }
    catch (err) { log(`Vault "${v.name}" (${v.path}) uebersprungen: ${err.message}`); }
  }

  // Liefert { vault, indexer, tools } fuer einen Vault-Namen.
  // Ohne Namen: der in der App aktive Vault (live aus der Config).
  function get(name) {
    refresh();
    const n = name ?? cfg.activeVault ?? cfg.vaults?.[0]?.name;
    const e = entries.get(n);
    if (!e) {
      throw new Error(
        `Vault nicht gefunden: ${n ?? '(kein aktiver Vault)'}. ` +
        `Verfuegbar: ${[...entries.keys()].join(', ') || '(keine)'}`
      );
    }
    return e;
  }

  function list() {
    refresh();
    const active = cfg.activeVault ?? cfg.vaults?.[0]?.name ?? null;
    return {
      activeVault: active,
      vaults: (cfg.vaults ?? []).filter(v => entries.has(v.name)).map(v => ({
        name: v.name,
        path: v.path,
        active: v.name === active,
        notes: entries.get(v.name).indexer.stats().n,
      })),
    };
  }

  // Alle Watcher/DB-Handles freigeben (fuer Tests/Einbettung; der MCP-Server
  // selbst lebt so lange wie der Prozess).
  function close() {
    for (const e of entries.values()) {
      if (e.watcherP) e.watcherP.then(w => w?.close()).catch(() => {});
      try { e.indexer.db.close(); } catch { /* schon geschlossen */ }
    }
    entries.clear();
  }

  return { get, list, refresh, close, size: () => entries.size };
}
