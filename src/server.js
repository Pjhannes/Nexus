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
const server = new McpServer({ name: 'nexus', version: '0.2.0' });

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

const transport = new StdioServerTransport();
await server.connect(transport);
