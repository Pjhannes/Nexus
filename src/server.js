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

// App-Version aus package.json – gleiche Quelle wie ui-server.js/tauri.conf.json
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
  '(list_vaults, search, outline, read_note, write_note, write_vortrag, write_karten, append_to_section, patch, backlinks,',
  'list_notes, query, dataview, reindex, create_folder, move, delete, vault_check).',
  'Der Server bedient ALLE Vaults der Nexus-App: list_vaults zeigt sie; jedes Tool',
  'hat einen optionalen vault-Parameter (Standard: der in der App aktive Vault).',
  'In der App neu angelegte Vaults sind sofort erreichbar. Prinzip: maximale',
  'Information pro Token – erst outline/search-Snippet/read_note(section), nicht',
  'blind ganze Dateien lesen; schreiben bevorzugt mit append_to_section/patch.',
  'Ordner/Notizen anlegen, verschieben, umbenennen oder loeschen IMMER ueber',
  'create_folder/move/delete – nie ueber Datei-System-/Mount-Operationen (die sind',
  'blockiert). move und delete funktionieren auch fuer ganze Ordner.',
  'Bittet der Nutzer um ein Vortragsskript fuer eine Notiz (fuer den Vortrag-Button der App):',
  'Notiz lesen, dann write_vortrag mit Segmenten {sprich, anker, art} aufrufen –',
  'sprich frei und vortragend formulieren (Rueckbezuege, Uebergaenge, kein blosses Ablesen),',
  'anker WOERTLICH aus der Notiz zitieren (wird serverseitig validiert).',
  'Bittet der Nutzer um Karteikarten/Abfrage/Lernkarten zu einer Notiz oder einem Fach',
  '(fuer den Lernmodus der App): Notiz lesen, dann write_karten aufrufen – Fragen pruefungsnah',
  'formulieren (Verstaendnis statt Wortlaut), quelle WOERTLICH aus der Notiz zitieren (validiert).',
  'Typen: janein | mc | freitext | bild. Bild-Karten liefern bild-Pfad + labels; die Regionen',
  'auf dem Bild platziert der Nutzer selbst im Karten-Editor (ein LLM sieht die Bildpixel nicht).',
  'Ein erneutes write_karten ueberschreibt das Kartenset, erhaelt aber IDs und damit den Lernstand.',
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
  'write_vortrag',
  'Erstellt/aktualisiert das Vortragsskript einer Notiz (<Notiz>.vortrag.json) fuer den Vortrag-Button der App: validiert jeden anker woertlich gegen die Notiz und stempelt den Notiz-Hash.',
  {
    path:  z.string().describe('Pfad der .md-Notiz, zu der das Skript gehoert'),
    titel: z.string().optional().describe('Vortragstitel (optional)'),
    segmente: z.array(z.object({
      sprich: z.string().describe('Gesprochener Text des Segments – frei formuliert, mit Rueckbezuegen/Uebergaengen'),
      anker:  z.string().optional().describe('Woertlicher Textausschnitt aus der Notiz, der waehrend des Segments hervorgehoben wird'),
      art:    z.enum(['absatz', 'wort', 'tabelle', 'ueberschrift', 'keine']).optional()
                .describe('Hervorhebungsart (Standard: absatz; keine = nur sprechen, ohne anker)'),
    })).describe('Vortrags-Segmente in Sprechreihenfolge'),
    vault: vaultParam,
  },
  async ({ path, titel, segmente, vault }) => {
    const e = registry.get(vault);
    return withVault(e, e.tools.writeVortrag({ path, titel, segmente }));
  }
);

server.tool(
  'write_karten',
  'Erstellt/aktualisiert die Karteikarten einer Notiz (<Notiz>.karten.json) fuer den Lernmodus der App. ' +
  'Validiert jede Karte gegen die Notiz (quelle woertlich), vergibt stabile IDs – der Lernstand bleibt ' +
  'bei einer Regeneration erhalten – und stempelt den Notiz-Hash. Ersetzt das komplette Kartenset der Notiz.',
  {
    path:  z.string().describe('Pfad der .md-Notiz, zu der die Karten gehoeren'),
    titel: z.string().optional().describe('Titel des Kartensets (optional)'),
    karten: z.array(z.object({
      id:  z.string().optional().describe('Nur setzen, wenn eine bestehende Karte gezielt geaendert wird (sonst weglassen – die ID wird ueber die Frage wiedererkannt)'),
      typ: z.enum(['janein', 'mc', 'freitext', 'bild'])
             .describe('janein = Aussage richtig/falsch · mc = Multiple Choice (auch mehrere richtige) · freitext = frei formulieren, der Nutzer bewertet sich selbst · bild = Begriffe Bildstellen zuordnen'),
      frage: z.string().describe('Die Frage bzw. die zu bewertende Aussage – pruefungsnah, Verstaendnis statt Wortlaut'),
      antwort: z.union([z.boolean(), z.string()]).optional()
             .describe('janein: true/false · freitext: Musterloesung'),
      optionen: z.array(z.string()).optional().describe('mc: 2-8 Antwortoptionen (Distraktoren duerfen frei erfunden sein)'),
      korrekt:  z.array(z.number()).optional().describe('mc: Indizes der richtigen Optionen, 0-basiert (nicht alle)'),
      quelle: z.string().optional()
             .describe('WOERTLICHES Zitat aus der Notiz, das die Antwort belegt – Pflicht ausser bei typ "bild", wird serverseitig gegen die Notiz geprueft'),
      erklaerung: z.string().optional().describe('Kurze Erklaerung, wird nach dem Antworten angezeigt'),
      bild:   z.string().optional().describe('bild: Vault-Pfad der Grafik (muss existieren)'),
      labels: z.array(z.string()).optional().describe('bild: 2-12 zuzuordnende Begriffe'),
      modus:  z.enum(['zuordnen', 'tippen']).optional()
             .describe('bild: "zuordnen" = Begriff aus der Liste waehlen (Standard) · "tippen" = Begriff ins Feld schreiben'),
      abdecken: z.boolean().optional()
             .describe('bild: Standard true – die Rechtecke verdecken beim Abfragen, was an der Stelle auf der Folie steht. Nur auf false setzen, wenn die Grafik ohnehin unbeschriftet ist'),
      regionen: z.array(z.object({
        label: z.string().describe('Muss woertlich einem Eintrag aus "labels" entsprechen'),
        x: z.number().describe('Linke Kante, 0..1 (Anteil der Bildbreite)'),
        y: z.number().describe('Obere Kante, 0..1 (Anteil der Bildhoehe)'),
        w: z.number().describe('Breite, 0..1 (Anteil der Bildbreite)'),
        h: z.number().describe('Hoehe, 0..1 (Anteil der Bildhoehe)'),
      })).optional()
             .describe('bild: Rechtecke auf der Grafik. SIEH DIR DIE BILDDATEI AN und lege sie selbst fest – ueber die Beschriftung, die dort steht, damit sie beim Abfragen verdeckt wird. Ohne Regionen ist die Karte nicht spielbar, bis der Nutzer sie im Karten-Editor platziert'),
    })).describe('Alle Karten der Notiz (ersetzt das bisherige Set)'),
    vault: vaultParam,
  },
  async ({ path, titel, karten, vault }) => {
    const e = registry.get(vault);
    return withVault(e, e.tools.writeKarten({ path, titel, karten }));
  }
);

server.tool(
  'lern_status',
  'Lesender Blick auf den Lernstand des Lernmodus: faellige Karten je Fach und Notiz, Pruefungstermine, ' +
  'Restaufwand bis zur Pruefung, Trefferquote und die Karten mit den meisten Fehlversuchen. ' +
  'Damit laesst sich ein Lernplan bauen oder gezielt nachfragen, wo es klemmt.',
  {
    fach:  z.string().optional().describe('Fach-Name oder -ID einschraenken (Standard: alle)'),
    tage:  z.number().optional().describe('Betrachtungsfenster fuer den Verlauf in Tagen (Standard 30)'),
    vault: vaultParam,
  },
  async ({ fach, tage, vault }) => {
    const e = registry.get(vault);
    return withVault(e, e.tools.lernStatus({ fach, tage }));
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
