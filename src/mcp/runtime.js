// src/mcp/runtime.js – was ein Nexus-MCP-PROZESS einmal braucht (R29/N7)
//
// Getrennt von build-server.js, weil es pro Prozess genau einmal passiert, waehrend ein
// HTTP-Einstieg pro Anfrage einen frischen Server aus derselben Registry baut:
//   serverInfo()        Identitaet (Version, Commit, Datenordner) fuer initialize + list_vaults
//   createRegistry()    Vault-Registry mit Index + File-Watcher ueber alle Vaults der Config
//   cleanupTrash()      Papierkorb-Eintraege aelter als trash.retentionDays entfernen
import { readFileSync, statSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { buildIndexer, watchVault } from '../indexer.js';
import { makeTools, emptyOldTrash } from '../tools.js';
import { loadConfig, resolveDbPath, CONFIG_PATH, DATA_DIR, APP_ROOT } from '../paths.js';
import { makeVaultRegistry } from '../vault-registry.js';

const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const stderrLog = (m) => console.error('[Nexus] ' + m);

// R27b (A12): Server-Identitaet fuer list_vaults – damit in einer Session mit
// nexus UND nexus-dev sofort klar ist, welcher Server (Version/Commit/Datenordner)
// geantwortet hat (Tipp 31: "thema" ging auf prod verloren, weil der Dev-Stand
// nicht gebaut war).
function gitCommit() {
  try {
    const head = readFileSync(join(APP_ROOT, '.git', 'HEAD'), 'utf8').trim();
    const ref = head.startsWith('ref: ') ? head.slice(5) : null;
    const sha = ref ? readFileSync(join(APP_ROOT, '.git', ref), 'utf8').trim() : head;
    return /^[0-9a-f]{40}$/.test(sha) ? sha.slice(0, 7) : null;
  } catch { return null; }
}
function buildDate() {
  try { return statSync(join(SRC_DIR, 'server.js')).mtime.toISOString(); } catch { return null; }
}

export function serverInfo() {
  // App-Version aus package.json – gleiche Quelle wie ui-server.js/tauri.conf.json
  let version = '0.0.0';
  try { version = JSON.parse(readFileSync(join(SRC_DIR, '..', 'package.json'), 'utf8')).version || version; } catch { /* ignore */ }
  return {
    name: 'nexus',
    version,
    gitCommit: gitCommit(),
    buildDate: buildDate(),
    dataDir: DATA_DIR,
    dev: process.env.NEXUS_DEV === '1' || existsSync(join(APP_ROOT, '.git')),
  };
}

// Registry ueber ALLE Vaults aus nexus.config.json. Laedt die Config bei Aenderung live nach ->
// in der App neu angelegte Vaults sind ohne Neustart von Claude Desktop erreichbar.
export function createRegistry({ log = stderrLog } = {}) {
  log('Lade Vaults aus ' + CONFIG_PATH);
  return makeVaultRegistry({
    configPath: CONFIG_PATH,
    loadConfig,
    resolveDbPath,
    buildIndexer,
    makeTools,
    startWatch: (v, indexer, ignore) =>
      watchVault(indexer, v.path, ignore, (event, p) => {
        log(`[${v.name}] ${event}: ${p}`);
      }).then(w => { log(`File-Watcher aktiv: ${v.name}`); return w; }),
    log,
  });
}

// R27b: Papierkorb-Eintraege aelter als trash.retentionDays (Standard 30) beim Start entfernen.
export function cleanupTrash(registry, { log = stderrLog } = {}) {
  const cfg = registry.config();
  const days = Number.isFinite(Number(cfg.trash?.retentionDays)) ? Number(cfg.trash.retentionDays) : 30;
  for (const e of registry.entries()) {
    const n = emptyOldTrash(e.vault.path, days);
    if (n) log(`Vault "${e.vault.name}": ${n} Papierkorb-Eintrag/-Eintraege aelter als ${days} Tage entfernt`);
  }
}
