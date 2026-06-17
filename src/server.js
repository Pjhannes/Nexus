// src/server.js – MCP stdio-Server (SDK 1.29, Zod-Schemas)
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { buildIndexer, watchVault } from './indexer.js';
import { makeTools } from './tools.js';
import { loadConfig, resolveDbPath } from './paths.js';

const cfg = loadConfig();

const vault = cfg.vaults.find(v => v.name === cfg.activeVault) ?? cfg.vaults[0];
const vaultPath = vault.path;
const dbPath    = resolveDbPath(vault);

const indexer = buildIndexer(vaultPath, dbPath, cfg.ignore ?? []);
console.error('[Nexus] Vault: ' + vaultPath);
console.error('[Nexus] Reindexing...');
const n = indexer.reindex();
console.error('[Nexus] ' + n + ' Dateien indexiert.');

watchVault(indexer, vaultPath, cfg.ignore ?? [], (event, p) => {
  console.error('[Nexus] ' + event + ': ' + p);
}).then(() => {
  console.error('[Nexus] File-Watcher aktiv.');
}).catch(err => {
  console.error('[Nexus] File-Watcher konnte nicht starten: ' + err.message);
});

const T = makeTools(indexer, vaultPath);

// Wird dem Client (z.B. Claude Desktop) beim Verbinden mitgegeben. Stoesst die
// Pflichtlektuere an, ohne dass jemand ans Lesen erinnern muss (Arbeitsweise-Regel 12).
// Die eigentlichen Regeln leben editierbar im Vault unter _System/ – Scaffold im App-Ordner unter rules/.
const NEXUS_INSTRUCTIONS = [
  'Du arbeitest auf einem persoenlichen Wissens-Vault ueber die Nexus-Tools',
  '(search, outline, read_note, write_note, append_to_section, patch, backlinks,',
  'list_notes, query, reindex, create_folder, move, delete, vault_check). Prinzip: maximale',
  'Information pro Token – erst outline/search-Snippet/read_note(section), nicht',
  'blind ganze Dateien lesen; schreiben bevorzugt mit append_to_section/patch.',
  'Ordner/Notizen anlegen, verschieben, umbenennen oder loeschen IMMER ueber',
  'create_folder/move/delete – nie ueber Datei-System-/Mount-Operationen (die sind',
  'blockiert). move und delete funktionieren auch fuer ganze Ordner.',
  '',
  'PFLICHT zu Beginn jeder Session: zuerst die Arbeitsregeln des Nutzers lesen und befolgen –',
  'read_note "_System/Session-Start-Nexus.md", "_System/Arbeitsweise-Nexus.md" und',
  '"_System/Mein-Setup.md" (waehrend der Migration ggf. auch die Original-Dateien',
  '"_System/Session-Start.md"/"_System/Arbeitsweise.md"). Diese Dateien sind die Quelle',
  'der Wahrheit fuer die Arbeitsweise und werden ueber die Tools gepflegt.',
].join(' ');

const server = new McpServer(
  { name: 'nexus', version: '0.2.0' },
  { instructions: NEXUS_INSTRUCTIONS }
);

server.tool(
  'search',
  'Volltextsuche im Vault (FTS5). Gibt Pfad + Snippet zurueck.',
  {
    q:      z.string().optional().describe('Suchbegriff'),
    limit:  z.number().optional().describe('Max. Ergebnisse (Standard: 20)'),
    offset: z.number().optional().describe('Ergebnisse ueberspringen (Pagination, Standard: 0)'),
    tag:    z.string().optional().describe('Nach Tag filtern (optional)'),
  },
  async ({ q, limit, offset, tag }) => {
    const r = T.search({ q, limit, offset, tag });
    return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] };
  }
);

server.tool(
  'outline',
  'Gibt Ueberschriften-Struktur einer Notiz zurueck.',
  { path: z.string().describe('Relativer Pfad zur Notiz im Vault') },
  async ({ path }) => {
    const r = T.outline({ path });
    return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] };
  }
);

server.tool(
  'read_note',
  'Liest eine Notiz (ganz oder abschnittsweise).',
  {
    path:    z.string(),
    section: z.string().optional().describe('Abschnittstitel (optional)'),
    lines:   z.number().optional().describe('Zeilenlimit (optional)'),
  },
  async ({ path, section, lines }) => {
    const r = T.readNote({ path, section, lines });
    return { content: [{ type: 'text', text: r.error ?? r.content }] };
  }
);

server.tool(
  'write_note',
  'Schreibt eine Notiz (Ueberschreiben oder neu anlegen).',
  {
    path:    z.string(),
    content: z.string(),
    create:  z.boolean().optional().describe('true = neue Datei erlaubt'),
  },
  async ({ path, content, create }) => {
    const r = T.writeNote({ path, content, create });
    return { content: [{ type: 'text', text: JSON.stringify(r) }] };
  }
);

server.tool(
  'append_to_section',
  'Haengt Text an einen Abschnitt an.',
  {
    path:    z.string(),
    section: z.string(),
    text:    z.string(),
  },
  async ({ path, section, text }) => {
    const r = T.appendToSection({ path, section, text });
    return { content: [{ type: 'text', text: JSON.stringify(r) }] };
  }
);

server.tool(
  'backlinks',
  'Gibt alle Notizen zurueck, die auf diese verlinken.',
  { path: z.string() },
  async ({ path }) => {
    const r = T.backlinks({ path });
    return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] };
  }
);

server.tool(
  'list_notes',
  'Listet Notizen (optional: Pfad-Prefix-Filter).',
  {
    prefix: z.string().optional().describe('z.B. "Uni/" fuer alle Uni-Notizen'),
    limit:  z.number().optional(),
    offset: z.number().optional().describe('Ergebnisse ueberspringen (Pagination, Standard: 0)'),
  },
  async ({ prefix, limit, offset }) => {
    const r = T.listNotes({ prefix, limit, offset });
    return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] };
  }
);

server.tool(
  'reindex',
  'Scannt Vault neu und aktualisiert den SQLite-Index.',
  {},
  async () => {
    const r = T.reindex();
    return { content: [{ type: 'text', text: JSON.stringify(r) }] };
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
  },
  async ({ field, op, value, limit }) => {
    const r = T.query({ field, op, value, limit });
    return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] };
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
  },
  async ({ path, patches }) => {
    const r = T.patch({ path, patches });
    return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] };
  }
);

server.tool(
  'create_folder',
  'Legt einen neuen Ordner im Vault an (rekursiv). Nutze dies statt Datei-System-/Mount-Operationen.',
  { path: z.string().describe('Relativer Ordnerpfad, z.B. "Uni/6. Semester/Neuer Ordner"') },
  async ({ path }) => {
    const r = T.createFolder({ path });
    return { content: [{ type: 'text', text: JSON.stringify(r) }] };
  }
);

server.tool(
  'move',
  'Verschiebt oder benennt eine Notiz/einen Ordner um (from -> to). Funktioniert fuer Dateien UND ' +
  'ganze Ordner; der Index wird automatisch aktualisiert. Umbenennen = gleicher Elternordner, neuer Name. ' +
  'Bevorzugt vor jeder Datei-System-/Mount-Operation nutzen.',
  {
    from: z.string().describe('Aktueller relativer Pfad (Datei oder Ordner)'),
    to:   z.string().describe('Neuer relativer Pfad'),
  },
  async ({ from, to }) => {
    const r = T.move({ from, to });
    return { content: [{ type: 'text', text: JSON.stringify(r) }] };
  }
);

server.tool(
  'delete',
  'Loescht eine Notiz oder einen ganzen Ordner (rekursiv) im Vault. Funktioniert fuer Dateien UND ' +
  'Ordner; der Index wird automatisch aktualisiert. Nutze dies statt blockierter Mount-/Datei-System-Loeschungen.',
  { path: z.string().describe('Relativer Pfad zur Notiz oder zum Ordner') },
  async ({ path }) => {
    const r = T.delete({ path });
    return { content: [{ type: 'text', text: JSON.stringify(r) }] };
  }
);

server.tool(
  'vault_check',
  'Vault-Gesundheits-Check ueber den Live-Index (kein Voll-Reparse): kaputte Links, ' +
  'verwaiste Notizen, veraltete Daten (>30 Tage), Karteileichen, doppelte Dateinamen. ' +
  'Schreibt den vollen Bericht nach _System/Vault-Check.md und gibt eine kompakte ' +
  'Zusammenfassung (Zahlen + erste Treffer je Kategorie) zurueck.',
  { dry_run: z.boolean().optional().describe('true = nur pruefen, Bericht NICHT in den Vault schreiben') },
  async ({ dry_run }) => {
    const r = T.vaultCheck({ dryRun: dry_run });
    return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
