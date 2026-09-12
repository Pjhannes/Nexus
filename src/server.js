// src/server.js – MCP stdio-Server (SDK 1.29, Zod-Schemas)
//
// Multi-Vault: Der Server bedient ALLE Vaults aus nexus.config.json, nicht mehr
// nur den activeVault. Jedes Tool nimmt optional einen Vault-Namen (Standard:
// der in der App aktive Vault); list_vaults zeigt alle. Die Registry laedt die
// Config bei Aenderung live nach -> in der App neu angelegte Vaults sind ohne
// Neustart von Claude Desktop erreichbar.
//
// R27b (Plan A1/A9/A12): registerTool statt server.tool – jedes Tool traegt
// annotations (readOnly/destructive/idempotent), sechs Lese-Tools liefern
// zusaetzlich outputSchema + structuredContent (Text-Fallback unveraendert), und
// EIN zentraler Wrapper macht aus r.error bzw. einer Exception einen echten
// Tool-Fehler ({ isError: true }) statt eines "ok"-Textes mit Fehlertext drin.
import { readFileSync, statSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { buildIndexer, watchVault } from './indexer.js';
import { makeTools, emptyOldTrash } from './tools.js';
import { loadConfig, resolveDbPath, CONFIG_PATH, DATA_DIR, APP_ROOT } from './paths.js';
import { makeVaultRegistry } from './vault-registry.js';

const __dir = dirname(fileURLToPath(import.meta.url));

// App-Version aus package.json – gleiche Quelle wie ui-server.js/tauri.conf.json
let APP_VERSION = '0.0.0';
try { APP_VERSION = JSON.parse(readFileSync(join(__dir, '..', 'package.json'), 'utf8')).version || APP_VERSION; } catch { /* ignore */ }

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
  try { return statSync(join(__dir, 'server.js')).mtime.toISOString(); } catch { return null; }
}
const SERVER_INFO = {
  version: APP_VERSION,
  gitCommit: gitCommit(),
  buildDate: buildDate(),
  dataDir: DATA_DIR,
  dev: process.env.NEXUS_DEV === '1' || existsSync(join(APP_ROOT, '.git')),
};
console.error(`[Nexus] MCP-Server v${APP_VERSION}${SERVER_INFO.gitCommit ? ' (' + SERVER_INFO.gitCommit + ')' : ''}, Daten: ${DATA_DIR}`);
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

// R27b: Papierkorb-Eintraege aelter als trash.retentionDays (Standard 30) beim Start entfernen.
{
  const cfg0 = registry.config();
  const days = Number.isFinite(Number(cfg0.trash?.retentionDays)) ? Number(cfg0.trash.retentionDays) : 30;
  for (const e of registry.entries()) {
    const n = emptyOldTrash(e.vault.path, days);
    if (n) console.error(`[Nexus] Vault "${e.vault.name}": ${n} Papierkorb-Eintrag/-Eintraege aelter als ${days} Tage entfernt`);
  }
}

// Optionaler Vault-Parameter, den jedes Tool versteht.
const vaultParam = z.string().optional()
  .describe('Vault-Name (Standard: der in der App aktive Vault; alle Namen: list_vaults)');
// R27b: Zod-Bounds statt nackter Zahlen.
const limitParam  = (def, max = 200) => z.number().int().min(1).max(max).optional().describe(`Max. Ergebnisse (Standard: ${def}, hoechstens ${max})`);
const offsetParam = z.number().int().min(0).optional().describe('Ergebnisse ueberspringen (Pagination, Standard: 0)');

// Wird dem Client (z.B. Claude Desktop) beim Verbinden mitgegeben. Stoesst die
// Pflichtlektuere an, ohne dass jemand ans Lesen erinnern muss (Arbeitsweise-Regel 12).
// Die eigentlichen Regeln leben editierbar im Vault unter _System/ – Scaffold im App-Ordner unter rules/.
const NEXUS_INSTRUCTIONS = [
  'Du arbeitest auf persoenlichen Wissens-Vaults ueber die Nexus-Tools',
  '(list_vaults, search, outline, read_note, read_bild, write_note, write_vortrag, write_karten, karten_gliedern,',
  'lern_status, append_to_section, patch, backlinks, list_notes, query, dataview, reindex, create_folder, move,',
  'delete, list_trash, restore, vault_check).',
  'Der Server bedient ALLE Vaults der Nexus-App: list_vaults zeigt sie (und nennt Version/Datenordner',
  'dieses Servers); jedes Tool hat einen optionalen vault-Parameter (Standard: der in der App aktive Vault).',
  'In der App neu angelegte Vaults sind sofort erreichbar. Prinzip: maximale',
  'Information pro Token – erst outline/search-Snippet/read_note(section), nicht',
  'blind ganze Dateien lesen; schreiben bevorzugt mit append_to_section/patch.',
  'Ordner/Notizen anlegen, verschieben, umbenennen oder loeschen IMMER ueber',
  'create_folder/move/delete – nie ueber Datei-System-/Mount-Operationen (die sind',
  'blockiert). move und delete funktionieren auch fuer ganze Ordner. delete verschiebt in den',
  'Papierkorb des Vaults (.trash) – list_trash zeigt ihn, restore holt Eintraege zurueck.',
  'Fehler kommen als Tool-Fehler (isError) mit Klartext – dann Ursache lesen, nicht blind wiederholen.',
  'Bittet der Nutzer um ein Vortragsskript fuer eine Notiz (fuer den Vortrag-Button der App):',
  'Notiz lesen, dann write_vortrag mit Segmenten {sprich, anker, art} aufrufen –',
  'sprich frei und vortragend formulieren (Rueckbezuege, Uebergaenge, kein blosses Ablesen),',
  'anker WOERTLICH aus der Notiz zitieren (wird serverseitig validiert).',
  'Bittet der Nutzer um Karteikarten/Abfrage/Lernkarten zu einer Notiz oder einem Fach',
  '(fuer den Lernmodus der App): Notiz lesen, dann write_karten aufrufen – Fragen pruefungsnah',
  'formulieren (Verstaendnis statt Wortlaut), quelle WOERTLICH aus der Notiz zitieren (validiert).',
  'Typen: janein | mc | freitext | bild. Karten mit "thema" gliedern (Kapitel der Notiz) – im',
  'Lernmodus laesst sich damit gezielt ein Thema ueben; fuer aeltere Kartensaetze ohne Themen',
  'traegt karten_gliedern sie nach, ohne den Lernstand anzufassen. Fuer Bild-Karten ZUERST read_bild aufrufen:',
  'das zeigt die Grafik und nennt ihre Pixelmasse, daraus die Rechtecke (x/y/w/h, 0..1) selbst',
  'bestimmen und ueber die gedruckte Beschriftung legen – die App verdeckt sie beim Abfragen.',
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

// ── Antwort-Helfer ────────────────────────────────────────────────────────────
// text():       reiner Text-Content (read_note-Inhalt)
// asJson():     JSON als Text – Format wie bisher, Clients parsen es
// structured(): JSON als Text PLUS structuredContent (fuer Tools mit outputSchema).
//               Arrays werden dafuer in { results, count } gehuellt – der Text bleibt das Array.
// fail():       echter Tool-Fehler (isError) – Claude sieht ihn als Fehler, nicht als Ergebnis
const text = (s) => ({ content: [{ type: 'text', text: s }] });
const asJson = (r) => text(JSON.stringify(r, null, 2));
const fail = (msg) => ({ isError: true, content: [{ type: 'text', text: String(msg) }] });
const structured = (r) => {
  const sc = Array.isArray(r) ? { results: r, count: r.length } : r;
  return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }], structuredContent: sc };
};
// Ergebnis eines tools.*-Aufrufs bewerten: { error } -> isError, sonst Erfolg.
// Schreib-/Vault-Operationen nennen den aufgeloesten Vault im Ergebnis – so ist
// unmissverstaendlich, WO geschrieben wurde, auch wenn kein vault-Param gesetzt war.
const withVault = (e, r) => (r && r.error) ? fail(`[${e.vault.name}] ${r.error}`) : text(JSON.stringify({ vault: e.vault.name, ...r }));
const plain = (r, wrap = asJson) => (r && r.error) ? fail(r.error) : wrap(r);

// Zentraler Wrapper: Exceptions (Vault nicht gefunden, Zod-Fehler aus Tools, EPERM ...)
// werden zu isError statt zu einem JSON-RPC-Fehler, der in Claude Desktop als
// "Tool kaputt" statt "Aufruf falsch" erscheint.
const run = (fn) => async (args, extra) => {
  try { return await fn(args ?? {}, extra); }
  catch (e) { return fail(e?.message || String(e)); }
};

// Annotations (MCP 2025-03-26): readOnlyHint / destructiveHint / idempotentHint / openWorldHint.
// Alles lokal im Vault -> openWorldHint immer false.
const RO   = { readOnlyHint: true,  destructiveHint: false, idempotentHint: true,  openWorldHint: false };
const ADD  = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }; // additiv, nicht wiederholbar
const IDEM = { readOnlyHint: false, destructiveHint: false, idempotentHint: true,  openWorldHint: false }; // schreibt, aber wiederholbar
const DEST = { readOnlyHint: false, destructiveHint: true,  idempotentHint: false, openWorldHint: false };
const DESTI = { readOnlyHint: false, destructiveHint: true, idempotentHint: true,  openWorldHint: false }; // ueberschreibt, aber gleicher Inhalt = gleiches Ergebnis

function tool(name, { description, input = {}, output, annotations, title }, fn) {
  server.registerTool(name, {
    title, description,
    inputSchema: input,
    ...(output ? { outputSchema: output } : {}),
    annotations,
  }, run(fn));
}

// ── Lese-Tools ────────────────────────────────────────────────────────────────
tool('list_vaults', {
  title: 'Vaults auflisten',
  description: 'Welche Vaults gibt es und welcher ist aktiv? Listet alle Vaults der Nexus-App (Name, Pfad, aktiv, Notiz-Anzahl) ' +
    'und nennt die Identitaet DIESES Servers (version, gitCommit, buildDate, dataDir) – wichtig, wenn nexus und nexus-dev gleichzeitig verbunden sind. ' +
    'In der App neu angelegte Vaults werden live erkannt.',
  output: {
    activeVault: z.string().nullable(),
    vaults: z.array(z.object({ name: z.string(), path: z.string(), active: z.boolean(), notes: z.number() })),
    server: z.object({ version: z.string(), gitCommit: z.string().nullable(), buildDate: z.string().nullable(), dataDir: z.string(), dev: z.boolean() }),
  },
  annotations: RO,
}, () => structured({ ...registry.list(), server: SERVER_INFO }));

tool('search', {
  title: 'Volltextsuche',
  description: 'Etwas im Vault finden, ohne Dateien zu lesen: Volltextsuche (FTS5) ueber alle Notizen, liefert Pfad, Titel und Treffer-Snippet. ' +
    'Ohne q: Notizliste (optional nach Tag gefiltert). Erster Schritt vor read_note.',
  input: {
    q:      z.string().optional().describe('Suchbegriff(e); FTS5-Syntax erlaubt (AND/OR/NOT, "Phrase", praefix*)'),
    limit:  limitParam(20),
    offset: offsetParam,
    tag:    z.string().optional().describe('Nach Tag filtern (optional)'),
    vault:  vaultParam,
  },
  output: {
    results: z.array(z.object({ path: z.string(), title: z.string().nullable().optional(), snippet: z.string().nullable().optional() })),
    count: z.number(),
  },
  annotations: RO,
}, ({ q, limit, offset, tag, vault }) => plain(registry.get(vault).tools.search({ q, limit, offset, tag }), structured));

tool('outline', {
  title: 'Gliederung einer Notiz',
  description: 'Struktur einer Notiz erfassen, bevor man sie liest: Ueberschriften mit Ebene und Zeile. Spart Tokens gegenueber read_note der ganzen Datei.',
  input: { path: z.string().describe('Relativer Pfad zur Notiz im Vault'), vault: vaultParam },
  annotations: RO,
}, ({ path, vault }) => plain(registry.get(vault).tools.outline({ path })));

tool('read_note', {
  title: 'Notiz lesen',
  description: 'Inhalt einer Notiz lesen – ganz, nur einen Abschnitt (section = Ueberschrift) oder die ersten N Zeilen. ' +
    'Bevorzugt abschnittsweise (maximale Information pro Token).',
  input: {
    path:    z.string().describe('Relativer Pfad zur Notiz im Vault'),
    section: z.string().optional().describe('Abschnittstitel (optional) – liefert nur diesen Abschnitt'),
    lines:   z.number().int().min(1).max(2000).optional().describe('Zeilenlimit (optional, 1..2000)'),
    vault:   vaultParam,
  },
  annotations: RO,
}, ({ path, section, lines, vault }) => {
  const r = registry.get(vault).tools.readNote({ path, section, lines });
  return r.error ? fail(r.error) : text(r.content);
});

tool('read_bild', {
  title: 'Grafik anzeigen',
  description: 'Eine Grafik aus dem Vault ALS BILD sehen (nicht als Pfad) und ihre Pixelmasse erfahren – noetig, um Rechtecke fuer ' +
    'Bild-Karteikarten zu bestimmen: Stelle im Bild suchen, Pixelkoordinaten ablesen, durch Breite bzw. Hoehe teilen -> x/y/w/h fuer write_karten. ' +
    'SVG kommt als Quelltext zurueck (dort stehen die Beschriftungen mit ihren Koordinaten).',
  input: { path: z.string().describe('Vault-Pfad der Grafik (png, jpg, webp, gif, bmp, avif, svg)'), vault: vaultParam },
  annotations: RO,
}, ({ path, vault }) => {
  const e = registry.get(vault);
  const r = e.tools.readBild({ path });
  if (r.error) return fail(`[${e.vault.name}] ${r.error}`);
  const { base64, svg, ...info } = r;
  const inhalt = [];
  // Der Bild-Block MUSS vor dem Text stehen – so sieht das Modell erst die Grafik
  // und liest die Masse danach als Rechenhilfe.
  if (base64) inhalt.push({ type: 'image', data: base64, mimeType: r.mime });
  inhalt.push({ type: 'text', text: JSON.stringify({ vault: e.vault.name, ...info }, null, 2) });
  if (svg) inhalt.push({ type: 'text', text: svg });
  return { content: inhalt };
});

tool('backlinks', {
  title: 'Rueckverweise',
  description: 'Welche Notizen verlinken auf diese? Liefert alle Notizen mit einem [[Link]] auf den Pfad – fuer Kontext und Verknuepfungen.',
  input: { path: z.string().describe('Relativer Pfad zur Notiz'), vault: vaultParam },
  annotations: RO,
}, ({ path, vault }) => plain(registry.get(vault).tools.backlinks({ path })));

tool('list_notes', {
  title: 'Notizen auflisten',
  description: 'Ueberblick ueber einen Ordner oder den ganzen Vault: listet Notizen (Pfad, Titel), optional nach Pfad-Praefix gefiltert, mit Pagination.',
  input: {
    prefix: z.string().optional().describe('z.B. "Uni/" fuer alle Uni-Notizen'),
    limit:  limitParam(100),
    offset: offsetParam,
    vault:  vaultParam,
  },
  output: { results: z.array(z.object({ path: z.string(), title: z.string().nullable().optional() })), count: z.number() },
  annotations: RO,
}, ({ prefix, limit, offset, vault }) => plain(registry.get(vault).tools.listNotes({ prefix, limit, offset }), structured));

tool('query', {
  title: 'Frontmatter-Abfrage',
  description: 'Notizen nach Frontmatter-Feldern filtern (z.B. status = todo, tags contains uni, due < 2026-10-01) – fuer Aufgaben-, Status- und Termin-Listen.',
  input: {
    field: z.string().describe('Frontmatter-Schluessel, z.B. "status", "tags", "due"'),
    op:    z.string().optional().describe('Operator: = | != | contains | exists | < | > (Standard: =)'),
    value: z.string().optional().describe('Vergleichswert (bei exists nicht noetig)'),
    limit: limitParam(100),
    vault: vaultParam,
  },
  annotations: RO,
}, ({ field, op, value, limit, vault }) => plain(registry.get(vault).tools.query({ field, op, value, limit })));

tool('dataview', {
  title: 'Dataview-Query',
  description: 'Dynamische Listen/Tabellen ueber den Vault wie Obsidians Dataview: DQL-Query (LIST/TABLE [WITHOUT ID], FROM "Ordner", ' +
    'WHERE mit AND/OR/!/contains()/Vergleichen, SORT feld ASC|DESC, LIMIT n, dateformat()). Gibt {kind, headers, rows, count} mit aufgeloesten Links zurueck.',
  input: {
    source: z.string().describe('Die DQL-Query, z.B.: LIST FROM "Wissen" WHERE file.name != "00 – Index" SORT file.mtime DESC LIMIT 5'),
    vault:  vaultParam,
  },
  output: { kind: z.string(), headers: z.array(z.any()).optional(), rows: z.array(z.any()), count: z.number() },
  annotations: RO,
}, ({ source, vault }) => plain(registry.get(vault).tools.dataview({ source }), structured));

tool('lern_status', {
  title: 'Lernstand',
  description: 'Wo steht der Nutzer im Lernmodus? Lesender Blick auf den Lernstand: faellige Karten je Fach und Notiz, Pruefungstermine, ' +
    'Restaufwand bis zur Pruefung, Trefferquote und die Karten mit den meisten Fehlversuchen – Grundlage fuer Lernplan und gezieltes Nachfragen.',
  input: {
    fach:  z.string().optional().describe('Fach-Name oder -ID einschraenken (Standard: alle)'),
    tage:  z.number().int().min(1).max(365).optional().describe('Betrachtungsfenster fuer den Verlauf in Tagen (Standard 30)'),
    vault: vaultParam,
  },
  output: { vault: z.string(), heute: z.string(), heuteFaellig: z.number().optional(), faecher: z.array(z.any()) },
  annotations: RO,
}, ({ fach, tage, vault }) => {
  const e = registry.get(vault);
  const r = e.tools.lernStatus({ fach, tage });
  return r.error ? fail(`[${e.vault.name}] ${r.error}`) : structured({ vault: e.vault.name, ...r });
});

tool('list_trash', {
  title: 'Papierkorb anzeigen',
  description: 'Was liegt im Papierkorb des Vaults? Listet geloeschte Notizen/Dateien (Original-Pfad, Loeschzeitpunkt, trashPath fuer restore), neueste zuerst.',
  input: { limit: limitParam(200, 1000), vault: vaultParam },
  output: { vault: z.string(), eintraege: z.array(z.object({ path: z.string(), trashPath: z.string(), geloescht: z.string(), bytes: z.number() })), gesamt: z.number() },
  annotations: RO,
}, ({ limit, vault }) => {
  const e = registry.get(vault);
  const r = e.tools.listTrash({ limit });
  const cfg = registry.config();
  return structured({ vault: e.vault.name, ...r, retentionDays: Number.isFinite(Number(cfg.trash?.retentionDays)) ? Number(cfg.trash.retentionDays) : 30 });
});

// ── Schreib-Tools ─────────────────────────────────────────────────────────────
tool('write_note', {
  title: 'Notiz schreiben',
  description: 'Eine Notiz komplett schreiben – bestehende ueberschreiben oder mit create:true neu anlegen. Atomar mit Read-Back. ' +
    'Fuer kleine Aenderungen lieber patch oder append_to_section.',
  input: {
    path:    z.string().describe('Relativer Pfad der .md-Notiz'),
    content: z.string().describe('Vollstaendiger neuer Inhalt'),
    create:  z.boolean().optional().describe('true = neue Datei erlaubt'),
    vault:   vaultParam,
  },
  annotations: DESTI,
}, ({ path, content, create, vault }) => { const e = registry.get(vault); return withVault(e, e.tools.writeNote({ path, content, create })); });

tool('append_to_section', {
  title: 'An Abschnitt anhaengen',
  description: 'Text an das Ende eines Abschnitts (Ueberschrift) einer Notiz anhaengen – z.B. eine neue Erkenntnis, einen Log-Eintrag. Nichts wird ueberschrieben.',
  input: {
    path:    z.string().describe('Relativer Pfad der Notiz'),
    section: z.string().describe('Ueberschrift des Abschnitts'),
    text:    z.string().describe('Anzuhaengender Text'),
    vault:   vaultParam,
  },
  annotations: ADD,
}, ({ path, section, text: t, vault }) => { const e = registry.get(vault); return withVault(e, e.tools.appendToSection({ path, section, text: t })); });

tool('patch', {
  title: 'Textstellen ersetzen',
  description: 'Gezielt einzelne Textstellen in einer Notiz ersetzen (Batch aus old_str -> new_str), ohne die Datei neu zu schreiben – ' +
    'fuer Korrekturen, Umformulierungen, Frontmatter-Werte. Meldet, welche old_str nicht gefunden wurden.',
  input: {
    path:    z.string().describe('Relativer Pfad zur Notiz im Vault'),
    patches: z.array(z.object({
      old_str: z.string().describe('Zu ersetzender Text (erste Fundstelle)'),
      new_str: z.string().optional().describe('Ersatztext (leer = loeschen)'),
    })).min(1).describe('Liste von Ersetzungen'),
    vault:   vaultParam,
  },
  annotations: DEST,
}, ({ path, patches, vault }) => { const e = registry.get(vault); return withVault(e, e.tools.patch({ path, patches })); });

tool('write_vortrag', {
  title: 'Vortragsskript schreiben',
  description: 'Ein Vortragsskript zu einer Notiz erzeugen (fuer den Vortrag-Button der App, <Notiz>.vortrag.json): Segmente {sprich, anker, art}, ' +
    'jeder anker wird woertlich gegen die Notiz validiert, der Notiz-Hash gestempelt. Ersetzt ein vorhandenes Skript.',
  input: {
    path:  z.string().describe('Pfad der .md-Notiz, zu der das Skript gehoert'),
    titel: z.string().optional().describe('Vortragstitel (optional)'),
    segmente: z.array(z.object({
      sprich: z.string().describe('Gesprochener Text des Segments – frei formuliert, mit Rueckbezuegen/Uebergaengen'),
      anker:  z.string().optional().describe('Woertlicher Textausschnitt aus der Notiz, der waehrend des Segments hervorgehoben wird'),
      art:    z.enum(['absatz', 'wort', 'tabelle', 'ueberschrift', 'keine']).optional()
                .describe('Hervorhebungsart (Standard: absatz; keine = nur sprechen, ohne anker)'),
    })).min(1).describe('Vortrags-Segmente in Sprechreihenfolge'),
    vault: vaultParam,
  },
  annotations: DESTI,
}, ({ path, titel, segmente, vault }) => { const e = registry.get(vault); return withVault(e, e.tools.writeVortrag({ path, titel, segmente })); });

tool('write_karten', {
  title: 'Karteikarten schreiben',
  description: 'Karteikarten/Abfrage/Lernkarten zu einer Notiz oder Vorlesung fuer den Lernmodus erzeugen (<Notiz>.karten.json). ' +
    'Validiert jede Karte gegen die Notiz (quelle woertlich), vergibt stabile IDs – der Lernstand bleibt ' +
    'bei einer Regeneration erhalten – und stempelt den Notiz-Hash. Ersetzt das komplette Kartenset der Notiz.',
  input: {
    path:  z.string().describe('Pfad der .md-Notiz, zu der die Karten gehoeren'),
    titel: z.string().optional().describe('Titel des Kartensets (optional)'),
    karten: z.array(z.object({
      id:  z.string().optional().describe('Nur setzen, wenn eine bestehende Karte gezielt geaendert wird (sonst weglassen – die ID wird ueber die Frage wiedererkannt)'),
      typ: z.enum(['janein', 'mc', 'freitext', 'bild'])
             .describe('janein = Aussage richtig/falsch · mc = Multiple Choice (auch mehrere richtige) · freitext = frei formulieren, der Nutzer bewertet sich selbst · bild = Begriffe Bildstellen zuordnen'),
      frage: z.string().describe('Die Frage bzw. die zu bewertende Aussage – pruefungsnah, Verstaendnis statt Wortlaut'),
      thema: z.string().optional()
             .describe('Kapitel/Abschnitt innerhalb der Notiz, z.B. "Robotik" oder "Fuegetechnik". Gliedert das Kartenset – im Lernmodus laesst sich damit gezielt ein Thema ueben. Gleiche Schreibweise fuer zusammengehoerige Karten verwenden'),
      antwort: z.union([z.boolean(), z.string()]).optional()
             .describe('janein: true/false · freitext: Musterloesung'),
      optionen: z.array(z.string()).optional().describe('mc: 2-8 Antwortoptionen (Distraktoren duerfen frei erfunden sein)'),
      korrekt:  z.array(z.number()).optional().describe('mc: Indizes der richtigen Optionen, 0-basiert (nicht alle)'),
      quelle: z.string().optional()
             .describe('WOERTLICHES Zitat aus der Notiz, das die Antwort belegt – Pflicht ausser bei typ "bild", wird serverseitig gegen die Notiz geprueft'),
      erklaerung: z.string().optional().describe('Kurze Erklaerung, wird nach dem Antworten angezeigt'),
      fragebild: z.string().optional().describe('Optionaler Vault-Pfad einer Grafik, die ZUR FRAGE gezeigt wird - fuer Fragen, die ohne die Abbildung nicht beantwortbar sind ("Ordnen Sie den drei dargestellten ... zu"). Muss existieren und darf die Loesung NICHT zeigen; ist die Loesung aufgedruckt, gehoert die Karte zu typ "bild" (Regionen decken sie ab) oder das Bild nach "loesungsbild"'),
      loesungsbild: z.string().optional().describe('Optionaler Vault-Pfad einer Grafik (z.B. Folienausschnitt), die NACH dem Antworten unter der Loesung gezeigt wird - fuer alle Kartentypen. Muss existieren. Da sie erst nach der Antwort erscheint, darf sie ruhig die ganze Skriptseite samt Dozententext zeigen'),
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
             .describe('bild: Rechtecke auf der Grafik. Ruf zuerst read_bild auf – damit siehst du die Grafik und bekommst ihre Pixelmasse; Pixelkoordinate durch Breite bzw. Hoehe geteilt ergibt x/y/w/h. Lege die Rechtecke ueber die Beschriftung, die dort gedruckt steht, damit sie beim Abfragen verdeckt wird. Ohne Regionen ist die Karte nicht spielbar, bis der Nutzer sie im Karten-Editor aufzieht'),
    })).min(1).describe('Alle Karten der Notiz (ersetzt das bisherige Set)'),
    vault: vaultParam,
  },
  annotations: DESTI,
}, ({ path, titel, karten, vault }) => { const e = registry.get(vault); return withVault(e, e.tools.writeKarten({ path, titel, karten })); });

tool('karten_gliedern', {
  title: 'Karten nach Themen gliedern',
  description: 'Themen fuer ein BESTEHENDES Kartenset nachtragen, ohne die Karten zu veraendern (fuer Kartensaetze, die vor der Themen-Gliederung entstanden sind): ' +
    'Jede Karte wird ueber ihr Belegzitat in der Notiz lokalisiert und bekommt die Ueberschrift darueber als Thema. ' +
    'Kartentexte und IDs bleiben unangetastet – der Lernstand bleibt erhalten.',
  input: {
    path:  z.string().describe('Pfad der .md-Notiz, deren Karten gegliedert werden sollen'),
    ebene: z.number().int().min(1).max(6).optional()
           .describe('Bis zu welcher Ueberschriften-Tiefe gruppiert wird (Standard 2 = "#" und "##"). Tiefere Ueberschriften zaehlen zum letzten Abschnitt dieser Tiefe'),
    ueberschreiben: z.boolean().optional()
           .describe('Standard false: bereits vergebene Themen bleiben stehen. true setzt alle neu'),
    vault: vaultParam,
  },
  annotations: IDEM,
}, ({ path, ebene, ueberschreiben, vault }) => { const e = registry.get(vault); return withVault(e, e.tools.karteGliedern({ path, ebene, ueberschreiben })); });

tool('reindex', {
  title: 'Index neu aufbauen',
  description: 'Den Suchindex eines Vaults neu aufbauen – nur noetig, wenn Dateien am Nexus vorbei geaendert wurden und search/outline veraltet wirken.',
  input: { vault: vaultParam },
  annotations: IDEM,
}, ({ vault }) => { const e = registry.get(vault); return withVault(e, e.tools.reindex()); });

// ── Ordner-/Datei-Operationen ─────────────────────────────────────────────────
tool('create_folder', {
  title: 'Ordner anlegen',
  description: 'Einen neuen Ordner im Vault anlegen (rekursiv) – statt Datei-System-/Mount-Operationen, die blockiert sind.',
  input: { path: z.string().describe('Relativer Ordnerpfad, z.B. "Uni/6. Semester/Neuer Ordner"'), vault: vaultParam },
  annotations: ADD,
}, ({ path, vault }) => { const e = registry.get(vault); return withVault(e, e.tools.createFolder({ path })); });

tool('move', {
  title: 'Verschieben / Umbenennen',
  description: 'Eine Notiz oder einen ganzen Ordner verschieben oder umbenennen (from -> to, gleicher Vault). Umbenennen = gleicher Elternordner, neuer Name. ' +
    'Sidecars (Karten, Vortrag) ziehen mit, der Index wird aktualisiert. Bevorzugt vor jeder Datei-System-/Mount-Operation nutzen.',
  input: {
    from:  z.string().describe('Aktueller relativer Pfad (Datei oder Ordner)'),
    to:    z.string().describe('Neuer relativer Pfad'),
    vault: vaultParam,
  },
  annotations: DEST,
}, ({ from, to, vault }) => { const e = registry.get(vault); return withVault(e, e.tools.move({ from, to })); });

tool('delete', {
  title: 'In den Papierkorb',
  description: 'Eine Notiz oder einen ganzen Ordner loeschen – verschiebt in den Papierkorb des Vaults (.trash/<Zeitstempel>/…), Sidecars ziehen mit; ' +
    'list_trash zeigt den Inhalt, restore holt zurueck. Geschuetzt: Vault-Wurzel, _System und .trash. ' +
    'permanent:true loescht endgueltig – NUR fuer Pfade, die bereits im Papierkorb liegen (trashPath aus list_trash).',
  input: {
    path:  z.string().describe('Relativer Pfad zur Notiz oder zum Ordner (bei permanent:true der trashPath aus list_trash)'),
    permanent: z.boolean().optional().describe('true = endgueltig loeschen, nur fuer Papierkorb-Eintraege (.trash/...)'),
    vault: vaultParam,
  },
  annotations: DEST,
}, ({ path, permanent, vault }) => { const e = registry.get(vault); return withVault(e, e.tools.delete({ path, permanent })); });

tool('restore', {
  title: 'Aus dem Papierkorb zurueckholen',
  description: 'Einen Eintrag aus dem Papierkorb an seinen Original-Ort zurueckholen (Sidecars folgen). path = trashPath aus list_trash ' +
    'oder der Original-Pfad (dann die neueste Kopie). Existiert das Ziel bereits, ist das ein Fehler – nichts wird ueberschrieben.',
  input: { path: z.string().describe('trashPath (".trash/<stamp>/<pfad>") oder Original-Pfad'), vault: vaultParam },
  annotations: ADD,
}, ({ path, vault }) => { const e = registry.get(vault); return withVault(e, e.tools.restore({ path })); });

tool('vault_check', {
  title: 'Vault-Gesundheit pruefen',
  description: 'Vault-Gesundheits-Check ueber den Live-Index (kein Voll-Reparse): kaputte Links, verwaiste Notizen, veraltete Daten (>30 Tage), ' +
    'Karteileichen, doppelte Dateinamen. Schreibt den vollen Bericht nach _System/Vault-Check.md (dry_run=true: nur lesen, nichts schreiben) ' +
    'und gibt eine kompakte Zusammenfassung zurueck. Regeln fuer persoenliche Bereiche stehen in nexus.config.json unter "vaultCheck".',
  input: {
    dry_run: z.boolean().optional().describe('true = nur pruefen, Bericht NICHT in den Vault schreiben'),
    vault:   vaultParam,
  },
  output: {
    vault: z.string(),
    notesScanned: z.number(),
    filesScanned: z.number(),
    summary: z.record(z.string(), z.number()),
    reportPath: z.string().nullable(),
  },
  annotations: IDEM,
}, ({ dry_run, vault }) => {
  const e = registry.get(vault);
  const regeln = registry.config().vaultCheck ?? {};
  const r = e.tools.vaultCheck({ dryRun: dry_run, regeln });
  return r.error ? fail(`[${e.vault.name}] ${r.error}`) : structured({ vault: e.vault.name, ...r });
});

const transport = new StdioServerTransport();
await server.connect(transport);
