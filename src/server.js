// src/server.js – MCP stdio-Server (SDK 1.29, Zod-Schemas)
//
// Multi-Vault: Der Server bedient ALLE Vaults aus nexus.config.json, nicht mehr
// nur den activeVault. Jedes Tool nimmt optional einen Vault-Namen (Standard:
// der in der App aktive Vault); list_vaults zeigt alle. Die Registry laedt die
// Config bei Aenderung live nach -> in der App neu angelegte Vaults sind ohne
// Neustart von Claude Desktop erreichbar.
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { buildIndexer, watchVault } from './indexer.js';
import { makeTools } from './tools.js';
import { loadConfig, resolveDbPath, CONFIG_PATH } from './paths.js';
import { makeVaultRegistry } from './vault-registry.js';

const __dir = dirname(fileURLToPath(import.meta.url));

// App-Version aus package.json – gleiche Quelle wie ui-server.js/electron-builder
let APP_VERSION = '0.0.0';
try { APP_VERSION = JSON.parse(readFileSync(join(__dir, '..', 'package.json'), 'utf8')).version || APP_VERSION; } catch { /* ignore */ }

console.error('[Nexus] Lade Vaults aus ' + CONFIG_PATH);
const registry = makeVaultRegistry({
  configPath: CONFIG_PATH,
  loadConfig,
  resolveDbPath,
  buildIndexer,
  makeTools,
  startWatch: (v, indexer, ignore) =>
    watchVault(indexer, v.path, ignore, (event, p) => {
      console.error(`[Nexus] [${v.name}] ${event}: ${p}`);
    }).then(w => { console.error(`[Nexus] File-Watcher aktiv: ${v.name}`); return w; }),
  log: (m) => console.error('[Nexus] ' + m),
});

// Optionaler Vault-Parameter, den jedes Tool versteht.
const vaultParam = z.string().optional()
  .describe('Vault-Name (Standard: der in der App aktive Vault; alle Namen: list_vaults)');

// Wird dem Client (z.B. Claude Desktop) beim Verbinden mitgegeben. Stoesst die
// Pflichtlektuere an, ohne dass jemand ans Lesen erinnern muss (Arbeitsweise-Regel 12).
// Die eigentlichen Regeln leben editierbar im Vault unter _System/ – Scaffold im App-Ordner unter rules/.
const NEXUS_INSTRUCTIONS = [
  'Du arbeitest auf persoenlichen Wissens-Vaults ueber die Nexus-Tools',
  '(list_vaults, search, outline, read_note, write_note, append_to_section, patch, backlinks,',
  'list_notes, query, dataview, reindex, create_folder, move, delete, vault_check).',
  'Der Server bedient ALLE Vaults der Nexus-App: list_vaults zeigt sie; jedes Tool',
  'hat einen optionalen vault-Parameter (Standard: der in der App aktive Vault).',
  'In der App neu angelegte Vaults sind sofort erreichbar. Prinzip: maximale',
  'Information pro Token – erst outline/search-Snippet/read_note(section), nicht',
  'blind ganze Dateien lesen; schreiben bevorzugt mit append_to_section/patch.',
  'Ordner/Notizen anlegen, verschieben, umbenennen oder loeschen IMMER ueber',
  'create_folder/move/delete – nie ueber Datei-System-/Mount-Operationen (die sind',
  'blockiert). move und delete funktionieren auch fuer ganze Ordner.',
  '',
  'PFLICHT zu Beginn jeder Session: zuerst die Arbeitsregeln des Nutzers lesen und befolgen –',
  'read_note "_System/Session-Start-Nexus.md", "_System/Arbeitsweise-Nexus.md" und',
  '"_System/Mein-Setup.md" im aktiven Vault (waehrend der Migration ggf. auch die Original-Dateien',
  '"_System/Session-Start.md"/"_System/Arbeitsweise.md"). Diese Dateien sind die Quelle',
  'der Wahrheit fuer die Arbeitsweise und werden ueber die Tools gepflegt.',
].join(' ');

const server = new McpServer(
  { name: 'nexus', version: APP_VERSION },
  { instructions: NEXUS_INSTRUCTIONS }
);

// Kurzform: Antwort als Text-Content
const text = (s) => ({ content: [{ type: 'text', text: s }] });
const asJson = (r) => text(JSON.stringify(r, null, 2));
// Schreib-/Vault-Operationen nennen den aufgeloesten Vault im Ergebnis – so ist
// unmissverstaendlich, WO geschrieben wurde, auch wenn kein vault-Param gesetzt war.
const withVault = (e, r) => text(JSON.stringify({ vault: e.vault.name, ...r }));

server.tool(
  'list_vaults',
  'Listet alle verfuegbaren Vaults (Name, Pfad, aktiv, Notiz-Anzahl). In der App neu angelegte Vaults werden live erkannt.',
  {},
  async () => asJson(registry.list())
);

server.tool(
  'search',
  'Volltextsuche im Vault (FTS5). Gibt Pfad + Snippet zurueck.',
  {
    q:      z.string().optional().describe('Suchbegriff'),
    limit:  z.number().optional().describe('Max. Ergebnisse (Standard: 20)'),
    offset: z.number().optional().describe('Ergebnisse ueberspringen (Pagination, Standard: 0)'),
    tag:    z.string().optional().describe('Nach Tag filtern (optional)'),
    vault:  vaultParam,
  },
  async ({ q, limit, offset, tag, vault }) => {
    return asJson(registry.get(vault).tools.search({ q, limit, offset, tag }));
  }
);

server.tool(
  'outline',
  'Gibt Ueberschriften-Struktur einer Notiz zurueck.',
  {
    path:  z.string().describe('Relativer Pfad zur Notiz im Vault'),
    vault: vaultParam,
  },
  async ({ path, vault }) => {
    return asJson(registry.get(vault).tools.outline({ path }));
  }
);

server.tool(
  'read_note',
  'Liest eine Notiz (ganz oder abschnittsweise).',
  {
    path:    z.string(),
    section: z.string().optional().describe('Abschnittstitel (optional)'),
    lines:   z.number().optional().describe('Zeilenlimit (optional)'),
    vault:   vaultParam,
  },
  async ({ path, section, lines, vault }) => {
    const r = registry.get(vault).tools.readNote({ path, section, lines });
    return text(r.error ?? r.content);
  }
);

server.tool(
  'write_note',
  'Schreibt eine Notiz (Ueberschreiben oder neu anlegen).',
  {
    path:    z.string(),
    content: z.string(),
    create:  z.boolean().optional().describe('true = neue Datei erlaubt'),
    vault:   vaultParam,
  },
  async ({ path, content, create, vault }) => {
    const e = registry.get(vault);
    return withVault(e, e.tools.writeNote({ path, content, create }));
  }
);

server.tool(
  'append_to_section',
  'Haengt Text an einen Abschnitt an.',
  {
    path:    z.string(),
    section: z.string(),
    text:    z.string(),
    vault:   vaultParam,
  },
  async ({ path, section, text: t, vault }) => {
    const e = registry.get(vault);
    return withVault(e, e.tools.appendToSection({ path, section, text: t }));
  }
);

server.tool(
  'backlinks',
  'Gibt alle Notizen zurueck, die auf diese verlinken.',
  {
    path:  z.string(),
    vault: vaultParam,
  },
  async ({ path, vault }) => {
    return asJson(registry.get(vault).tools.backlinks({ path }));
  }
);

server.tool(
  'list_notes',
  'Listet Notizen (optional: Pfad-Prefix-Filter).',
  {
    prefix: z.string().optional().describe('z.B. "Uni/" fuer alle Uni-Notizen'),
    limit:  z.number().optional(),
    offset: z.number().optional().describe('Ergebnisse ueberspringen (Pagination, Standard: 0)'),
    vault:  vaultParam,
  },
  async ({ prefix, limit, offset, vault }) => {
    return asJson(registry.get(vault).tools.listNotes({ prefix, limit, offset }));
  }
);

server.tool(
  'reindex',
  'Scannt einen Vault neu und aktualisiert den SQLite-Index.',
  { vault: vaultParam },
  async ({ vault }) => {
    const e = registry.get(vault);
    return withVault(e, e.tools.reindex());
  }
);

server.tool(
  'query',
  'Filtert Notizen nach Frontmatter-Feldern.',
  {
    field: z.string().describe('Frontmatter-Schluessel, z.B. "status", "tags", "due"'),
    op:    z.string().optional().describe('Operator: = | != | contains | exists | < | > (Standard: =)'),
    value: z.string().optional().describe('Vergleichswert (bei exists nicht noetig)'),
    limit: z.number().optional().describe('Max. Ergebnisse (Standard: 100)'),
    vault: vaultParam,
  },
  async ({ field, op, value, limit, vault }) => {
    return asJson(registry.get(vault).tools.query({ field, op, value, limit }));
  }
);

server.tool(
  'dataview',
  'Fuehrt eine Dataview-(DQL)-Query gegen den Vault aus (LIST/TABLE [WITHOUT ID], FROM "Ordner", ' +
  'WHERE mit AND/OR/!/contains()/Vergleichen, SORT feld ASC|DESC, LIMIT n, dateformat()). ' +
  'Loest dynamische Listen/Tabellen zur Laufzeit auf – das Nexus-Aequivalent zu Obsidians ' +
  'eingebetteten Dataview-Bloecken. Gibt {kind, headers, rows, count} mit aufgeloesten Links zurueck.',
  {
    source: z.string().describe('Die DQL-Query, z.B.: LIST FROM "Wissen" WHERE file.name != "00 – Index" SORT file.mtime DESC LIMIT 5'),
    vault:  vaultParam,
  },
  async ({ source, vault }) => {
    return asJson(registry.get(vault).tools.dataview({ source }));
  }
);

server.tool(
  'patch',
  'Batch-Edits: ersetzt mehrere Textstellen in einer Notiz ohne das ganze File neu zu schreiben.',
  {
    path:    z.string().describe('Relativer Pfad zur Notiz im Vault'),
    patches: z.array(z.object({
      old_str: z.string().describe('Zu ersetzender Text (erste Fundstelle)'),
      new_str: z.string().optional().describe('Ersatztext (leer = loeschen)'),
    })).describe('Liste von Ersetzungen'),
    vault:   vaultParam,
  },
  async ({ path, patches, vault }) => {
    const e = registry.get(vault);
    return withVault(e, e.tools.patch({ path, patches }));
  }
);

server.tool(
  'create_folder',
  'Legt einen neuen Ordner im Vault an (rekursiv). Nutze dies statt Datei-System-/Mount-Operationen.',
  {
    path:  z.string().describe('Relativer Ordnerpfad, z.B. "Uni/6. Semester/Neuer Ordner"'),
    vault: vaultParam,
  },
  async ({ path, vault }) => {
    const e = registry.get(vault);
    return withVault(e, e.tools.createFolder({ path }));
  }
);

server.tool(
  'move',
  'Verschiebt oder benennt eine Notiz/einen Ordner um (from -> to). Funktioniert fuer Dateien UND ' +
  'ganze Ordner; der Index wird automatisch aktualisiert. Umbenennen = gleicher Elternordner, neuer Name. ' +
  'Bevorzugt vor jeder Datei-System-/Mount-Operation nutzen. from und to liegen immer im selben Vault.',
  {
    from:  z.string().describe('Aktueller relativer Pfad (Datei oder Ordner)'),
    to:    z.string().describe('Neuer relativer Pfad'),
    vault: vaultParam,
  },
  async ({ from, to, vault }) => {
    const e = registry.get(vault);
    return withVault(e, e.tools.move({ from, to }));
  }
);

server.tool(
  'delete',
  'Loescht eine Notiz oder einen ganzen Ordner (rekursiv) im Vault. Funktioniert fuer Dateien UND ' +
  'Ordner; der Index wird automatisch aktualisiert. Nutze dies statt blockierter Mount-/Datei-System-Loeschungen.',
  {
    path:  z.string().describe('Relativer Pfad zur Notiz oder zum Ordner'),
    vault: vaultParam,
  },
  async ({ path, vault }) => {
    const e = registry.get(vault);
    return withVault(e, e.tools.delete({ path }));
  }
);

server.tool(
  'vault_check',
  'Vault-Gesundheits-Check ueber den Live-Index (kein Voll-Reparse): kaputte Links, ' +
  'verwaiste Notizen, veraltete Daten (>30 Tage), Karteileichen, doppelte Dateinamen. ' +
  'Schreibt den vollen Bericht nach _System/Vault-Check.md und gibt eine kompakte ' +
  'Zusammenfassung (Zahlen + erste Treffer je Kategorie) zurueck.',
  {
    dry_run: z.boolean().optional().describe('true = nur pruefen, Bericht NICHT in den Vault schreiben'),
    vault:   vaultParam,
  },
  async ({ dry_run, vault }) => {
    const e = registry.get(vault);
    return text(JSON.stringify({ vault: e.vault.name, ...e.tools.vaultCheck({ dryRun: dry_run }) }, null, 2));
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
