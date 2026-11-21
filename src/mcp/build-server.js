// src/mcp/build-server.js – Fabrik fuer den Nexus-MCP-Server (R29/N7)
//
// buildServer({ registry, policy, info }) baut einen fertig bestueckten McpServer – OHNE Transport.
// Die Einstiegsdateien haengen nur noch den Transport an: src/server.js (stdio) heute,
// ein HTTP-Einstieg (Remote-Connector, R30) spaeter – ohne Kopie der Tool-Registrierung.
//
//   registry  Vault-Registry (makeVaultRegistry) – als PARAMETER, kein Modul-Singleton mehr.
//             Ein Prozess baut sie einmal und kann beliebig viele Server daraus bedienen.
//   policy    { allow(name, { annotations }) => boolean } – false = das Tool wird gar nicht
//             registriert (z. B. "nur lesen" fuer den Remote-Zugriff). Standard: alles erlaubt.
//   info      { name, version, gitCommit, buildDate, dataDir, dev } – Identitaet dieses Servers
//             (initialize + list_vaults.server).
//   onResult  optional: (name, args, result) => result – laeuft nach JEDEM Tool-Aufruf ueber das
//             fertige Ergebnis (auch Fehler). Der HTTP-Einstieg begrenzt damit die Antwortgroesse
//             und fuehrt sein Aufruf-Log; ohne Hook bleibt alles wie bisher.
//   onCall    optional: (name, args) => undefined | { error } | { args } – laeuft VOR jedem Tool-Aufruf.
//             { error } lehnt ab (das Tool laeuft nicht), { args } ersetzt die Argumente. Der
//             HTTP-Einstieg setzt damit seine Regeln je Aufruf durch (src/mcp/remote-policy.js).
//   erweitern optional: ({ tool, z, registry, antwort }) => void – registriert zusaetzliche Tools
//             ueber denselben Weg (Policy, Wrapper, Hooks). Fuer Tools, die nur ein Einstieg hat.
//   instructions  optional: eigener Hinweistext fuer initialize (Remote-Connector: Kurzfassung
//             ohne Schreib-Tools). Standard: die lokale Fassung NEXUS_INSTRUCTIONS.
//
// Multi-Vault: Der Server bedient ALLE Vaults aus nexus.config.json. Jedes Tool nimmt optional
// einen Vault-Namen (Standard: der in der App aktive Vault); list_vaults zeigt alle.
//
// R27b (Plan A1/A9/A12): registerTool statt server.tool – jedes Tool traegt
// annotations (readOnly/destructive/idempotent), sechs Lese-Tools liefern
// zusaetzlich outputSchema + structuredContent (Text-Fallback unveraendert), und
// EIN zentraler Wrapper macht aus r.error bzw. einer Exception einen echten
// Tool-Fehler ({ isError: true }) statt eines "ok"-Textes mit Fehlertext drin.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { SECTION_MAX_LINES } from '../tools.js';

// Optionaler Vault-Parameter, den jedes Tool versteht.
const vaultParam = z.string().optional()
  .describe('Vault-Name (Standard: der in der App aktive Vault; alle Namen: list_vaults)');
// R27b: Zod-Bounds statt nackter Zahlen.
const limitParam  = (def, max = 200) => z.number().int().min(1).max(max).optional().describe(`Max. Ergebnisse (Standard: ${def}, hoechstens ${max})`);
const offsetParam = z.number().int().min(0).optional().describe('Ergebnisse ueberspringen (Pagination, Standard: 0)');
// R31: Kollisionsschutz fuer Schreib-Tools.
const hashParam = z.string().max(80).optional()
  .describe('Optional: Hash des Stands, auf dem die Aenderung beruht (hash aus outline, read_note mit hash:true oder dem letzten Schreib-Ergebnis). Wurde die Notiz seither geaendert, wird NICHT geschrieben (Fehler nennt den aktuellen Hash)');

// Wird dem Client (z.B. Claude Desktop) beim Verbinden mitgegeben. Stoesst die
// Pflichtlektuere an, ohne dass jemand ans Lesen erinnern muss (Arbeitsweise-Regel 12).
// Die eigentlichen Regeln leben editierbar im Vault unter _System/ – Scaffold im App-Ordner unter rules/.
const NEXUS_INSTRUCTIONS = [
  'Du arbeitest auf persoenlichen Wissens-Vaults ueber die Nexus-Tools',
  '(list_vaults, search, outline, read_note, read_bild, write_note, capture, write_vortrag, write_karten, karten_gliedern,',
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
  'Bilden Kaesten eine reine Aufzaehlung ohne Positionsbezug (Stichpunktliste), gib ihnen dieselbe',
  '"gruppe" – dann ist jede Reihenfolge richtig; Bauteil-Beschriftungen und Legenden bleiben ohne gruppe.',
  'Ein erneutes write_karten ueberschreibt das Kartenset, erhaelt aber IDs und damit den Lernstand.',
  '',
  'PFLICHT zu Beginn jeder Session: zuerst die Arbeitsregeln des Nutzers lesen und befolgen –',
  'read_note "_System/Session-Start-Nexus.md", "_System/Arbeitsweise-Nexus.md" und',
  '"_System/Mein-Setup.md" im aktiven Vault (waehrend der Migration ggf. auch die Original-Dateien',
  '"_System/Session-Start.md"/"_System/Arbeitsweise.md"). Diese Dateien sind die Quelle',
  'der Wahrheit fuer die Arbeitsweise und werden ueber die Tools gepflegt.',
].join(' ');

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

// Ausgabe-Schemas sind OFFEN: sie garantieren die genannten Felder, erlauben aber weitere.
// Zod 4 setzt fuer z.object() im Output-Modus additionalProperties:false – Clients, die
// structuredContent gegen das outputSchema pruefen (SDK-Client, Cowork/Agent-SDK via Ajv),
// wuerden sonst jedes Zusatzfeld (samples, dryRun, retentionDays ...) als Fehler werten
// und das Tool-Ergebnis verwerfen. Gilt fuer die Wurzel (in tool()) UND fuer verschachtelte
// Objekte – deshalb unten ueberall offen({...}) statt z.object({...}) in output-Schemas.
const offen = (shape) => { const o = z.object(shape); return typeof o.loose === 'function' ? o.loose() : o.passthrough(); };

export function buildServer({ registry, policy = {}, info = {}, instructions = NEXUS_INSTRUCTIONS, onResult = null, onCall = null, erweitern = null } = {}) {
  if (!registry || typeof registry.get !== 'function') throw new Error('buildServer: registry fehlt');
  const erlaubt = typeof policy?.allow === 'function' ? policy.allow : () => true;
  // Identitaet fuer list_vaults – Felder wie im outputSchema (version/dataDir Pflicht, Rest nullable).
  const serverInfo = {
    version: info.version ?? '0.0.0',
    gitCommit: info.gitCommit ?? null,
    buildDate: info.buildDate ?? null,
    dataDir: info.dataDir ?? '',
    dev: !!info.dev,
  };

  const server = new McpServer(
    { name: info.name ?? 'nexus', version: serverInfo.version },
    { instructions }
  );

  let registriert = 0;
  function tool(name, { description, input = {}, output, annotations, title }, fn) {
    if (!erlaubt(name, { annotations })) return;
    registriert++;
    const roh = run(fn);
    // onCall: Regeln je Aufruf – ablehnen oder Argumente ersetzen, bevor das Tool laeuft.
    const aufruf = typeof onCall === 'function'
      ? async (args, extra) => {
          let r;
          try { r = onCall(name, args ?? {}); } catch (e) { return fail(e?.message || String(e)); }
          if (r?.error) return fail(r.error);
          return roh(r?.args ?? args, extra);
        }
      : roh;
    server.registerTool(name, {
      title, description,
      inputSchema: input,
      ...(output ? { outputSchema: offen(output) } : {}),
      annotations,
    }, typeof onResult === 'function'
      ? async (args, extra) => { const r = await aufruf(args, extra); return onResult(name, args ?? {}, r) ?? r; }
      : aufruf);
  }

  // ── Lese-Tools ────────────────────────────────────────────────────────────────
  tool('list_vaults', {
    title: 'Vaults auflisten',
    description: 'Welche Vaults gibt es und welcher ist aktiv? Listet alle Vaults der Nexus-App (Name, Pfad, aktiv, Notiz-Anzahl) ' +
      'und nennt die Identitaet DIESES Servers (version, gitCommit, buildDate, dataDir) – wichtig, wenn nexus und nexus-dev gleichzeitig verbunden sind. ' +
      'In der App neu angelegte Vaults werden live erkannt.',
    output: {
      activeVault: z.string().nullable(),
      vaults: z.array(offen({ name: z.string(), path: z.string(), active: z.boolean(), notes: z.number() })),
      server: offen({ version: z.string(), gitCommit: z.string().nullable(), buildDate: z.string().nullable(), dataDir: z.string(), dev: z.boolean() }),
    },
    annotations: RO,
  }, () => structured({ ...registry.list(), server: serverInfo }));

  tool('search', {
    title: 'Volltextsuche',
    description: 'Etwas im Vault finden, ohne Dateien zu lesen: Volltextsuche (FTS5) ueber alle Notizen, liefert Pfad, Titel und Treffer-Snippet. ' +
      'Ohne q: Notizliste (optional nach Tag gefiltert). Erster Schritt vor read_note. ' +
      'War die Suchsyntax nicht auswertbar, lief die einfache Suche nach allen Woertern – das Ergebnis traegt dann fallback:true und einen hinweis.',
    input: {
      q:      z.string().optional().describe('Suchbegriff(e). Einfach: Woerter ohne Sonderzeichen – alle muessen vorkommen, jedes Wort ab 4 Zeichen zaehlt als Wortanfang ' +
        '(Pruefung findet auch Pruefungen; es gibt kein Stemming). Genau: "exaktes Wort" oder "exakte Phrase"; Operatoren GROSS: AND, OR, NOT (a NOT b); Klammern; wortanfang*. ' +
        'Sobald Anfuehrungszeichen, Operatoren, Klammern oder * vorkommen, gilt nur noch, was dasteht (Wortanfang dann nur bei * und am letzten unquotierten Wort). ' +
        'Kaputte Syntax fuehrt nicht zum Fehler, sondern zur einfachen Suche nach allen Woertern.'),
      limit:  limitParam(20),
      offset: offsetParam,
      tag:    z.string().optional().describe('Nach Tag filtern (optional)'),
      vault:  vaultParam,
    },
    output: {
      results: z.array(offen({ path: z.string(), title: z.string().nullable().optional(), snippet: z.string().nullable().optional() })),
      count: z.number(),
      fallback: z.boolean().optional().describe('true = Suchsyntax nicht auswertbar, es lief die einfache Suche nach allen Woertern'),
      hinweis: z.string().optional().describe('nur bei fallback: was stattdessen gesucht wurde'),
    },
    annotations: RO,
  }, ({ q, limit, offset, tag, vault }) => {
    const d = registry.get(vault).tools.searchDetail({ q, limit, offset, tag });
    if (!d.fallback) return structured(d.results);
    // Rueckfall kennzeichnen: im structuredContent (fallback + hinweis) UND als eigener Textblock –
    // der erste Textblock bleibt das reine Ergebnis-Array wie immer.
    const hinweis = 'Suchsyntax nicht auswertbar (z. B. offenes Anfuehrungszeichen, offene Klammer, Operator ohne Begriff) – ' +
      (d.match ? `stattdessen einfache Suche nach allen Woertern: ${d.match}` : 'die Eingabe enthaelt kein suchbares Wort.');
    return {
      content: [
        { type: 'text', text: JSON.stringify(d.results, null, 2) },
        { type: 'text', text: `[Hinweis: ${hinweis}]` },
      ],
      structuredContent: { results: d.results, count: d.results.length, fallback: true, hinweis },
    };
  });

  tool('outline', {
    title: 'Gliederung einer Notiz',
    description: 'Struktur einer Notiz erfassen, bevor man sie liest: Ueberschriften mit Ebene und Zeile, dazu der hash des aktuellen Stands (fuer expected_hash). Spart Tokens gegenueber read_note der ganzen Datei.',
    input: { path: z.string().describe('Relativer Pfad zur Notiz im Vault'), vault: vaultParam },
    annotations: RO,
  }, ({ path, vault }) => plain(registry.get(vault).tools.outline({ path })));

  tool('read_note', {
    title: 'Notiz lesen',
    description: 'Inhalt einer Notiz lesen – ganz, nur einen Abschnitt (section = Ueberschrift) oder die ersten N Zeilen. ' +
      'Bevorzugt abschnittsweise (maximale Information pro Token).',
    input: {
      path:    z.string().describe('Relativer Pfad zur Notiz im Vault'),
      section: z.string().optional().describe('Abschnittstitel (optional) – liefert diesen Abschnitt bis zur naechsten Ueberschrift gleicher oder hoeherer Ebene (Unterabschnitte inklusive). Exakter Titel gewinnt vor Teiltreffer. Unbekannter Titel = Fehler mit der Liste der vorhandenen Ueberschriften'),
      lines:   z.number().int().min(1).max(2000).optional().describe(`Zeilenlimit (optional, 1..2000). Ohne Angabe: ganze Notiz bzw. hoechstens ${SECTION_MAX_LINES} Zeilen eines Abschnitts; Kuerzungen werden am Ende gemeldet`),
      hash:    z.boolean().optional().describe('true = am Ende eine Zeile "[hash: sha256:…]" anhaengen (Hash der ganzen Datei, als expected_hash fuer write_note/patch/append_to_section)'),
      vault:   vaultParam,
    },
    annotations: RO,
  }, ({ path, section, lines, hash, vault }) => {
    const r = registry.get(vault).tools.readNote({ path, section, lines, withHash: !!hash });
    if (r.error) return fail(r.error);
    // R31: der Hash steht – wie die Kuerzung – im Text, weil read_note nur Text liefert.
    if (hash && r.hash) r.content = `${r.content}\n\n[hash: ${r.hash}]`;
    // R29/N2: Eine Kuerzung steht im Text – read_note liefert nur Text, ein Flag im Ergebnisobjekt
    // saehe der Aufrufer nie. (Unbekannter Abschnitt ist ein Fehler: r.error mit Ueberschriftenliste.)
    if (r.truncated && r.sectionLines)
      return text(`${r.content}\n\n[gekuerzt: ${lines || SECTION_MAX_LINES} von ${r.sectionLines} Zeilen des Abschnitts "${r.section}" – mehr mit lines=${Math.min(r.sectionLines, 2000)} oder ueber einen Unterabschnitt (outline).]`);
    if (r.truncated)
      return text(`${r.content}\n\n[gekuerzt: ${lines} von ${r.totalLines} Zeilen der Notiz – mehr mit groesserem lines oder gezielt mit section.]`);
    return text(r.content);
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
    output: { results: z.array(offen({ path: z.string(), title: z.string().nullable().optional() })), count: z.number() },
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
    output: { vault: z.string(), eintraege: z.array(offen({ path: z.string(), trashPath: z.string(), geloescht: z.string(), bytes: z.number() })), gesamt: z.number() },
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
      expected_hash: hashParam,
      vault:   vaultParam,
    },
    annotations: DESTI,
  }, ({ path, content, create, expected_hash, vault }) => { const e = registry.get(vault); return withVault(e, e.tools.writeNote({ path, content, create, expectedHash: expected_hash })); });

  tool('append_to_section', {
    title: 'An Abschnitt anhaengen',
    description: 'Text an das Ende eines Abschnitts (Ueberschrift) einer Notiz anhaengen – z.B. eine neue Erkenntnis, einen Log-Eintrag. Nichts wird ueberschrieben.',
    input: {
      path:    z.string().describe('Relativer Pfad der Notiz'),
      section: z.string().describe('Ueberschrift des Abschnitts (exakter Titel gewinnt vor Teiltreffer). Unbekannter Titel = Fehler mit der Liste der vorhandenen Ueberschriften, es wird nichts geschrieben'),
      text:    z.string().describe('Anzuhaengender Text'),
      expected_hash: hashParam,
      vault:   vaultParam,
    },
    annotations: ADD,
  }, ({ path, section, text: t, expected_hash, vault }) => { const e = registry.get(vault); return withVault(e, e.tools.appendToSection({ path, section, text: t, expectedHash: expected_hash })); });

  tool('patch', {
    title: 'Textstellen ersetzen',
    description: 'Gezielt einzelne Textstellen in einer Notiz ersetzen (Batch aus old_str -> new_str), ohne die Datei neu zu schreiben – ' +
      'fuer Korrekturen, Umformulierungen, Frontmatter-Werte. Meldet, welche old_str nicht gefunden wurden.',
    input: {
      path:    z.string().describe('Relativer Pfad zur Notiz im Vault'),
      patches: z.array(z.object({
        old_str: z.string().describe('Zu ersetzender Text (erste Fundstelle). Darf mehrere Zeilen umfassen – Zeilenenden (CRLF/LF) werden beim Vergleich ignoriert'),
        new_str: z.string().optional().describe('Ersatztext (leer = loeschen); wird mit den Zeilenenden der Datei geschrieben'),
      })).min(1).describe('Liste von Ersetzungen'),
      expected_hash: hashParam,
      vault:   vaultParam,
    },
    annotations: DEST,
  }, ({ path, patches, expected_hash, vault }) => { const e = registry.get(vault); return withVault(e, e.tools.patch({ path, patches, expectedHash: expected_hash })); });

  tool('capture', {
    title: 'Schnell ablegen',
    description: 'Einen Gedanken, eine Aufgabe oder einen Fund SOFORT ablegen, ohne einen Ort zu waehlen: legt eine neue Notiz im Eingangsordner an ' +
      '("JJJJ-MM-TT HHMM – Titel.md", Standard-Ordner _Eingang). Ueberschreibt nie etwas. Einsortiert wird spaeter (move).',
    input: {
      text:  z.string().describe('Inhalt der Notiz (Markdown)'),
      titel: z.string().max(120).optional().describe('Titel (Standard: die erste Zeile des Textes)'),
      vault: vaultParam,
    },
    annotations: ADD,
  }, ({ text: t, titel, vault }) => {
    const e = registry.get(vault);
    const ordner = registry.config().capture?.folder;
    return withVault(e, e.tools.capture({ text: t, titel, ...(typeof ordner === 'string' && ordner ? { ordner } : {}) }));
  });

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
          gruppe: z.string().max(40).optional()
               .describe('Optional: Kaesten mit gleichem Gruppennamen sind beim Abfragen untereinander VERTAUSCHBAR (jeder Begriff nur einmal). Setzen bei reinen Aufzaehlungen ohne Positionsbezug – Stichpunktliste, gleichrangige Begriffe untereinander. NICHT setzen bei Bauteil-Beschriftungen einer Skizze, Ziffern-Legenden oder Prozessketten, dort ist die Position der Lerninhalt. Eine Gruppe braucht mindestens 2 Regionen; weglassen = feste Stelle'),
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
      'Karteileichen, doppelte Dateinamen, Sync-Konfliktdateien (*.sync-conflict-*). Schreibt den vollen Bericht nach _System/Vault-Check.md (dry_run=true: nur lesen, nichts schreiben) ' +
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

  // Zusaetzliche Tools eines Einstiegs (z. B. datei_link im HTTP-Einstieg).
  if (typeof erweitern === 'function') erweitern({ tool, z, registry, antwort: { text, asJson, fail, structured }, annotations: { RO, ADD, IDEM, DEST, DESTI } });

  // "$schema" aus den Tool-Schemas entfernen (Cowork-Fix, 2026-10-04).
  // Das SDK (bis mindestens 1.32) konvertiert Zod->JSON-Schema fest mit target draft-7 und
  // ohne Option; Zod 4 schreibt dabei "$schema": draft-07 in jedes input-/outputSchema.
  // MCP legt als Standard-Dialekt JSON Schema 2020-12 fest – Clients wie Cowork/Agent-SDK
  // pruefen outputSchemas mit Ajv 2020 und lehnen draft-07 ab ("unsupported dialect"):
  // ALLE Tools mit outputSchema waeren dort unbenutzbar. Ohne "$schema" gilt der Standard-
  // Dialekt, und die Schemas sind in beiden Dialekten identisch gueltig.
  // Der tools/list-Handler des SDK ist nur ueber _requestHandlers erreichbar (kein Hook,
  // keine Option) – daher der Griff ins Private; die Neu-Registrierung laeuft ueber die
  // oeffentliche setRequestHandler-API. Fehlt der Handler (SDK-Umbau), passiert nichts.
  const listToolsOrig = server.server._requestHandlers?.get('tools/list');
  if (typeof listToolsOrig === 'function') {
    server.server.setRequestHandler(ListToolsRequestSchema, async (req, extra) => {
      const r = await listToolsOrig(req, extra);
      for (const t of r.tools ?? []) {
        if (t.inputSchema) delete t.inputSchema.$schema;
        if (t.outputSchema) delete t.outputSchema.$schema;
      }
      return r;
    });
  } else if (registriert > 0) {
    console.error('[nexus] Warnung: tools/list-Handler nicht gefunden – "$schema" bleibt in den Tool-Schemas.');
  }

  return server;
}
