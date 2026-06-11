# Nexus – Build-Status (Session-Tracker)

> **Fuer jede neue Session (Cowork oder Claude Code): DIESE DATEI ZUERST LESEN.**
> Sie ist die einzige Quelle der Wahrheit ueber den Baufortschritt. Nach jedem
> Arbeitsblock aktualisieren (Erledigt -> abhaken, Naechste Schritte -> fortschreiben).
> Konzept: Obsidian-Vault `Projekt Vault-App/01 - Konzept.md`

## Projektziel (Kurzform)

MCP-Server (Node.js) + Web-UI fuer Pauls Knowledge-Base.
Multi-Vault-Architektur: App in `D:\Nexus`, Vaults in `D:\Knowledge-base\` (wie Obsidian: App != Vault).
Web-UI mit Drag&Drop, Rechtsklick-Markitdown-Konvertierung.
Sprache: **JavaScript/Node, KEIN Rust** (Entscheidung 2026-06-10).

## Stand: 2026-06-10 (Session 7)

### Erledigt (Session 7 - Test-Verifikation)
- [x] **Sandbox lief.** `node test/smoke.js` in /tmp-Kopie (eigenes `npm install`) ausgefuehrt: **48 bestanden, 0 Fehler.**
- [x] Damit ist die seit Session 5/6 ausstehende Test-Verifikation erledigt. Verifiziert sind u.a.: search-FTS-Fix, Sonderzeichen-Sanitizing (`buildFtsQuery`), leere-Eingabe -> leeres Array, Pagination (`offset` bei search + listNotes), Schema-Version=3, patch-Tool (5 Faelle), query-Filter, deleteFile.
- [x] Keine Code-Aenderung noetig - Session-5/6-Code besteht alle Tests.
- [ ] **Offen / Richtungsentscheidung (P3):** UI-Vault-Management, UI-Suche gegen MCP verdrahten. Warten auf Pauls Entscheidung.

## Stand: 2026-06-10 (Session 6)

### Erledigt
- [x] Scaffold: package.json, nexus.config.json, CLAUDE.md, STATUS.md
- [x] **nexus.config.json** -> Multi-Vault-Modell: `vaultsRoot`, `vaults[]`, `activeVault`, `ui.port`
- [x] **src/db.js** -> SQLite-Schema (notes, headings, links, notes_fts FTS5, Trigger)
- [x] **src/parse.js** -> Frontmatter (yaml), Headings+Zeilennr., [[Wikilinks]], #tags
- [x] **src/indexer.js** -> Vollscan + inkrementell (mtime-Vergleich), Stale-Removal
- [x] **src/tools.js** -> search, outline, read_note, write_note, append_to_section, backlinks, list_notes, reindex
- [x] **src/server.js** -> MCP stdio-Server (startet Reindex, registriert alle Tools)
- [x] **src/cli.js** -> manueller Reindex fuer alle Vaults
- [x] **src/ui-server.js** -> Express-Server: Dateibaum-API, Drag&Drop-Upload, Markitdown-Konvertierung, Datei-Preview
- [x] **public/index.html** -> Single-Page-UI: Sidebar-Tree, Drag&Drop, Rechtsklick-Menue, Suche, Preview, Toast-Feedback
- [x] **package.json** -> express + multer ergaenzt
- [x] **test/smoke.js** - 25/25 Tests gruen (Session 3: parse, indexer, tools)
- [x] Bugfixes FTS5, lineNo, backlinks, /api/reindex (Session 3)
- [x] Setup auf Pauls PC: npm install, Vault nach D:\Knowledge-base, pip install markitdown (Session 4)

### Erledigt (Session 4 - P0.2)
- [x] **File-Watcher (chokidar)**: `watchVault()` in indexer.js, `deleteFile()` fuer unlink-Events
- [x] **`query`-Tool**: Frontmatter-Filter (=, !=, contains, exists, <, >) in tools.js + server.js
- [x] **chokidar** in package.json ergaenzt, `npm install` auf PC noetig
- [x] **test/smoke.js** auf 32 Tests erweitert (query, deleteFile)
- [x] **Wichtig**: Edit-Tool verursacht Truncation-Bugs bei Sonderzeichen/Backslashes -> alle Dateiaenderungen per bash `cat > file << 'EOF'`

### Erledigt (Session 5 - P0+P1+P2)
- [x] **P0: `search` FTS-Bug behoben** (Ursache: veraltetes `.nexus/*.db`-Schema + unsicherer Query-Builder)
  - Diagnose: `IF NOT EXISTS` verhinderte FTS5-Schema-Update nach Spalten-Aenderung -> `snippet(notes_fts,2,...)` griff auf nicht-existente Spalte zu -> SQL logic error
  - Fix 1: **Schema-Versionspruefung in db.js** (SCHEMA_VERSION=3): beim Mismatch werden alle Tabellen geloescht + neu angelegt. Selbstheilend: naechster Server-Neustart triggert automatisches Rebuild.
  - Fix 2: **Query in tools.js**: JOIN entfernt (FTS5-Hilfsfunktionen + rank direkter Tabellenzugriff benoetigen keinen Alias), separate noteTags-Abfrage fuer Tag-Filter.
  - Fix 3: **buildFtsQuery()**: entfernt alle FTS5-Sonderzeichen (+ - " ( ) * ^), haengt `*` je Wort an.
  - Activation: MCP-Server neu starten (kein manuelles DB-Loeschen noetig -- Versionscheck erledigt das)
- [x] **P1: `patch`-Tool** implementiert (tools.js + server.js)
  - Input: `{ path, patches: [{ old_str, new_str }] }`
  - Ersetzt erste Fundstelle jedes old_str (analog Edit-Tool), gibt applied + missed zurueck
- [x] **P2: Pagination** fuer `search` und `list_notes` (`offset`-Parameter ergaenzt)
- [x] **test/smoke.js** erweitert: 46 assert-Stellen (verifiziert beim naechsten `node test/smoke.js`-Lauf)
  - Neu: snippet-nicht-null, Sonderzeichen-Sanitizing, leere-Eingabe, Pagination, Schema-Version, patch (6 Tests)

### Erledigt (Session 6 - Verifikation + P2-Lueckenschluss)
- [x] **P0 search-Fix LIVE verifiziert** gegen laufenden MCP-Server: `search("Controlling")` liefert Treffer, `search('Langguth++-"()')` liefert Treffer ohne SQL logic error. buildFtsQuery-Sanitizer ist live aktiv. Server laeuft auf Session-5-Code.
- [x] **P2-Befund: Pagination war nur halb fertig.** `offset` war in tools.js implementiert, aber in server.js bei `search` UND `list_notes` nicht im Schema/Handler -> ueber die MCP-Schnittstelle wurde offset stillschweigend verworfen.
- [x] **Fix:** `offset` in server.js bei `search` und `list_notes` ergaenzt (Schema + Handler reicht Parameter an T.search/T.listNotes durch). Wirksam beim naechsten MCP-Server-Neustart.
- [x] Statische Pruefung smoke.js (Note-Count durch alle Schritte durchgespielt -> konsistent). **ACHTUNG:** `node test/smoke.js` konnte NICHT laufen (Linux-Sandbox war diese Session nicht startbar). Beim naechsten Sandbox-Lauf nachholen.

### Naechste Schritte (Session 6)

**Sofort beim naechsten Sandbox-Zugang**
- [x] ERLEDIGT Session 7: `node test/smoke.js` -> 48 bestanden, 0 Fehler.

**P3 -- spaeter**
- Vault anlegen/entfernen per UI; Vault-Wechsel ohne UI-Neustart.
- Frontmatter-Validierung (Pflichtfelder, Type-Checks) -- bewusst verschoben.
- Web-UI: Suche live gegen MCP-Tools verdrahten (derzeit eigenstaendige Implementierung).

**Abschluss jeder Session**
- `node test/smoke.js` laufen lassen (Sandbox/Linux), Zahl verifizieren.
- STATUS.md fortschreiben BEVOR Session endet (nicht aus dem Gedaechtnis rekonstruieren).
- Vault-Archivierung (Pauls Regel 1).

**P3 -- spaeter (nicht diese Session)**
- Vault anlegen/entfernen per UI; Vault-Wechsel ohne UI-Neustart.

### Bekannte Lücken / TODO
- [x] `npm install` auf PC erledigt (chokidar installiert, Server laeuft live)
- [x] **`search`-Tool wirft live `SQL logic error`** -- behoben (Session 5: Schema-Version + Query-Fix)
- [x] `patch`-Tool implementiert (Session 5)
- [x] Pagination fuer search + list_notes (Session 5)
- [ ] Vault anlegen/entfernen per UI (aktuell nur ueber nexus.config.json manuell)
- [x] File-Watcher (chokidar) fuer automatischen Reindex
- [x] Smoke-Tests geschrieben und alle gruen (test/smoke.js, ~46 assert-Stellen)

### Technische Hinweise fuer kuenftige Sessions
- **Edit-Tool** schneidet Dateien bei Backslash-Regex-Mustern (`/\\/g`) und Sonderzeichen ab
  -> Loesung: Dateiaenderungen immer per `bash: cat > file << 'EOF' ... EOF`
- **package.json description** darf keine UTF-8-Sonderzeichen enthalten (Write-Tool-Bug)
- node:sqlite ist experimentell (Warning normal, kein Fehler)

## Architektur

```
D:\Nexus\                    <- App (Code, node_modules)
  nexus.config.json          <- { vaultsRoot, activeVault, vaults[], ui }
  package.json
  src/
    db.js                    <- SQLite-Schema + openDb()
    parse.js                 <- Frontmatter, Headings, Wikilinks, Tags
    indexer.js               <- buildIndexer() + watchVault() + deleteFile()
    tools.js                 <- makeTools() -> search, outline, read_note, write_note,
                                append_to_section, backlinks, list_notes, reindex, query
    server.js                <- MCP stdio-Server (Claude Desktop)
    ui-server.js             <- Express-Web-UI + REST-API (Port 3000)
    cli.js                   <- manueller Reindex
  public/
    index.html               <- Single-Page-App (Tree, Drag&Drop, Suche, Preview)
  .nexus/
    <vault-name>.db          <- SQLite-Indizes (wegwerfbar)
    tmp/                     <- Multer Upload-Temp

D:\Knowledge-base\           <- Vault-Inhalt (direkt, kein Unterordner)
```

## Setup auf Pauls PC

```bash
# 1. Abhaengigkeiten installieren (in D:\Nexus) -- chokidar neu in Session 4
npm install

# 2. UI starten
node src/ui-server.js
# -> http://localhost:3000

# 3. MCP-Server fuer Claude Desktop (claude_desktop_config.json):
# {
#   "mcpServers": {
#     "nexus": { "command": "node", "args": ["D:\\Nexus\\src\\server.js"] }
#   }
# }
```

## Usage-Log (Regel 22)
| Session | Datum | Inhalt | Start % | End % |
|---|---|---|---|---|
| 1 | 2026-06-10 | Scaffold | 60 | 79 |
| 2 | 2026-06-10 | Multi-Vault-Config, Indexer, Markitdown (Web-UI Drag&Drop, Markitdown) | 79 | ~95 |
| 2b | 2026-06-10 | better-sqlite3 -> node:sqlite (kein Compiler), Vault-Pfad auf D:\Knowledge-base direkt | 95 | ~97 |
| 3  | 2026-06-10 | Smoke-Tests (25/25), Bugfixes FTS/lineNo/backlinks, /api/reindex | ~97 | ~99 |
| 4  | 2026-06-10 | Setup PC (npm, markitdown), File-Watcher (chokidar), query-Tool, 32 Tests | ~15 | ~40 |
| 5  | 2026-06-10 | P0: search FTS-Fix (Schema-Version + kein JOIN + buildFtsQuery), P1: patch-Tool, P2: Pagination | ~5 | ~25 |
| 6  | 2026-06-10 | P0 live verifiziert (search ok, Sonderzeichen ok); P2-Luecke gefunden+gefixt (offset in server.js); Sandbox down -> smoke.js offen | ~25 | ~30 |
| 7  | 2026-06-10 | smoke.js in Sandbox gelaufen: 48 bestanden, 0 Fehler. Test-Verifikation aus Session 5/6 abgeschlossen. Nur P3 offen. | ~30 | ~32 |
| 8  | 2026-06-10 | Electron-Spike: node:sqlite entschaerft (Electron 42/Node 24), in-process-Modell, Scaffold (electron/main.js + preload.cjs), headless verifiziert | ~32 | ~38 |
## Stand: 2026-06-10 (Session 8 – Electron-Spike)

### Erledigt
- [x] **Risiko 1 – node:sqlite unter Electron: ENTSCHAERFT**
  - Electron 42.4.0 (aktuell stabil) buendelt **Node 24.16.0** (weit ueber Mindest 22.5).
  - node:sqlite ist im Electron-Hauptprozess direkt verfuegbar (kein Workaround noetig).
  - Quelle: https://releases.electronjs.org/releases.json

- [x] **Risiko 2 – Prozessmodell: In-process gewaehlt**
  - Gewaehlter Ansatz: `ui-server.js` wird per dynamischem `import()` direkt im Electron-Hauptprozess geladen.
  - Begruendung:
    1. Electron 42 buendelt Node 24.16.0 → alle Imports (node:sqlite, express, chokidar) funktionieren unveraendert.
    2. Vollstaendig self-contained: kein gebundetes Node-Binary noetig, kein separates node.exe.
    3. `import.meta.url` in ui-server.js zeigt korrekt auf `src/ui-server.js` → `__dir` und Config-Pfad stimmen.
    4. Kein Code-Change in ui-server.js erforderlich.
  - Alternativen verworfen:
    - Child-Prozess (system Node): Paul muesste Node separat installiert haben (keine self-contained Distribution).
    - sql.js/wasm: Grosser Refactor von db.js, kein Mehrwert fuer diesen Spike.
    - better-sqlite3 + electron-rebuild: native Addon, Rebuild pro Electron-Version noetig, viel Komplexitaet.
    - Child-Prozess (gebundeltes Node-Binary): Overkill fuer den Spike.

- [x] **Scaffold gebaut**
  - `electron/main.js`: Laedt ui-server.js in-process, wartet per `waitForPort()` bis Express bindet, oeffnet BrowserWindow auf http://localhost:3000, beendet sauber bei `window-all-closed`.
  - `electron/preload.cjs`: Minimal-Preload (CJS via .cjs-Extension, da package.json "type":"module"). Erweiterungspunkt fuer spaeteres contextBridge-Exposing.
  - `package.json`: `"app": "electron electron/main.js"` als npm-Script, `"electron": "^42.0.0"` als devDependency.

- [x] **Headless-Verifikation in Linux-Sandbox**
  - ui-server.js gestartet, Port 3000 nach 500ms erreichbar.
  - `/api/vaults` → `[{"name":"test","active":true}]` ✓
  - `/api/tree` → Dateiliste ✓
  - `/api/search?q=Hello` → Treffer mit Snippet ✓
  - node:sqlite ExperimentalWarning erscheint (normal, kein Fehler).

- [x] **Bugfix: ERR_UNSUPPORTED_ESM_URL_SCHEME (Windows)**
  - `import()` braucht file://-URL, keinen rohen Windows-Pfad (`d:\...`).
  - Fix: `pathToFileURL(join(...)).href` in `electron/main.js` (eine Zeile).

- [x] **Bugfix: autoOpen oeffnet Browser-Fenster parallel zum Electron-Fenster**
  - `ui-server.js` hat autoOpen nicht deaktiviert wenn Electron aktiv ist.
  - Fix: `if (cfg.ui?.autoOpen && !process.versions.electron)` in `ui-server.js`.

- [x] **Spike live verifiziert auf Pauls Windows-Rechner: funktioniert.**

### Offen / Naechste Schritte

**Windows-Checkliste fuer Paul (einmalig nach dieser Session):**
1. `npm install` in `D:\Nexus` (installiert Electron als devDependency, ~200 MB)
2. `npm run app`
3. Erwartet: Electron-Fenster oeffnet sich, zeigt die Nexus-Web-UI auf http://localhost:3000
4. Falls Fenster leer/Fehler: DevTools (Ctrl+Shift+I) pruefen, Konsole ansehen

**Nicht gemacht (bewusst):**
- Kein Installer (NSIS/Squirrel), kein Icon, kein Code-Signing, kein Auto-Update.
- Electron Builder / Forge: folgt nach Akzeptanz des Spikes durch Paul.

**P3 (aus Session 7, weiterhin offen):**
- Vault anlegen/entfernen per UI; Vault-Wechsel ohne UI-Neustart.
- Web-UI-Suche live gegen MCP-Tools verdrahten.


## Stand: 2026-06-10 (Session 9 – UI-Rebuild nach Mockup)

### Erledigt
- [x] **public/index.html komplett neu geschrieben** (794 Zeilen) nach `Projekt Vault-App/Dateien/Nexus UI-Mockup.html`
  - 3-Spalten-Layout: Sidebar (230px) | Note-Bereich | Rechts-Panel (370px)
  - Farbschema: `#07090f` + Radial-Gradient (wie Mockup, statt altem `#1a1a2e`)
  - Titlebar: `◆ NEXUS`, Breadcrumb (vault/ordner/datei), centrale Suchleiste
  - Sidebar: Top-Level-Ordner mit Farb-Dots + Dateianzahl, aufklappbarer Dateibaum, deterministisches Farbsystem (`folderColor()`)
  - Command Palette (Ctrl+K): Suche live gegen `/api/search`, ↑↓ Navigation, Enter öffnet Datei
  - WebGL-Graph: animiertes Cluster-Sim aus Mockup, Knoten proportional zur Dateianzahl pro Ordner
  - Claude-Aktivitätslog: client-seitiges Tracking aller Aktionen (search, read_note, upload, reindex, markitdown)
  - Statusbar: MCP-Status, Index-Dateianzahl, Vault-Name
  - Alle bisherigen Funktionen beibehalten: Drag&Drop, Markitdown, Reindex, Rechtsklick-Menü, Vault-Switcher

### Offen / Nächste Schritte
- [ ] **Vault-Management per UI**: Vault anlegen, entfernen, wechseln ohne Neustart (API-Endpoints + UI-Modal)
- [ ] **Markdown-Rendering** im Note-Bereich (Headings, Wikilinks, Callouts) – Opus/Fable empfohlen
- [ ] **Graph-Interaktivität**: Klick auf Knoten → Backlinks, Hover-Labels
- [ ] **npm install + npm run app** testen auf Pauls PC (Electron-Fenster mit neuer UI)

### Technische Entscheidungen Session 9
- `folderColor(name)`: COLORS-Map für bekannte Ordner, deterministischer HSL-Fallback per Name-Hash
- Graph-Nodes: Hub-Radius proportional zu Dateianzahl (max 30 Satelliten); kein Rebuild bei Vault-Wechsel nötig (initGraph() wird bei loadVault() neu aufgerufen)
- Activity Log: rein client-seitig, kein neuer API-Endpoint nötig

| Session | Datum | Inhalt | Start % | End % |
|---|---|---|---|---|
| 9 | 2026-06-10 | UI-Rebuild nach Mockup: 3-Spalten, Farb-Dots, Command Palette, Graph, Activity Log | ~38 | ~45 |

## Stand: 2026-06-10 (Session 10 – Markdown-Rendering, HTML-Inline, Graph-Interaktivität)

### Erledigt
- [x] **Umfangreicher Markdown-Renderer (vanilla JS, ohne Dependencies)** in `public/index.html`, gekapselt zwischen den Markern `//__MD_START__ … //__MD_END__` (DOM-frei → isoliert in Node testbar).
  - Headings mit Slug-Anchors + Hover-`#`, Bold/Italic/Bold-Italic, ==Highlight==, ~~Strike~~, `inline code`.
  - **Wikilinks** `[[Ziel]]`, `[[Ziel|Alias]]`, `[[Ziel#Abschnitt]]` mit Live-Auflösung gegen `noteIndex` (Basename + Pfad); nicht auflösbare Links rot/gestrichelt → Klick startet Suche.
  - **Embeds** `![[bild.png]]` (inline-Bild) und `![[Notiz#Abschnitt]]` (Transklusion: lazy-fetch + gerendert, Abschnitts-Extraktion via `extractSection`).
  - **Callouts** (Obsidian-Flavor, ~30 Typen mit Icon/Farbe), inkl. kollabierbar `[!tip]-`/`[!tip]+`, verschachtelte Blöcke (Code/Listen) im Callout-Body.
  - Tabellen (Ausrichtung `:--`/`--:`/`:-:`), Codeblöcke mit Sprach-Label + Kopieren-Button, Tasklisten `- [ ]`/`- [x]`, verschachtelte Listen, Blockquotes, HR, Footnotes `[^1]`, Tags (klickbar → Suche), Auto-Links.
  - **Frontmatter** → Eigenschaften-Panel (`<details>`-Tabelle, Listen als Chips, URLs verlinkt).
  - **Math** (`$…$`, `$$…$$`) und **Mermaid** (```mermaid```): lazy-CDN-Load (KaTeX/Mermaid) mit Fallback auf Quelltext, falls offline.
- [x] **Neue Anzeige-Ideen**: TOC/Inhaltsverzeichnis aus Headings (klickbar, scrollt), Reading-Stats (Wortzahl + ~Lesezeit + Abschnittszahl), **Backlinks-Panel** unter jeder Notiz (Endpoint `/api/backlinks`), Tag-Chips in der Meta-Leiste.
- [x] **HTML-Dateien werden in Nexus selbst gerendert** (nicht im Browser): `.html/.htm` → sandboxed `<iframe srcdoc>` (`sandbox="allow-scripts allow-popups allow-forms allow-modals"`) mit Vorschau/Quelltext-Umschalter. Zusätzlich Inline-Viewer für PDF (iframe), Bilder, CSV/TSV (als Tabelle), und Code/Text (mit Kopieren).
- [x] **Graph-Interaktivität**: zwei Modi – *Vault* (animierte Ordner-Cluster) und *Notiz-Graph* (Ego-Graph: aktuelle Notiz im Zentrum, ausgehende Wikilinks blau + Backlinks grün). Hover-Tooltips, Klick auf Knoten öffnet Datei, Klick auf Ordner-Hub → Ordner-Übersicht, Pan per Drag. Beim Öffnen einer Notiz schaltet der Graph automatisch in den Ego-Modus.
- [x] **Backend**: `/api/backlinks` und `/api/outline` in `src/ui-server.js` ergänzt (rufen `tools.backlinks` / `tools.outline`).

### Verifikation (Session 10)
- [x] Renderer-Kern isoliert in Node getestet (Stub für esc/escHtml/fileUrl/resolveWiki/vaultTree): Frontmatter, Headings+Slugs, Wikilinks (aufgelöst + broken + Alias + Anchor), Tags, Embeds (Bild + Transklusion), Callouts (Warning + kollabierter Tip + Code/Liste im Body), verschachtelte/Task-/Ordered-Listen, Tabelle (beide Datenzeilen + Ausrichtung), Codeblock (HTML-escaped), Math inline+Block, Footnotes, HR – alles korrekt.
- [x] **Gefundene + behobene Bugs:** (1) Platzhalter-Restore in `mdInline` nutzte blanke Ziffern `(\d+)` → kollidierte mit echten Zahlen im Text → eindeutige `@@K..@@`-Token. (2) Tabellen-Trennzeile wurde übersprungen *und* nochmal `shift()`-entfernt → erste Datenzeile + Ausrichtung fehlten → nur einmal vorrücken. (3) Doppel-Escaping (`&` → `&amp;amp;`) bei URLs/Links/Embeds/Wikilink-Labels, weil Inline-Konstrukte auf bereits ge-escaptem Text laufen und nochmal escaped wurden → Re-Escaping entfernt. (4) `cssAttr` escapt jetzt auch Apostrophe (deutsche Dateinamen).
- [x] `node --check` über das komplette `<script>` (≈48 KB) → OK. `node --check src/ui-server.js` → OK.

### Offen / Nächste Schritte
- [ ] **Auf Pauls PC testen**: `npm run app` (Electron) – neue Notiz öffnen → Markdown-Render prüfen; eine `.html`-Datei öffnen → Inline-Render prüfen; Graph-Knoten anklicken. Mermaid/KaTeX brauchen Internet (sonst Fallback = Quelltext).
- [ ] **Vault-Management per UI** (Vault anlegen/entfernen/wechseln ohne Neustart) – weiterhin offen (P3).
- [ ] Optional: Such-Snippet-Klick direkt zur Trefferstelle scrollen; KaTeX/Mermaid lokal bündeln (offline-fest).

| Session | Datum | Inhalt | Start % | End % |
|---|---|---|---|---|
| 10 | 2026-06-10 | Markdown-Renderer (Callouts, Wikilinks, Embeds, Tabellen, Code, Math, Mermaid), TOC/Stats/Backlinks-Panel, HTML-Inline-Rendering (sandboxed iframe) + PDF/Bild/CSV-Viewer, Graph-Interaktivität (Ego-Graph, Hover, Klick, Pan), /api/backlinks+outline | ~45 | ~58 |

### Nachtrag Session 10 (autonom, ohne Paul am PC)
- [x] **Vault-Management per UI fertig** (P3 abgehakt): `+`-Button öffnet ein Modal.
  - Backend `src/ui-server.js`: `POST /api/vaults/create` (legt Ordner unter `vaultsRoot` an, baut Indexer/Tools, persistiert `nexus.config.json`), `POST /api/vaults/remove` (entfernt aus Config, **löscht keine Dateien**, schützt den letzten Vault), `POST /api/vaults/active` (+ `saveConfig`/`safeVaultName`).
  - Frontend: Modal listet Vaults (aktiv markiert), anlegen per Eingabe+Enter, entfernen per ✕ (mit `confirm`), Wechsel ohne Neustart (`switchVault`).
- [x] **Dauerhafter Renderer-Test** `test/md-render.test.mjs`: extrahiert den Renderer-Kern zwischen den Markern aus `public/index.html`, lädt ihn als ESM-Data-URL mit Stubs, prüft 25 Fälle → **25 bestanden, 0 Fehler**. Künftig bei jeder Renderer-Änderung laufen lassen.
- [x] `node --check` für `src/ui-server.js` und das komplette `<script>` aus `index.html` → OK.

### WICHTIGER Technik-Hinweis (Session 10) – Edit-Tool hat ui-server.js abgeschnitten
- Das **Edit-Tool truncatet weiterhin an Box-Zeichen** (`──` in Kommentar-Trennern): ein Edit, der `/api/backlinks` einfügen sollte, hat das Dateiende (den `app.listen(...)`-Block) **abgeschnitten**. Symptom: Datei endete mitten in `// ── Server starten ──`.
- Zusätzlich **divergierten Windows-Datei und Linux-Mount**: die Windows-Datei (D:\Nexus, das ist die echte Deliverable) war intakt, der Mount zeigte die abgeschnittene Fassung. Verifikation daher IMMER über das Windows-Read-Tool, nicht nur über den Mount.
- **Konsequenz/Regel:** Datei-Schreibvorgänge mit Sonderzeichen weiterhin per `bash: cat > datei << 'EOF'` (Heredoc, literal). Das Edit-Tool NICHT für Dateien mit `──`/Regex/Backslashes verwenden. Nach jedem Schreiben per Windows-`Read` gegenprüfen, dass Anfang UND Ende stimmen.

## Stand: 2026-06-10 (Session 11 – Electron-Distribution / Setup auf Fremd-PC)

Ziel (Pauls Vorgabe): Nexus so einfach wie moeglich auf einem anderen PC einrichten –
ohne Vault-Inhalte, aber mit Aufbau, Verhalten und Claude-Desktop-Anbindung; Ziel-PC ohne Node.

### Erledigt
- [x] **`--mcp`-Modus in `electron/main.js`**: dieselbe .exe startet wahlweise GUI (Fenster + Web-UI)
  oder – mit Argument `--mcp` – den MCP-stdio-Server HEADLESS (kein Fenster). Damit kann Claude Desktop
  auf einem fremden PC die installierte .exe als MCP-Server starten -> **kein separates Node noetig**.
- [x] **Schreibbare Pfade (`src/paths.js`, NEU)**: zentrale `DATA_DIR`-Logik.
  - Dev (`npm run app` / `node src/server.js`): `NEXUS_DATA_DIR` ungesetzt -> App-Root (D:\Nexus). Verhalten unveraendert.
  - Gepackt: `electron/main.js` setzt `NEXUS_DATA_DIR = app.getPath('userData')`. Config/Index-DB/Upload-Temp
    landen schreibbar in userData statt im read-only asar.
  - `loadConfig()`, `CONFIG_PATH`, `resolveDbPath()` (absolut|relativ|Default), `dataPath()`.
- [x] **`src/server.js` + `src/ui-server.js`** auf `paths.js` umgestellt (Config-Read, saveConfig, Vault-DB-Pfade,
  multer-Upload-Temp). Pauls Dev-Config mit absolutem dbPath bleibt unveraendert (resolveDbPath gibt Absolutpfade durch).
- [x] **Erst-Start-Seeding (gepackt)**: legt frische `nexus.config.json` in userData an (OHNE Pauls Inhalte) +
  leeren Vault `Dokumente\Nexus Vaults\knowledge-base\`. `autoOpen:false` (Electron oeffnet das Fenster selbst).
- [x] **App-Menue**: „Mit Claude Desktop verbinden" schreibt/merged `%APPDATA%\Claude\claude_desktop_config.json`
  (Backup `.nexus-backup`, Eintrag zeigt auf execPath `--mcp`), plus „Vault-Ordner oeffnen".
- [x] **electron-builder konfiguriert** (`package.json`): `main: electron/main.js`, `build`-Block
  (appId `de.hunold.nexus`, productName `Nexus`, win-Targets **nsis + portable**, icon), Scripts `dist`/`dist:dir`,
  devDep `electron-builder ^25`. Version -> 0.3.0.
- [x] **Icon** `build/icon.png` + `build/icon.ico` (256er multi-size, dunkles Diamant-Theme passend zur UI) generiert.
- [x] **`SETUP.md` (NEU)**: Schritt-fuer-Schritt Fremd-PC-Anleitung (Build, Erststart, Inhalte, Claude-Connect, Pfadtabelle).

### Verifikation (Session 11)
- [x] `node --check` auf `src/paths.js`, `src/server.js`, `src/ui-server.js`, `electron/main.js` -> alle OK
  (Checks in sauberer /tmp-Kopie, da der Linux-Mount Tool-geschriebene Dateien verzoegert/teilweise mit NUL-Bytes spiegelt).
- [x] **paths.js-Logik** isoliert getestet: env-DATA_DIR, CONFIG_PATH, resolveDbPath (default/relativ/absolut), dataPath, Dev-Fallback -> alle Assertions gruen.
- [x] **Bestehende Suiten**: `test/smoke.js` -> **48 bestanden**; `test/md-render.test.mjs` -> **25 bestanden, 0 Fehler**. Keine Regression.
- [x] `package.json` als valides JSON gegengeprueft (build.appId, Targets, icon-Pfad).

### Offen / Naechste Schritte
- [ ] **`npm install` + `npm run dist` auf Pauls Windows-PC** ausfuehren (NSIS-Build laeuft nur unter Windows, nicht in der Linux-Sandbox).
  Erwartet in `dist\`: `Nexus Setup 0.3.0.exe` + `Nexus-0.3.0-portable.exe`.
- [ ] **Auf Ziel-PC verifizieren**: Erststart legt userData-Config + leeren Vault an; „Mit Claude Desktop verbinden" -> Claude Desktop neu starten -> Tools sichtbar.
- [ ] **MCP-stdio unter Electron beobachten**: sicherstellen, dass im `--mcp`-Modus nichts ausser dem JSON-RPC auf **stdout** landet
  (server.js loggt nur via stderr; Electron-Main ist normalerweise still). Falls Claude Desktop Parse-Fehler meldet -> stdout pruefen.
- [ ] Optional: Code-Signing (sonst SmartScreen-Warnung beim ersten Start), Auto-Update, NSIS-Feinschliff.

### Technik-Hinweise (Session 11)
- **Mount-Divergenz erneut bestaetigt**: via Write/Edit (Windows) geschriebene Dateien erscheinen auf dem Linux-Mount
  verzoegert/teils mit NUL-Padding. server.js/paths.js synchron, package.json/main.js zeitweise veraltet.
  -> Verifikation kanonisch ueber Windows-`Read`; Sandbox-Checks in frischer /tmp-Kopie.
- electron-builder bezieht prod-`node_modules` automatisch (devDeps electron/electron-builder werden ausgeschlossen);
  `node:sqlite` ist in Electron 42 (Node 24.16) eingebaut -> kein natives Rebuild.

| Session | Datum | Inhalt | Start % | End % |
|---|---|---|---|---|
| 11 | 2026-06-10 | Electron-Distribution: --mcp-Modus (headless), userData-Pfade (paths.js), Erst-Config-Seeding ohne Inhalte, Claude-Connect-Menue, electron-builder (nsis+portable)+Icon, SETUP.md; Tests 48+25 gruen | ~58 | ~70 |

## Stand: 2026-06-10 (Session 12 – Editieren in der UI / Schreibprogramm statt Leseprogramm)

Ziel (Pauls Vorgabe, gewaehlt aus 3 Optionen): **Editieren in der UI** – die fundamentale
Luecke. Ohne das blieb Nexus reine Lese-App. (Kritischer Hinweis an Paul protokolliert:
Editieren ist *Gleichstand* mit Obsidian, nicht Vorsprung – der echte Vorsprung liegt in P2,
den MCP-Tools fuer Claude. Bewusst trotzdem zuerst Editieren, weil fundamental.)

### Erledigt
- [x] **Backend: `POST /api/save`** in `src/ui-server.js`
  - Body `{ vault, path, content, create }`. Schreibt Datei, reindexiert wenn `.md`.
  - **Pfad-Traversal-Schutz**: `resolve(vault.path, relPath)` muss innerhalb `resolve(vault.path)` liegen (sonst 400).
  - `create:false` + nicht-existent -> 404. Fehlt `content` -> 400.
  - Import in ui-server.js um `resolve, sep` erweitert.
- [x] **Frontend-Editor** in `public/index.html`
  - **CodeMirror 5 (lazy CDN) mit Textarea-Fallback** (offline-fest, gleiches Muster wie KaTeX/Mermaid):
    `loadCodeMirror()` laedt codemirror.min + markdown-mode; bei `onerror` -> styled `<textarea>` mit Tab-Handling.
  - `openEditor(path,isNew)`: Toolbar (Speichern/Vorschau/Abbrechen), Dirty-Anzeige, fuellt Editor-Hoehe.
  - `saveEditor()`: POST /api/save (create:true), aktualisiert `original`, Toast, Activity-Log; bei neuer Notiz `loadVault()` (Tree-Refresh).
  - `togglePreview()`: rendert In-Place-Vorschau via vorhandenem `renderMarkdown()`, ohne Editor-State zu verlieren (Toggle Editor<->Vorschau).
  - `isDirty()`/`markDirty()`: Live-Vergleich gegen Disk-Stand.
  - **Navigationsschutz**: `maybeLeaveEditor()` als Guard am Anfang von `openFile()` + `window.beforeunload` (confirm bei ungespeicherten Aenderungen).
  - **Shortcuts** (eigener capture-Keydown-Listener, stoert Ctrl+K nicht): **Ctrl+S** speichern, **Ctrl+E** aktuelle .md-Notiz bearbeiten, **Esc** schliesst Vorschau.
  - **Neue Notiz**: `newNote()` (Prompt -> .md ergaenzt -> create), Buttons: `+ Notiz` in Sidebar-Header, `✎ Bearbeiten` in Markdown-Meta, `✎ Bearbeiten` im Rechtsklick-Menue.
  - CSS fuer Editor/Toolbar/Buttons/CodeMirror-Dark-Theme ergaenzt.

### Verifikation (Session 12) – alles gruen
- [x] `node --check` ui-server.js -> OK; komplettes `<script>` aus index.html (2x, nach jeder Aenderung) -> OK.
- [x] **Save-Endpoint E2E** (eigener ui-server auf Port 3777, Test-Vault): existierende Notiz gespeichert **und reindexiert** (Suche findet neuen Text, Titel aktualisiert), neue Notiz im Unterordner angelegt, **Traversal -> 400**, nicht-existent ohne create -> 404, content fehlt -> 400.
- [x] **Keine Regression**: `test/smoke.js` -> **48 bestanden**, `test/md-render.test.mjs` -> **25 bestanden, 0 Fehler**.
- [x] Windows-`Read`-Gegenpruefung: Datei-Anfang + -Ende intakt (1211 Zeilen, sauberer `init(); </script></body></html>`-Abschluss), alle 7 Einsetzungen an erwarteten Stellen. Kein Edit-Tool benutzt -> alles per node-Skript mit literalem String-Replace (Funktions-Replacement, damit `$`-Muster nicht interpretiert werden).

### Technik-Hinweise (Session 12)
- **index.html wurde NICHT mit Edit-Tool angefasst** (dokumentierte Truncation-Gefahr). Stattdessen: Snippet-Dateien per `cat > .. << 'EOF'` (literal), dann node liest sie und ersetzt an eindeutigen Ankern (`s.replace(old, () => new)` – Funktionsform verhindert `$&`/`$1`-Interpretation). Anker-Eindeutigkeit im Skript geprueft (Abbruch bei 0 oder >1 Treffern).
- `node --check` scheitert auf dem Linux-Mount an einer (mount-bedingt) defekten `package.json` -> Checks daher in sauberer /tmp-Kopie mit eigenem `{"type":"module"}` bzw. Symlink auf node_modules.
- Editor mountet in `.editor-host` (flex:1); `.note-area{flex:1}` ergaenzt, damit der Editor die volle Hoehe fuellt.
- **Concurrency-Hinweis (offen, nicht kritisch)**: UI-Prozess (ui-server) und MCP-Prozess (server.js, mit chokidar-Watcher) oeffnen dieselbe WAL-DB. UI-Save ruft `indexer.indexFile`; der Watcher des MCP-Prozesses reindexiert dieselbe Datei zusaetzlich. WAL erlaubt 1 Writer -> theoretisch seltenes SQLITE_BUSY. Vorbestehend (gilt auch fuer Upload). Beobachten.

### >>> ANKNUEPFPUNKT fuer naechstes "weiter mit nexus" <<<
Reihenfolge wie mit Paul vereinbart (Editieren=P1 erledigt). Als Naechstes:

**P2 – MCP-Tools schaerfen (DER eigentliche Obsidian-Vorsprung, naechste Prioritaet):**
- [ ] `move_note` / `rename_note`: Datei verschieben/umbenennen **mit automatischem Link-Update** aller `[[Wikilinks]]` in anderen Notizen (links-Tabelle + Backlinks nutzen; betroffene Dateien per patch umschreiben). Kernstueck.
- [ ] `find_orphans`: verwaiste Notizen finden (keine eingehenden UND keine ausgehenden Links). Daten dafuer liegen in `links`-Tabelle.
- [ ] **Tag-Verwaltung**: `list_tags` (alle Tags + Counts), `rename_tag` (vault-weit), evtl. `add_tag`/`remove_tag` pro Notiz.
- [ ] `query` erweitern: Dataview-artig (mehrere Bedingungen/AND, Sortierung, Felder-Projektion) – aktuell nur 1 Feld + 1 Operator.
- [ ] Jedes neue Tool in `src/tools.js` (pure function, testbar) **und** `src/server.js` (Zod-Schema) registrieren; `test/smoke.js` erweitern.

**P3 – UI-Komfort (zuletzt, geringster Hebel):**
- [ ] **Tabs / mehrere offene Notizen** (Tab-Leiste ueber dem Note-Bereich; Editor-State pro Tab).
- [ ] **Snippet-Klick -> direkt zur Trefferstelle scrollen** (Suchtreffer kennt Zeile/Abschnitt -> nach openFile dorthin scrollen + highlight).
- [ ] Optional: KaTeX/Mermaid/CodeMirror lokal buendeln (offline-fest statt CDN).

**Test-Vault auf Pauls PC** (`npm run app`) zum manuellen Pruefen der neuen Editier-Funktionen:
- Notiz oeffnen -> `✎ Bearbeiten` (oder Ctrl+E) -> tippen -> Ctrl+S -> Toast + Dirty-Anzeige weg.
- `Vorschau` togglen, `+ Notiz` anlegen, Tree-Refresh pruefen. CodeMirror braucht Internet (sonst Textarea-Fallback).

| Session | Datum | Inhalt | Start % | End % |
|---|---|---|---|---|
| 12 | 2026-06-10 | Editieren in UI: POST /api/save (Traversal-Schutz+Reindex), CodeMirror5+Textarea-Fallback, Dirty/Guard/beforeunload, Ctrl+S/Ctrl+E, Vorschau-Toggle, Neue Notiz; E2E+Suiten gruen (48+25) | ~70 | ~78 |
| 13 | 2026-06-11 | Graph-Rebuild: echter Force-directed Vault-Graph (/api/graph), Cursor-Hit-Fix (View-Transform+ResizeObserver), Physik-Slider, Haupt-Button, Start=START.md+Hauptgraph, Farben nur Ober-Themen; index.html-Truncation-Unfall behoben+rekonstruiert | ~78 | ~82 |

## Stand: 2026-06-11 (Session 13 - Graph-Ueberarbeitung)

Pauls Vorgaben (6 Fixes am Graph):
1. Cursor/Knoten-Treffer stimmte nicht ueberein.
2. Hauptgraph war statisches Bild -> soll wie Obsidian alle Dateien verlinkt zeigen, mit Einstellungen (Anziehung, Knotengroesse, Abstossung ...).
3. Datei-Auswahl fokussiert Graph auf das Dokument (Ego) -> bleibt; zusaetzlich Button zurueck zur Hauptansicht.
4. Beim Start START.md oeffnen, aber Hauptgraph zeigen (nicht den Ego-Graph von START.md).
5. Farben zu wild -> nur Ober-Themen farbig, Unterordner neutral.

### Erledigt
- [x] **Backend `/api/graph`**: `tools.graph()` (src/tools.js) liefert `{nodes:[{path,title}], links:[{src,target}]}`
  (zwei neue Prepared Statements `allNotes`, `allLinks`); Endpoint `GET /api/graph` in src/ui-server.js (spiegelt /api/backlinks-Muster). Target-Aufloesung passiert clientseitig via vorhandenem `resolveWiki` + noteIndex.
- [x] **Echter Force-directed Hauptgraph** (public/index.html, GRAPH-Section komplett ersetzt):
  - Velocity-Verlet-Physik mit Alpha-Cooling; Abstossung per **Gitter-Approximation (O(n))** statt O(n^2) -> grosse Vaults moeglich; Link-Anziehung; Zentrierung. Friert ein wenn stabil (`alpha<0.004`), reheizt bei Drag/Slider.
  - Knotengroesse ~ Grad (Anzahl Links). Knotenfarbe = `colorForPath()` = nur Top-Level-Thema.
  - **Cursor-Fix**: einheitliche View-Transform (Pan `view.x/y` + Zoom `view.k`), Hit-Test im selben Screen-Space, **ResizeObserver** statt nur window.resize -> Tooltip/Treffer liegen jetzt exakt unter dem Cursor.
  - Interaktion: Hover-Tooltip, Klick oeffnet Datei/Ordner, **Knoten ziehen** (pinnt fx/fy), Hintergrund ziehen = Pan, **Mausrad = Zoom** zum Cursor.
- [x] **Physik-Slider** (Zahnrad-Button): Abstossung, Anziehung, Linklaenge, Knotengroesse, Zentrierung; in `localStorage` (`nexus.graph.settings`) persistiert.
- [x] **Button "Haupt"** (Haus-Icon) im Graph -> zurueck zur Vault-Hauptansicht (`setGraphVault`, `pinnedMain=true`).
- [x] **Ego-Fokus bleibt**: Datei oeffnen -> `updateGraphForNote`/`buildEgo` (zentrale Notiz + ausgehende/Backlinks), jetzt mit derselben Physik (Zentrum gepinnt).
- [x] **Start-Verhalten**: `init()` oeffnet START.md via `openFile(path,{startup:true})`, setzt `graph.pinnedMain=true` -> Graph bleibt Hauptansicht. `openFile` loescht den Pin bei jeder echten Nutzer-Auswahl -> danach fokussiert Klick wieder aufs Dokument.
- [x] **Farben reduziert**: `colorForPath()` faerbt nur nach Top-Level-Ordner; Sidebar-Unterordner-Dots neutral (`#4a5163`). Wikilink/Embed/Callout-Farben im Renderer unveraendert.

### WICHTIGER Zwischenfall (behoben) - index.html-Truncation
- Beim Splicen der GRAPH-Section per `node`-Skript auf dem **Linux-Mount** wurde eine **veraltete/abgeschnittene Mount-Fassung** von index.html gelesen und zurueckgeschrieben -> die kanonische Windows-Datei wurde **am Ende abgeschnitten** (mitten in `renderVaultList`, Rest inkl. `createVault`/`removeVault`/`init()` weg).
- **Recovery**: Datei war bis zur Truncation-Stelle intakt; Tail rekonstruiert (renderVaultList-Body + Vault-Item/Del-Wiring, `refreshVaultSelector`, `createVault`, `removeVault`, `init()`, schliessende Tags) anhand der bekannten API (/api/vaults/create|remove) und des frueher gelesenen vollstaendigen renderVaultList-Markups. Datei endet wieder sauber `init(); </script></body></html>` (1286 Zeilen).
- **Lehre**: NIE per bash/node ueber den Mount in index.html schreiben. Edit-Tool fuer ASCII-Teile (CSS/Markup/kleine Aenderungen) ist ok; grosse JS-Bloecke mit Backslash/Backticks brauchen einen sicheren Weg - aber Verifikation IMMER vorher per Windows-`Read`, nie blind ueber Mount-Read spleissen.

### Verifikation
- [x] `node --check` auf das extrahierte `<script>` aus index.html (aus der Mount-Datei, die hier == kanonisch ist) -> **OK**.
- [x] `test/md-render.test.mjs` (extrahiert Renderer aus der echten index.html) -> **25 bestanden, 0 Fehler** (beweist: Datei vollstaendig + Renderer unveraendert).
- [x] Windows-`Read` bestaetigt Kopf + Tail von index.html, `/api/graph` in ui-server.js, `graph()`+Export in tools.js.
- [x] **NACHGEHOLT (nach Git-Baseline)**: `git init` + erster Commit (701c72f) durch Paul auf Windows -> kanonische Dateien im Object-Store. Aus der Sandbox via `git archive HEAD` einen sauberen Baum extrahiert (umgeht den kaputten Mount) und getestet: **smoke.js 48 bestanden**, **md-render 25/0**, **`/api/graph`-E2E** (3 Knoten / 3 Kanten, `src`+`target` korrekt). Alles gruen.
- **Merke fuer kuenftige Sessions**: Wenn der Mount divergiert, kanonische Dateien via `git archive HEAD | tar -x -C /tmp/clean` holen statt `cp` vom Mount.

### Naechste Schritte / zu pruefen auf Pauls PC
- [ ] `npm run app` -> Start oeffnet START.md, Graph zeigt Hauptansicht (alle Notizen vernetzt). Knoten anklicken -> Datei + Ego-Fokus; "Haupt"-Button -> zurueck. Zahnrad -> Slider testen (Abstossung/Anziehung/Groesse). Cursor exakt auf Knoten -> Tooltip.
- [ ] `node test/smoke.js` auf Pauls PC laufen lassen (Soll: 48 bestanden) - holt die diese Session blockierte Backend-Verifikation nach.
- [ ] Performance bei sehr grossem Vault beobachten; falls noetig Barnes-Hut statt Gitter-Approximation.
