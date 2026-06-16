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

---

## Offene Aufgaben – Roadmap (Stand 2026-06-11)

Priorisierung: **P0** = Quick-Fix | **P1** = Core-Feature | **P2** = Erweiterung | **P3** = Polish/Forschung

| # | Priorität | Aufgabe | Modell | Begründung |
|---|-----------|---------|--------|------------|
| ~~R1~~ | ~~P0~~ | ~~**Checkbox-Toggle in Notizen funktioniert nicht**~~ | ~~Sonnet~~ | ✅ Session 17 |
| ~~R2~~ | ~~P0~~ | ~~**Scrollbar-Styling in Datei-Previews**~~ | ~~Sonnet~~ | ✅ Session 17 |
| ~~R3~~ | ~~P0~~ | ~~**Vault-Selector oben links zu Windows-artig**~~ | ~~Sonnet~~ | ✅ Session 17 |
| ~~R4~~ | ~~P1~~ | ~~**Tab-Reihenfolge per Drag & Drop**~~ | ~~Sonnet~~ | ✅ Session 18 |
| ~~R5~~ | ~~P1~~ | ~~**Sidebar-Themen: ganzes Farbfeld mit Name statt Punkt**~~ | ~~Sonnet~~ | ✅ Session 19 |
| ~~R6~~ | ~~P1~~ | ~~**Splitscreen-Verbesserung: Tab per D&D in 2. Fenster ziehen; rechtes Panel (Graph/Outline) sync zur aktiven Datei**~~ | ~~Opus~~ | ✅ Session 20 |
| ~~R7~~ | ~~P2~~ | ~~**Einstellungs-Menü** – Button unten links öffnet Panel: Farb-Theme, Hauptthemen-Farben, Vault-Pfad, weitere sinnvolle Optionen; Persistence in localStorage / nexus.config.json~~ | ~~Sonnet~~ | ✅ Session 21 |
| R8 | P2 | **Claude in Suche oben rechts einbinden** – wie im Preview; Claude-API-Key konfigurierbar; auch auf anderem PC nutzbar | **Opus** | API-Integration + Key-Management + Security; architektonisch komplex |
| ~~R9~~ | ~~P2~~ | ~~**Claude Usage-Widget unten rechts** – nach GitHub `SlavomirDurej/claude-usage-widget`; in Claude-Aktivitäts-Zeile; Login-Daten änderbar~~ | ~~Sonnet~~ | ✅ Session 22 |
| ~~R10~~ | ~~P2~~ | ~~**Professioneller Installer & vollwertige Windows-App** – neues Icon, NSIS-Optionen, Erster-Start-Wizard, kein CMD, Taskleisten-Identität, In-App-Anleitung (Claude-Connect + Session-Key)~~ | ~~Sonnet~~ | ✅ Session 23 (Build `npm run dist` läuft auf Pauls Windows-PC) |
| ~~R11~~ | ~~P3~~ | ~~**3 weitere UI-Design-Vorschläge für index.html** – Alternativen zum aktuellen Look, nur Mockups/HTML~~ | ~~Opus~~ | ✅ Session 24 (Mockups B/G/I als umschaltbare Design-Presets eingebaut) |
| R12 🔄 | P3 | **Obsidian-Regeln und Arbeitsweisen in Nexus übernehmen** – alle sinnvollen Obsidian-Workflows (Templates, Daily Notes, Kanban, Tags, Properties…) als Nexus-Features oder MCP-Tools abbilden | **Opus** | **In Arbeit (Session 31):** Regelwerk migriert (Scaffold + Overlay + MCP-`instructions`). Restliche Feature-Tools (R12a–f) s. Session-31-Eintrag |
| R13 | P3 | **Abschließender Obsidian-vs-Nexus-Vergleich** – wo Obsidian noch besser ist; ehrliche Lücken-Liste | **Sonnet** | Reine Analyse/Recherche; kein Code |

### Empfohlene Reihenfolge (je neues Fenster / neue Session)

1. ~~**R2/R1/R3** – alle drei erledigt (Session 17)~~
2. **R4** (Tab D&D Reorder)
3. **R5** (Sidebar-Farbfeld: erst Designs zeigen, dann implementieren)
4. ~~**R6** (Splitscreen-Upgrade)~~ ✅ Session 20
5. ~~**R7** (Einstellungs-Menü)~~ ✅ Session 21
6. ~~**R10** (Installer finalisieren)~~ ✅ Session 23
7. **R8** (Claude in Suche)
8. **R9** (Usage-Widget)
9. **R11** (Design-Vorschläge)
10. **R12** (Obsidian-Regeln)
11. **R13** (Vergleich)

---

## Stand: 2026-06-16 (Session 42 – Graph-Beschriftungen: Ego-Zentrierung mit mehr Abstand oben + überlappungsfreie/kleinere Labels, Hauptgraph nur bei starkem Zoom, Start.md immer Hauptgraph; + Aktivitäts-Log: max. 3 Datei-Open-Einträge)

Paul-Report (Screenshot Ego-Graph, 4 Punkte): (1) der **Ego-Graph** soll beim **automatischen Zentrieren mehr Abstand
zur oberen Grenze** halten; (2) **Beschriftungen dürfen sich nicht überschneiden** (gern etwas **kleinere Schrift**);
(3) im **Baum/Hauptgraph** sollen **keine Knoten-Beschriftungen** zu sehen sein – **außer beim starken Ranzoomen**, vor
allem **nicht beim Anvisieren (Hover) eines Punktes**, damit nicht der ganze Bildschirm voller Labels ist; (4) **Start.md**
soll **nie einen Ego-Graph** haben, dort **immer der Hauptgraph**. (5) Nachgereicht: in der **Claude-Aktivität unten**
sollen **maximal die letzten 3 Einträge von geöffneten Dateien** stehen. Reine UI-Änderung in `public/index.html`.

### Erledigt
- [x] **(1) Ego-Zentrierung mit mehr Abstand oben** (`buildEgo`): Kreis-Zentrum von `graph.H*0.46` → **`0.52`** (tiefer ⇒
  mehr Luft zur Oberkante), Radius `min(W,H)*0.34` → **`0.30`** (kompakter ⇒ mehr Rand oben/unten/seitlich). Der oberste
  Knoten samt Label stößt nicht mehr an die Kante.
- [x] **(2) Überlappungsfreie, kleinere Ego-Labels** (`buildEgo` + `frameGraph`): jeder Ego-Knoten speichert seinen
  **Kreiswinkel `lblDir`**; das Label wird beim Zeichnen **radial nach außen** versetzt (`textAlign`/`textBaseline` je
  nach Quadrant: links→rechtsbündig, rechts→linksbündig, oben→darüber, unten→darunter). Dadurch **fächern die Labels nach
  außen** statt sich mittig über den Knoten zu stapeln. Schrift **9 px** (statt 10,5), Kürzung auf **18 Zeichen** (statt
  26). Zentrum-Label nach oben (`lblDir=-π/2`).
- [x] **(3) Hauptgraph-Labels nur bei starkem Zoom, nie bei Hover** (`frameGraph`): alte Bedingung
  (`mode==='note' || nodes<=60 || k>1.8` **plus** Hover-/`deg>8`-Labels) ersetzt durch **`vaultLabels = k>2.2`**. Im
  Vault-Modus erscheinen Beschriftungen jetzt **ausschließlich beim starken Ranzoomen** – **kein** Label mehr beim
  Anvisieren/Hover (der **Tooltip `#graph-tip`** zeigt den Namen weiterhin). Ego-Modus zeigt wie gewünscht **immer** alle
  Labels (s. Punkt 2). `textBaseline` nach der Knoten-Schleife auf `alphabetic` zurückgesetzt.
- [x] **(4) Start.md immer Hauptgraph** (`updateGraphForNote` + `updateGraphBacklinks`): neuer Helper
  **`isStartNote(p)`** (`/(^|\/)start\.md$/i`). Beim Öffnen einer Start.md wird statt `buildEgo()` direkt **`graphToMain()`**
  aufgerufen (schaltet nur, falls nicht schon Vault) – greift für beide Einstiegspunkte (Links **und** Backlinks),
  unabhängig von der Default-Einstellung „Graph beim Öffnen".
- [x] **(5) Aktivitäts-Log: max. 3 Datei-Open-Einträge** (`logActivity`): optionaler 3. Parameter **`kind`**. Die **9
  Datei-Öffnen-Logs** in `openFile` (`read_note`, `render_html`, `view_image`, `view_pdf`, `view_video`, `view_audio`,
  `view_csv`, `open_office`, `open`) übergeben jetzt `'open'`. Nach jedem Log werden ältere `kind==='open'`-Einträge
  **gekappt, sodass höchstens die letzten 3** bleiben (`splice`-Schleife). Andere Aktionen (Suche, Ordner, Split, Edit,
  Reindex, Vault-Wechsel, extern öffnen) bleiben vom 16er-Gesamtlimit unberührt – nur die **Datei-Opens** sind auf 3
  begrenzt, damit das Log nicht damit volläuft.

### Verifikation
- [x] `npm run verify:html` → **OK** (3303 Zeilen, Inline-Script `node --check` grün, Ende `</html>`).
- [x] Theme-/Layout-sicher: nur Canvas-Zeichenlogik + Label-Color aus `--text` (`_graphLabelColor`), keine neuen Hartcodes;
  Tooltip-/Hover-Hervorhebung (Dimmen) unverändert.
- [x] **Datei-Open-Cap geprüft**: genau **9** getaggte `logActivity(...,'open')`-Aufrufe (alle in `openFile`); Split/Edit/
  Ordner/extern nutzen `&rarr;` bzw. andere Variablen und sind **nicht** betroffen.
- [ ] **Live-Augenschein offen (Paul):** (1) Notiz mit mehreren Links öffnen → Ego-Graph sitzt tiefer, klarer Abstand
  oben; (2) Labels fächern nach außen, **überlappen nicht** mehr, etwas kleiner; (3) Hauptgraph: beim Hovern erscheint nur
  der **Tooltip**, **keine** Label-Flut; erst **starkes Ranzoomen** blendet Beschriftungen ein; (4) **Start.md** öffnen →
  **Hauptgraph** (kein Ego), egal welche Default-Einstellung; (5) 4+ Dateien nacheinander öffnen → im Aktivitäts-Log
  stehen **höchstens 3** Datei-Open-Zeilen (ältere fallen raus), andere Aktionen bleiben sichtbar. Standard- **und**
  Studio-Layout.

### TODO Paul
- [ ] Git-Commit: `git add public/index.html STATUS.md && git commit -m "Session 42: Graph-Labels (Ego mehr Abstand oben + radial/kleiner, Hauptgraph nur bei starkem Zoom, Start.md immer Hauptgraph) + Aktivitäts-Log max. 3 Datei-Opens"`

---

## Stand: 2026-06-16 (Session 41 – PDF.js: voll in Nexus integrierter PDF-Viewer (eigene Toolbar, dunkel, Lazy-Render))

Paul-Wunsch (nach Session 40, PDF lädt jetzt): Der **Chromium-PDF-Viewer** sieht nicht stimmig aus. Da dessen Toolbar in
einem **cross-origin/abgeschotteten** Kontext läuft, lässt sie sich **nicht per CSS** umfärben. Entscheidung (Paul):
**PDF.js – voll integriert** statt nativem Viewer.

### Erledigt
- [x] **PDF.js lokal vendored** (`public/vendor/pdfjs/pdf.min.js` 320 KB + `pdf.worker.min.js` 1,06 MB, v3.11.174,
  UMD-Build → globales `window.pdfjsLib`). **Offline-tauglich** in Electron, kein CDN (anders als KaTeX/Mermaid).
- [x] **Lazy-Loader `loadPdfJs()`** (`public/index.html`, neben `loadMermaid`/`loadKatex`): lädt die Lib erst beim ersten
  PDF-Öffnen und setzt `GlobalWorkerOptions.workerSrc` auf den lokalen Worker.
- [x] **`mountPdfViewer(host,fname,path,opts)`** – eigener Viewer:
  - **Nexus-Toolbar** (`.file-toolbar`-Optik): Seiten-Navigation (‹ / Eingabefeld / N / ›), Zoom (− / %-Reset / +),
    „⇆ Breite" (Fit-Width), „📂 Extern öffnen". Alles in Akzentfarben/`ft-btn`.
  - **Dunkler Hintergrund** (`var(--bg)`), Seiten als weiße Karten mit Schatten, **Nexus-Scrollbars** (8 px, `--dim`).
  - **Lazy-Rendering pro Seite** via `IntersectionObserver` (rootMargin 500 px) → auch große PDFs flüssig; Rendern auf
    `<canvas>` mit `dpr` (gekappt auf 2) für scharfe Schrift.
  - **Zoom**: Buttons + **Strg+Mausrad** (eigener `wheel`-Handler mit `stopPropagation`, damit `onNoteWheel` von
    `#note-area` den PDF-Scroll **nicht** abfängt). Fit-Width reagiert auf `ResizeObserver`.
  - **Seitenanzeige** folgt dem Scrollen; Eingabefeld + ‹/› springen zur Seite.
  - **Cleanup** (`host._pdfCleanup`): Observer trennen + `doc.destroy()` beim Tab-Wechsel/Neu-Mount (kein Leak).
  - **Fehler** (Lib/Doc lädt nicht) → `renderExternalFallback` (Karte + „Extern öffnen").
- [x] **`renderPdfView`** ist jetzt ein Wrapper auf `mountPdfViewer`; **Split-View** (`openCenterSplit`) nutzt
  `mountPdfViewer(…,{compact:true})` (kompakte Toolbar, nur Icons).
- [x] **Layout robust**: `.pdfv` ist `position:absolute` und füllt den Host (umgeht die unzuverlässige
  `height:100%`-Auflösung in Flex-Items). Haupt-View Offset `top:var(--tab-h)` (unter den Tabs), Split `top:0`. Hosts
  `#note-area` / `#note-pane2 .np2-body` bekamen `position:relative`.

### Verifikation
- [x] `npm run verify:html` → **OK** (3283 Zeilen, Inline-Script grün, Ende `</html>`).
- [x] **Vendored Lib geprüft**: UMD-Wrapper setzt `globalThis.pdfjsLib`; API-Namen `getDocument`/`GlobalWorkerOptions`/
  `getViewport`/`numPages` vorhanden; **Version Lib == Worker == 3.11.174** (sonst „API/Worker version mismatch").
- [x] **Geometrie-Bug vorab gefixt**: `.pdf-page`-`offsetParent` ist das absolute `.pdfv` (nicht `.pdfv-scroll`) → war
  um die Toolbar-Höhe verschoben; `gotoPage`/Seitenanzeige/Prefetch jetzt über `getBoundingClientRect`.
- [ ] **Live-Augenschein offen (Paul):** App **neu starten**; PDF öffnen → dunkler Viewer mit Nexus-Toolbar, scharfe
  Seiten, Scrollen flüssig, Seitenanzeige läuft mit, ‹/›/Eingabe springt, −/+/⇆ Breite zoomt, Strg+Mausrad zoomt,
  „Extern öffnen" geht; auch im Split (2. Ansicht). Standard- **und** Studio-Layout.

### Hinweise
- **Keine cMaps/Standard-Fonts vendored** → exotische (v. a. CJK) oder auf die Standard-14-Fonts angewiesene PDFs können
  einzelne Glyphen mit Fallback rendern. Für übliche (eingebettete) PDFs irrelevant; bei Bedarf cMaps nachlegen.
- `public/vendor/pdfjs/**` ist eine **eingecheckte Lib** (kein `node_modules`) → gehört in den Commit.

### TODO Paul
- [ ] **App neu starten** (Frontend lädt per Reload, aber sicherheitshalber komplett neu starten).
- [ ] Git-Commit: `git add public/vendor/pdfjs public/index.html STATUS.md && git commit -m "Session 41: Voll integrierter PDF.js-Viewer (eigene Nexus-Toolbar, dunkel, Lazy-Render, Zoom/Fit, Split) – lokal vendored, offline"`

---

## Stand: 2026-06-16 (Session 40 – Viewer-Reparatur: PDF rendert, Office mit In-App-Vorschau + „extern öffnen", Audio/Video, Binär-Fallback)

Paul-Report: Viele Viewer funktionieren nicht außer HTML. **PDF** wirft einen Fehler, **Office-Dateien** (docx, xlsx, …)
zeigen **Quellcode** (Binär-Kauderwelsch). Wunsch: so viel wie möglich **direkt in Nexus** anzeigbar machen; wenn eine
Office-Datei gar nicht darstellbar ist → **Popup** („In Word/Excel öffnen?") und die Datei im **entsprechenden Programm**
öffnen.

### Ursachen
- **PDF (2 Gründe):** (1) `/api/file` setzte den Content-Type **immer** auf `text/plain` → das `<iframe>` bekam die PDF als
  Text deklariert, Chromiums PDF-Viewer sprang nicht an. (2) Im Electron-Hauptfenster fehlte `webPreferences.plugins:true`
  → der eingebaute PDF-Viewer ist fürs `<iframe>`-Embedding standardmäßig **deaktiviert**.
- **Office = Quellcode:** docx/xlsx/pptx fielen im Dispatcher (`openFile`) in den `else`-Zweig → `renderPlain` las die
  **Binärdatei als Text** und dumpte sie roh ins `<pre>`.

### Erledigt
- [x] **Content-Type-Fix + Range-Support** (`src/ui-server.js`, `/api/file`): neue `MIME`-Tabelle + `mimeForExt()`; jede
  Endung bekommt ihren echten Typ (PDF→`application/pdf`, Bilder, Audio/Video, Office, …), Text bleibt `text/*`,
  Unbekanntes `application/octet-stream`. **`createReadStream().pipe()` → `res.sendFile()` umgestellt** (siehe Nachtrag):
  liefert `Content-Length`, `Accept-Ranges` und beantwortet Range-Requests mit **206**. `Content-Disposition: inline`
  (anzeigen statt herunterladen) + Pfad-Sicherheit über `safeFull` und 404 bei fehlender Datei.

  **Nachtrag (Live-Test durch Paul):** Nach `plugins:true` lud zwar Chromiums PDF-Viewer, zeigte aber „**Fehler beim
  Laden des PDF-Dokuments / Neu laden**". Ursache 2: der handgerollte `createReadStream().pipe()` lieferte **kein
  `Content-Length`, kein `Accept-Ranges`, keine 206-Antwort** (chunked) – PDFium (und natives `<audio>`/`<video>`-Seeking)
  **brauchen** das. Fix = `res.sendFile()` (oben). Diagnose bestätigt per `curl` gegen die laufende Alt-Instanz
  (text/plain, chunked, ignoriert Range) und gegen einen isolierten Test-Server mit dem echten Vault-Pfad + der echten
  3,6-MB-PDF.
- [x] **Electron-PDF-Viewer aktiviert** (`electron/main.js`, `createWindow`): `webPreferences.plugins:true`.
- [x] **Office-In-App-Vorschau** (`src/ui-server.js`, neuer `POST /api/preview/office`): konvertiert die Datei per
  **markitdown** in eine **temporäre** `.md` (Systemtemp, **nicht** in den Vault) und gibt das Markdown zurück → Inhalt
  direkt in Nexus lesbar. **Kein `shell:true`** → Node quotet die Argumente selbst, daher korrekt auch bei Vault-Pfaden
  **mit Leerzeichen** („Nexus Vaults"). 25-s-Timeout, sauberes Temp-Cleanup, Fehler → Frontend-Fallback.
- [x] **„Extern öffnen"** (`src/ui-server.js`, neuer `POST /api/open-external`): öffnet die Datei im Standardprogramm.
  Bevorzugt **Electrons `shell.openPath`** (robust, lazy & guarded `import('electron')`), fällt im reinen Node-Betrieb
  (`npm run ui`) auf OS-Befehle zurück (Windows `rundll32 url.dll,FileProtocolHandler`, mac `open`, Linux `xdg-open`).
- [x] **Frontend-Viewer** (`public/index.html`):
  - **Office-Viewer `renderOfficeView`**: lädt die markitdown-Vorschau, rendert sie über `renderMarkdown` mit Hinweis-
    Banner + Toolbar-Button „📂 In Word/Excel/PowerPoint öffnen". Schlägt die Vorschau fehl → `renderExternalFallback`
    **und** ein `uiConfirm`-**Popup** „… In Word öffnen?" → bei Ja `openExternalFile`.
  - **Audio/Video** `renderMediaView` (native `<audio>`/`<video controls>`), Endungs-Sets `AUDIO_EXT`/`VIDEO_EXT`.
  - **Binär-Fallback**: `looksBinary()` erkennt Nicht-Text (NUL/`�`-Anteil > 5 %); `renderPlain` zeigt dann statt
    Kauderwelsch die `renderExternalFallback`-Karte mit „extern öffnen".
  - **PDF-Viewer**: zusätzlicher „📂 Extern öffnen"-Button als Notausgang.
  - **`openExternalFile()`** ruft `/api/open-external`; `friendlyApp(ext)` liefert Word/Excel/PowerPoint.
  - **Dispatcher** (`openFile`) + **Splitscreen** (`openCenterSplit`) routen Office/Audio/Video/Binär konsistent.
  - Neues CSS: `.media-view`, `.ext-fallback` (+`.ef-*`), `.of-banner` – theme-sicher (nur CSS-Vars).

### Verifikation
- [x] `node --check` für `src/ui-server.js` + `electron/main.js` → **OK**.
- [x] `npm run verify:html` → **OK** (3128 Zeilen, Inline-Script grün, Ende `</html>`). Hinweis: bei der Bearbeitung war
  kurzzeitig **1 NUL-Byte** in einem Kommentar (bekannte Mount-Divergenz) – entfernt, erneut grün.
- [x] **markitdown vorhanden** (`python -m markitdown --help` → exit 0).
- [x] **End-to-End-Test der Konvertierung** mit **Leerzeichen im Pfad** (`…/nexus test dir/demo file.csv`) → exit 0,
  saubere Markdown-Tabelle. Bestätigt: `spawn` ohne Shell + Leerzeichen-Pfad funktioniert.
- [x] **End-to-End-Test `/api/file`** (isolierter Test-Server, echte PDF): GET → 200 + `application/pdf` +
  `Content-Length: 3646088` + `Accept-Ranges: bytes`; `Range: bytes=0-99` → **206** + `Content-Range: bytes 0-99/3646088`
  + exakt 100 Bytes (PDF-Magic `%PDF-1.7`). Genau das, was PDFium braucht.
- [ ] **Live-Augenschein offen (Paul):** App **neu starten** (wegen `plugins:true` + Server-Änderungen). Dann: PDF öffnet
  und rendert; docx/xlsx/pptx zeigen eine lesbare Vorschau in Nexus + Button „In Word/Excel öffnen"; nicht konvertierbare
  Office-Datei → Popup „In … öffnen?" → öffnet extern; mp4/mp3 spielen nativ; eine echte Binärdatei zeigt die
  „extern öffnen"-Karte statt Kauderwelsch.

### Bekannt / optional (nicht in dieser Session)
- `/api/convert/markitdown` (Rechtsklick→Markdown, bestehend) nutzt weiterhin `shell:true` → **gleicher latenter
  Leerzeichen-Bug** wie hier behoben. Nicht von Paul gemeldet, daher unangetastet; bei Bedarf analog auf `shell:false`
  umstellen.

### TODO Paul
- [ ] **App neu starten** (neuer UI-Server + `plugins:true` greifen erst nach Neustart).
- [ ] Git-Commit: `git add src/ui-server.js electron/main.js public/index.html STATUS.md && git commit -m "Session 40: Viewer-Reparatur – PDF (Content-Type + sendFile/Range + plugins), Office-In-App-Vorschau (markitdown) + extern öffnen, Audio/Video, Binär-Fallback"`

---

## Stand: 2026-06-16 (Session 39 – Rail-Flyout: harte Obergrenze unter den Tabs, Tabs bleiben immer sichtbar)

Paul-Report (Screenshot): Beim Anklicken eines Themen-Icons öffnet das **Rail-Flyout** (Ordner-Popup); zur Zentrierung
des Icons und des ausgewählten Unterordners **fährt das Popup nach oben** und schiebt sich dabei **über die Tab-Leiste**.
Gewünscht: eine **harte Grenze unterhalb der Tabs**, sodass die Tabs **immer sichtbar** bleiben. Reine UI-Änderung in
`public/index.html`.

### Ursache
- `openRailFlyout` klemmte die obere Position des Flyouts hart auf **`8px`** ab Viewport-Oberkante – an **zwei** Stellen:
  (1) Initial-Positionierung (`finalTop=Math.max(8,…)`), (2) Unterordner-Zentrier-Animation
  (`if(newTop<8){…newTop=8}`). 8px liegt **über** der Tab-Leiste → das Popup konnte die Tabs verdecken.

### Erledigt
- [x] **Neuer Helper `railTopLimit()`** (`public/index.html`): liefert den Viewport-y **knapp unter der Tab-Leiste**
  (`#tabbar` ist `position:absolute;top:0` in der `.col` → `getBoundingClientRect().bottom + 6`; Flyout ist
  `position:fixed`, also gleiche Viewport-Koordinaten). `Math.max(8,…)` als Sicherheitsnetz. **Layout-sicher:** misst
  die echte Tab-Höhe, passt sich automatisch an Standard (~37px) **und** Studio-Layout (höhere Leiste) an.
- [x] **Beide Klemm-Stellen auf `railTopLimit()` umgestellt:** (1) `finalTop=Math.max(railTopLimit(),Math.min(finalTop,
  vh-margin-foH))`; (2) Unterordner-Zentrierung `const lim=railTopLimit(); if(newTop<lim){scrollRest=lim-newTop;
  newTop=lim;}`. Reicht der Platz oben nicht, wird der Rest wie bisher **im Flyout gescrollt** (statt über die Tabs zu
  fahren) – das Zentrier-Gefühl bleibt, nur die Obergrenze ist jetzt die Tab-Unterkante.

### Verifikation
- [x] `npm run verify:html` → **OK** (3023 Zeilen, Inline-Script `node --check` grün, Ende `</html>`).
- [x] Theme-/Layout-sicher: misst Tab-Leiste zur Laufzeit, kein Hartcode der Höhe; Studio- **und** Standard-Layout
  abgedeckt.
- [ ] **Live-Augenschein offen (Paul):** Themen-Icon mit vielen/tiefen Unterordnern anklicken → Popup öffnet/zentriert,
  fährt aber **nie über die Tab-Leiste**; die Tabs bleiben oben sichtbar. Unterordner aufklappen → Reihe zentriert sich,
  Rest scrollt im Popup. Standard- **und** Studio-Layout.

### TODO Paul
- [ ] Git-Commit: `git add public/index.html STATUS.md && git commit -m "Session 39: Rail-Flyout harte Obergrenze unter den Tabs (railTopLimit), Tabs bleiben immer sichtbar"`

---

## Stand: 2026-06-16 (Session 38 – Achsen-Lock beim Scrollen: nie mehr diagonal, immer nur eine Achse)

Paul-Report: Beim Scrollen passiert oft genau das Gewünschte (vertikal **oder** horizontal, die jeweils andere Achse wird
ignoriert) – **aber** bei einer **schrägen** Scroll-Bewegung scrollt Nexus **beide Achsen parallel**. Gewünscht: **immer
nur eine Achse** gleichzeitig. Reine UI-Änderung in `public/index.html`.

### Ursache
- `.note-area` ist `overflow:auto` (scrollt vertikal **und** horizontal). Trackpad/Maus melden bei schräger Bewegung
  `deltaX` **und** `deltaY` gleichzeitig → der Browser scrollt **nativ beide Achsen** zugleich (Diagonal-Scroll). Es gab
  keinen Achsen-Lock; der bestehende `wheel`-Listener fing nur `ctrlKey` (Zoom) ab, alles andere lief nativ durch.

### Erledigt
- [x] **`onNoteWheel`-Handler mit Achsen-Lock** (`public/index.html`): ersetzt den alten Inline-`wheel`-Listener auf
  `#note-area`. Logik:
  - `ctrlKey` weiterhin = Notiz-Zoom (`bumpNoteW`), unverändert.
  - Sonst: dominante Achse bestimmen (`|deltaY| >= |deltaX|` → vertikal, sonst horizontal), `preventDefault`, und per
    `area.scrollBy({…,behavior:'instant'})` **nur diese eine Achse** scrollen. `behavior:'instant'` umgeht das
    `scroll-behavior:smooth` der `.note-area` (sonst träge/nachlaufend) – gleiche Technik wie beim Öffnen-Zentrieren.
  - **Geste-Stickiness:** die einmal gewählte Achse bleibt für die laufende Geste fix; erst eine Pause > 140 ms
    (`e.timeStamp`) startet eine neue Geste und bestimmt die Achse neu. So springt es bei einer Diagonalen nicht
    Event-für-Event zwischen den Achsen hin und her.
  - **deltaMode-Normalisierung:** `deltaMode 1` (Zeilen, v. a. Firefox) → ×16 px, `deltaMode 2` (Seiten) → ×Fensterhöhe;
    Maus/Trackpad in Electron-Chromium = `deltaMode 0` (Pixel) → ×1, also 1:1 wie die native Scroll-Geschwindigkeit.
  - State über zwei Modul-Variablen `_wheelAxis` / `_wheelTs` (kein `Date.now()` nötig, nutzt `e.timeStamp`).

### Verifikation
- [x] `npm run verify:html` → **OK** (3018 Zeilen, Inline-Script `node --check` grün, Ende `</html>`).
- [x] Theme-/Layout-sicher: reine JS-Scroll-Logik auf `#note-area`, kein CSS-/Hartcode-Eingriff; Zoom-Verhalten
  (`ctrlKey`) unverändert.
- [ ] **Live-Augenschein offen (Paul):** breit gezoomte / nach links-rechts verschobene Notiz öffnen → vertikal scrollen
  ignoriert seitlich, seitlich scrollen ignoriert hoch/runter, **schräg** scrollt **nicht mehr** beidachsig (folgt der
  dominanten Richtung). Strg+Mausrad zoomt weiterhin. Standard- **und** Studio-Layout.

### TODO Paul
- [ ] Git-Commit: `git add public/index.html STATUS.md && git commit -m "Session 38: Achsen-Lock beim Scrollen (onNoteWheel) – nur eine Achse pro Geste, kein Diagonal-Scroll mehr"`

---

## Stand: 2026-06-16 (Session 37 – Bearbeiten-Button wandert ruckelfrei mit dem rechten Panel + Inhalt-Box beim Öffnen eingeklappt)

Paul-Report (2 Punkte): (1) Beim **Vergrößern des rechten Panels im Studio-Layout** **wackelt der „Bearbeiten"-Button** –
er soll **perfekt flüssig mit dem rechten Panel mitwandern**; (2) beim **Öffnen einer Notiz** soll das **Inhalt-Fenster**
(„Inhalt"/Inhaltsverzeichnis in der Notiz) **standardmäßig eingeklappt** sein. Reine UI-Änderung in `public/index.html`.

### Ursache (1) – das Wackeln
- `#note-edit-fab` erbt von `.ed-edit-btn` die Regel `transition:.15s` (= `transition: all .15s`). Im Studio-Layout sitzt
  der Button per `right:calc(var(--col-r)+38px)`. Beim Ziehen des Resizers wird `--col-r` pro `mousemove` neu gesetzt → das
  **rechte Panel springt sofort** (kein transition), der **Button animiert sein `right` aber über 150 ms hinterher** und
  „hängt" dem Panel ständig nach → sichtbares Wackeln/Ruckeln.

### Erledigt
- [x] **(1) Button-Transition entkoppelt** (`public/index.html`, `#note-edit-fab`): explizites
  `transition:background-color .15s,border-color .15s` (überschreibt das geerbte `transition: all .15s`). Damit animiert
  **nur** noch der Hover (Hintergrund/Rand) weich, die **Position (`right`) folgt instant** – der Button wandert jetzt
  **synchron und ruckelfrei** mit dem rechten Panel (beide an `var(--col-r)` gekoppelt). Gilt für Studio-Layout.
- [x] **(2) Inhalt-Box eingeklappt** (`public/index.html`, `renderToc`): `<details class="toc" open>` → `<details
  class="toc">` (das `open`-Attribut entfernt). Beim Öffnen einer Notiz ist das „Inhalt"-Fenster jetzt **zugeklappt**
  (Dreieck ▸), per Klick aufklappbar. CSS unverändert (`.toc[open] summary::before` dreht das Dreieck weiterhin korrekt).

### Verifikation
- [x] `npm run verify:html` → **OK** (3000 Zeilen, Inline-Script `node --check` grün, Ende `</html>`).
- [x] Theme-/Layout-sicher: nur CSS-Transition + entferntes HTML-Attribut, keine Hartcodes; Button-Logik an `--col-r`
  unverändert.
- [ ] **Live-Augenschein offen (Paul):** (1) Studio-Layout → rechtes Panel per Resizer vergrößern/verkleinern → der
  „Bearbeiten"-Button gleitet flüssig mit, kein Wackeln; (2) Notiz mit >2 Überschriften öffnen → „Inhalt"-Box ist
  eingeklappt, Klick klappt sie auf.

### TODO Paul
- [ ] Git-Commit: `git add public/index.html STATUS.md && git commit -m "Session 37: Bearbeiten-Button ruckelfrei am rechten Panel (transition nur Hover, nicht Position) + Inhalt-Box beim Öffnen eingeklappt"`

---

## Stand: 2026-06-16 (Session 36 – Notiz frei nach links/rechts schiebbar (keine Zwangs-Zentrierung), weißer Scrollbar-Fleck weg)

Paul-Report (in 3 Schritten präzisiert): (1) der **weiße Fleck unten** (Screenshot) muss weg; (2) **keine automatische
Zentrierung** mehr; stattdessen eine **horizontale Scrollbar im gleichen (dünnen) Stil** wie die vertikale, **sodass man
eine Notiz, die schmaler als das Fenster ist, ganz nach links bzw. ganz nach rechts schieben kann**, um den Text bündig
an einen Rand zu legen.

### Ursache / Konzept
- Bisher zentrierte `.note-content{margin:0 auto}` die Notiz **fix** in der Mitte → bei schmaler Notiz kein horizontaler
  Überlauf, also **keine** Scrollbar und **kein** Verschieben möglich.
- (Fleck) Der weiße Fleck ist die **Scrollbar-Ecke** (`::-webkit-scrollbar-corner`) – Track/Thumb waren gestylt, die Ecke
  nicht → WebKit rendert sie in der Default-Farbe (hell/weiß).

### Erledigt
- [x] **Zwangs-Zentrierung entfernt + Schiebe-Spielraum** (`public/index.html`): statt `margin:0 auto` jetzt
  **symmetrische Seitenränder** `margin-inline:max(0px, 100% - var(--note-w,…))` (= Fensterbreite − Notizbreite je Seite).
  Dadurch entsteht genau so viel horizontaler Scroll-Spielraum, dass die schmale Notiz von **bündig-links bis
  bündig-rechts** wandert und **nie ins Leere** scrollt. Notiz ≥ Fenster → Ränder 0 → normaler Overflow-Scroll wie gehabt.
  In **beiden** Layouts (Standard `min(1000px,100%)`, Studio `min(760px,100%)`).
- [x] **Horizontale Scrollbar im Stil der vertikalen** (`public/index.html`): `.note-area` zurück auf `overflow:auto`
  (Session-35-Sonderfall `overflow-x:scroll` + dicke Spur **rückgängig**). Da bei schmaler Notiz jetzt **immer** Überlauf
  besteht, ist auch immer ein normaler **6px-Thumb** da – optisch identisch zur seitlichen Scrollbar.
- [x] **Default-Position beim Öffnen = mittig** (`public/index.html`, `renderMarkdownView`):
  `area.scrollTo({left:(area.scrollWidth-area.clientWidth)/2,behavior:'instant'})` (halber Scroll-Spielraum; `instant`
  umgeht das `scroll-behavior:smooth`, sonst „fliegt" die Notiz beim Öffnen herein). Von dort frei nach ganz links/rechts
  schiebbar. (Optik wie früher zentriert, aber jetzt verschiebbar.)
- [x] **(Fleck) Globale Regel `::-webkit-scrollbar-corner{background:transparent}`** (`public/index.html`). Greift in
  **beiden** Layouts (Studio überschreibt nur Track/Thumb, nicht die Ecke).

### Verifikation
- [x] `npm run verify:html` → **OK** (3000 Zeilen, Inline-Script `node --check` grün, Ende `</html>`).
- [x] CSS theme-/layout-sicher (nur CSS-Vars + `max()`/`min()`/`color-mix`, kein Hartcode).
- [ ] **Live-Augenschein offen (Paul):** Notiz schmaler als Fenster öffnen → dünne horizontale Scrollbar unten (gleicher
  Stil wie seitlich); Notiz lässt sich bis **ganz links** und **ganz rechts** schieben (Text bündig am Rand), nie ins
  Leere; **kein weißer Fleck** an der Ecke. Breit-gezoomte Notiz scrollt normal. (Standard- **und** Studio-Layout.)

---

## Stand: 2026-06-15 (Session 35 – Themen löschbar (Watcher-Lock weg), fixierter Bearbeiten-Button, Schriftgrößen + Notiz-Zoom)

Paul-Report (mehrere Punkte, teils nachgeschoben): (1) **Themen lassen sich nicht löschen** – weder in Nexus noch direkt
im Windows-Vault-Ordner; (2) der **Bearbeiten-Button** soll **fixiert** bleiben (wie die Tabs), **genau so aussehen wie
bisher** und – nachgereicht – **ganz rechts im Notizfeld auf gleicher Höhe wie die Tabs** sitzen;
(3) in den Einstellungen gibt es nur die **Editor**-Schriftgröße – zusätzlich **Notiz-Schriftgröße** und
**Schriftgröße rechtes Panel** separat regelbar; (4) Notizen **ranzoomen** wie gewohnt (**Trackpad-Pinch / Strg+Mausrad**),
dazu **seitliche Scrollbar** und **zentrierter Text** bei Größenänderung des rechten Panels.

### Ursache (1) – der eigentliche Bug
- Der **MCP-Server** (`src/server.js`, läuft headless / über Claude Desktop) startet einen **chokidar-Watcher** auf den Vault.
  Default = **nativer** `fs.watch` (Windows: `ReadDirectoryChangesW`) → hält **offene Verzeichnis-Handles**. Folge: der
  Ordner ist gesperrt → `rmSync` in `ui-server.js` wirft **EPERM** (Löschen in Nexus scheitert) **und** der Windows-Explorer
  kann den Ordner ebenfalls nicht löschen. Genau Pauls Symptom „weder in Nexus noch im Windows-Ordner".
- `ui-server.js` (Electron-In-Process, **kein** eigener Watcher) und der MCP-Server sind getrennte Prozesse, teilen sich
  aber den Vault → der Lock des MCP-Watchers blockiert das Löschen prozessübergreifend.

### Erledigt
- [x] **(1) Watcher auf Polling umgestellt** (`src/indexer.js`, `watchVault`): `usePolling:true, interval:700,
  binaryInterval:1500`. Polling öffnet **keine** dauerhaften Verzeichnis-Handles → Ordner/Themen sind wieder löschbar
  (Nexus **und** Explorer). Kommentar im Code erklärt das Windows-Problem.
- [x] **(1) `rmSync` robuster** (`src/ui-server.js`, `/api/delete`): `maxRetries:5, retryDelay:120` fängt kurzzeitige
  Windows-Locks (EPERM/EBUSY) ab, falls ein Watcher den Ordner gerade erst losgelassen hat.
- [x] **(2) Bearbeiten-Button als fixiertes Overlay** (`public/index.html`): Button aus dem Notiz-Markup heraus als
  **persistentes Element `#note-edit-fab` in die `.col`** (direkt nach der `.tabbar`) verlegt. Regel
  `#note-edit-fab{position:absolute;top:calc(var(--tab-h)/2);right:28px;transform:translateY(-50%);z-index:21}` →
  sitzt **ganz rechts im Notizfeld auf gleicher Höhe wie die Tabs** (im Tab-Band) und bleibt beim Scrollen fix.
  `right:28px` (statt 14px) hält ihn **frei vom Scrollbalken**. **Optik 1:1** (gleiche `.ed-edit-btn`-Klasse).
  Studio-Override: `right:calc(var(--col-r)+38px)`, damit der Button nicht hinter dem dort schwebenden rechten Panel verschwindet. Sichtbar nur in der Markdown-Leseansicht: `showEditFab(path)`
  am Ende von `renderMarkdownView`, `hideEditFab()` an allen anderen Ansichts-Einstiegen (openFile/openEditor/
  openFolderView/doSearch/showEmptyTab/switchVault/ctxDelete).
- [x] **(3) Zwei neue Schriftgrößen-Regler** (`public/index.html`):
  - **Notiz-Schriftgröße** → CSS-Var `--reader-fs` auf `.md-body` (Default 14.5px, Bereich 12–24, Schritt 0.5).
    Gilt für Lese-Ansicht **und** die 2. Split-Ansicht (`#note-pane2`, ebenfalls `.md-body`).
  - **Schriftgröße rechtes Panel (Gliederung)** → CSS-Var `--panel-fs` auf `#outline-panel .ol-row` (Default 12px,
    Bereich 10–22, Schritt 0.5).
  - JS analog zum Editor-Regler: `currentReaderFs/applyReaderFs/onReaderFsInput` + `currentPanelFs/applyPanelFs/
    onPanelFsInput` (localStorage `nexus.readerFontSize` / `nexus.panelFontSize`), in `init()` angewandt, zwei neue
    `set-section`-Slider direkt unter „Editor-Schriftgröße" in `renderSettings()`.
- [x] **(4) Notiz-Zoom = Breite der Notiz, nicht Schriftgröße** (`public/index.html`): Strg+Mausrad / Trackpad-Pinch
  setzt die **Breite** `.note-content` über CSS-Var **`--note-w`** (Default `min(1000px,100%)` = wie bisher). **Schmaler
  als das Fenster** → `margin:0 auto` zentriert mit Rändern; **breiter als das Fenster** → `.note-area{overflow:auto}`
  blendet **unten eine horizontale Scrollbar** ein (links/rechts verschieben). Schrift bleibt, Text reflowt. JS:
  `currentNoteW/applyNoteW/setNoteW` (localStorage `nexus.noteW`, Clamp 300–4000px; 0 = Default-Var entfernt),
  `bumpNoteW(deltaY)` = **additiv** `base - deltaY*1.1` (schnell + symmetrisch; Startbasis = aktuelle Content-Breite).
  **Ein `wheel`-Listener** auf `#note-area` (`{passive:false}`) fängt `e.ctrlKey` ab (Chromium meldet **Trackpad-Pinch
  als wheel+ctrlKey**), `preventDefault` unterdrückt den Chromium-Seiten-Zoom.
- [x] **(4) Scrollbars** (`public/index.html`): vertikale (seitliche) Scrollbar in **Original-Optik** (6px,
  `overflow-y:auto` – bei Bedarf). **Horizontale Bottom-Scrollbar IMMER sichtbar** (`overflow-x:scroll`), zum
  Links/Rechts-Verschieben sobald die Notiz breiter als das Fenster gezoomt ist.
- [x] **(4) Studio-Cap behoben** (`public/index.html`): `.app[data-layout="softdark"] .note-content` hatte hartes
  `max-width:760px` → kappte die Zoom-Breite im Studio-Layout (dort „Zoom funktioniert gar nicht"). Jetzt ebenfalls
  `width:var(--note-w,min(760px,100%));max-width:none`, damit der Zoom in **beiden** Layouts greift.
- [x] **(4) Notiztext zentriert** (`public/index.html`): `.note-content{…;margin:0 auto}` → der Text **re-zentriert sich
  automatisch**, wenn das rechte Panel (eigene Grid-Spalte) verkleinert/vergrößert wird. Studio hatte `margin:0 auto`
  bereits.

### Verifikation
- [x] `node --check src/indexer.js` + `node --check src/ui-server.js` → **OK**.
- [x] `npm run verify:html` → **OK** (2991 Zeilen, Inline-Script `node --check` grün, Ende `</html>`).
- [x] Theme-/Layout-sicher: nur CSS-Vars (`--reader-fs`, `--panel-fs`, `--note-w`, `--col-r`, bestehende
  `.ed-edit-btn`-Styles + Original-Scrollbar), kein Hartcode; gilt für Standard- **und** Studio-Layout.
- [ ] **Live-Augenschein offen (Paul):** (1) Claude Desktop **neu starten** (neuer Watcher mit Polling) → Thema/Ordner
  in Nexus **und** im Windows-Explorer löschbar; (2) Notiz öffnen → „✎ Bearbeiten" sitzt ganz rechts auf Tab-Höhe,
  bleibt beim Scrollen stehen, Optik wie bisher; (3) Einstellungen → „Notiz-Schriftgröße" und „Schriftgröße rechtes
  Panel" regeln getrennt; (4) über der Notiz Strg+Mausrad / Trackpad-Pinch → Notiz wird **breiter/schmaler**; schmal =
  zentriert mit Rändern, breit über Fensterbreite = **untere Scrollbar** zum Links/Rechts-Verschieben; vertikale
  Scrollbar in Original-Optik. (Standard- **und** Studio-Layout prüfen.)

### TODO Paul
- [ ] **Claude Desktop neu starten** (sonst läuft der alte Watcher mit nativem Lock weiter).
- [ ] Git-Commit: `git add src/indexer.js src/ui-server.js public/index.html STATUS.md && git commit -m "Session 35: Themen löschbar (chokidar Polling), Bearbeiten-Button als fixes Overlay (ganz rechts, Tab-Höhe), Notiz-/Panel-Schriftgröße + Notiz-Zoom (Strg+Mausrad/Pinch)"`

---

## Stand: 2026-06-15 (Session 34g – „Neuer Vault"-Button im Vault-Auswahl-Dropdown, v. a. fürs Studio-Layout)

Paul-Wunsch: In der **Vault-Auswahl** fehlt ein **Button zum Anlegen eines neuen Vaults** – optisch passend
einpflegen, **nur sichtbar, wenn man auf das Vault-Icon klickt** (also im Dropdown, nicht dauerhaft).
Hintergrund: Im **Studio-Layout (softdark)** ist die `.vault-add` (`+`-Verwalten-Schaltfläche neben dem Selector)
per `display:none` ausgeblendet → das Dropdown war dort die **einzige** Vault-Einstiegsstelle, hatte aber nur die
Vault-Liste, kein „Anlegen". Reine UI-Änderung in `public/index.html`.

### Erledigt
- [x] **Neue Dropdown-Zeile `.vs-add`** ans Ende von `#vault-sel-drop` gehängt (in `refreshVaultSelector`): `+`-Kachel
  (`.vs-add-plus`) + Label „Neuer Vault…", per `border-top` von der Vault-Liste abgesetzt. Klick schließt das
  Dropdown und öffnet das bestehende **„Vaults verwalten"-Modal** (`openVaultModal()`) mit dem Anlege-Feld – kein
  neuer Flow, sondern Wiederverwendung der vorhandenen `createVault()`-Logik.
- [x] **Optik theme-/layout-sicher**: nur CSS-Vars (`--dim`, `--text`, `--accent`, `--accent-12`, `--panel2`,
  `--border`), kein Hartcode → folgt Standard (blau) **und** Studio-Varianten (Bernstein/Hell). Hover = `--accent-12`
  + Akzent-Text, `+`-Kachel bekommt Akzent-Rand. Passt durch `width:200px` ins Studio-Dropdown.
- [x] **Schließ-Logik unberührt**: Button liegt in `#vault-sel-wrap`, der `_closeVaultDrop`-Capture-Handler lässt
  In-Wrap-Klicks durch; der eigene Click-Handler entfernt `.open` explizit und ruft dann das Modal auf.

### Verifikation
- [x] `npm run verify:html` → **OK** (2955 Zeilen, Inline-Script `node --check` grün, Ende `</html>`).
- [x] `--accent-12` existiert als CSS-Var (Zeile 16), kein Hartcode.
- [ ] **Live-Augenschein offen (Paul):** Vault-Icon anklicken → Dropdown zeigt unter der Vault-Liste „+ Neuer Vault…";
  Klick öffnet das Verwalten-Modal mit Anlege-Feld. In Standard- **und** Studio-Layout prüfen.

### TODO Paul
- [ ] Git-Commit: `git add public/index.html STATUS.md && git commit -m "Session 34g: Neuer-Vault-Button im Vault-Auswahl-Dropdown (vs-add), öffnet Verwalten-Modal – v. a. fürs Studio-Layout"`

---

## Stand: 2026-06-15 (Session 34f – Gliederungs-Klick: Überschrift landet nicht mehr hinter den Tabs)

Paul-Report: Beim Klick auf einen Punkt in der **Gliederung (Outline rechts)** wird die Ziel-**Überschrift
hinter die Tab-Leiste** gescrollt und ist verdeckt – sie soll **tiefer** stehen, sodass sie gut sichtbar ist.

### Ursache
- Die `.tabbar` liegt `position:absolute; top:0` **über** der `.note-area`; der nötige Freiraum wird über
  `padding-top:var(--tab-h)` (42px Standard, 60px im Studio-/Softdark-Layout) reserviert.
- Der gemeinsame Scroll-Anker `_olOffset(area)` zählte aber nur eine etwaige sticky `.file-toolbar` + 10px.
  Markdown-Notizen haben **keine** `.file-toolbar` → Offset war nur **10px** → die angeklickte Überschrift
  landete ~10px unter der Oberkante, also **hinter der ~42px hohen Tab-Leiste**.

### Erledigt
- [x] **`_olOffset` um die Tab-Höhe ergänzt**: liest `padding-top` der `note-area` (= `--tab-h`) per
  `getComputedStyle` und addiert sie zum Offset (`tabH + file-toolbar-Höhe + 10px`). Layout-sicher – passt
  sich automatisch an 42px (Standard) bzw. 60px (Studio/Softdark) an, kein Hartcode.
- [x] **Scroll-Spy bleibt konsistent**: nutzt denselben `_olOffset`-Anker, die aktive Outline-Markierung
  trifft jetzt dieselbe Überschrift, die beim Klick oben erscheint.

### Verifikation
- [x] `npm run verify:html` → **OK** (2945 Zeilen, Inline-Script `node --check` grün, Ende `</html>`).
- [ ] **Live-Augenschein offen (Paul):** Klick auf einen Gliederungspunkt → Überschrift erscheint **unter**
  der Tab-Leiste, gut sichtbar (Standard- und Studio-Layout).

### TODO Paul
- [ ] Git-Commit: `git add public/index.html STATUS.md && git commit -m "Session 34f: Gliederungs-Klick scrollt Überschrift unter die Tab-Leiste (Tab-Höhe in _olOffset)"`

---

## Stand: 2026-06-15 (Session 34e – Breadcrumb-Pfad nicht mehr abgeschnitten + Tab-D&D-Bug behoben + Verschiebe-Animation)

Paul-Report (2 Punkte): (1) Der **Pfad (Breadcrumb oben)** soll **weiter laufen** statt abgeschnitten zu werden;
(2) **Bug bei Tab-Drag&Drop:** zieht man den **linken** Tab auf den **rechten**, passiert nichts – nur
**rechts→links** klappt. Außerdem soll die Verschiebung **mit Animation** laufen, wie bei den Themen-Icons.
Reine UI-Änderung in `public/index.html`.

### Ursache des Tab-Bugs
- Alter Drop-Handler nutzte `insertAt = dst>src ? dst-1 : dst`. Beim Ziehen **links→rechts** (z. B. src=0, dst=1)
  ergab das nach dem `splice(src,1)` wieder Index 0 → **keine Änderung**. Rechts→links lief zufällig richtig.

### Erledigt
- [x] **Breadcrumb (`.crumb`)**: harte `max-width:400px`-Kappung (+ Ellipsis) entfernt → `flex:1 1 auto;min-width:0`.
  Der Pfad nutzt jetzt die **volle freie Titelleisten-Breite** bis zum Such-Button; Ellipsis nur noch als
  letzte Reserve, wenn wirklich kein Platz mehr ist.
- [x] **Tab-D&D komplett neu** (analog zu den Themen-Icons / `railFlip`): Live-Umsortierung im DOM während des
  `dragover` (Einfügeposition über x-Mittelpunkt der Tabs, `tabAfterEl`), übrige Tabs gleiten per **FLIP-Animation**
  (`tabFlip`, `translateX` + `transform .16s cubic-bezier`). Auf `dragend` wird die DOM-Reihenfolge per
  **`commitTabOrder`** (stabil über neues `data-tid`=Tab-ID) ins `tabs`-Array übernommen, aktiver Tab bleibt aktiv.
  Beide Richtungen funktionieren jetzt. Gezogenes Tab bekommt `.tab-dragging` (opacity .5, grabbing).
- [x] **Split-Drop unberührt**: `_draggingTabId` (Index) wird beim `dragstart` weiterhin gesetzt, damit das Ziehen
  eines Tabs in `center-body` (Splitscreen) wie bisher funktioniert; `_draggingTabEl` ist die neue DOM-Referenz fürs Sortieren.

### Verifikation
- [x] `npm run verify:html` → **OK** (2945 Zeilen, Inline-Script `node --check` grün, Ende `</html>`).
- [x] Theme-/Layout-sicher: nur CSS (`.tab.tab-dragging`, `.crumb`-Flex) + JS-Reorder; keine Hartcodes, gilt für
  Standard- und Studio-Layout (beide nutzen `#tabbar`).
- [ ] **Live-Augenschein offen (Paul):** (1) langer Pfad läuft weiter, statt bei 400px abzuschneiden;
  (2) Tab links→rechts UND rechts→links ziehen klappt, mit gleitender Verschiebe-Animation der übrigen Tabs;
  (3) Tab in das 2. Fenster ziehen (Split) geht weiterhin.

### TODO Paul
- [ ] Git-Commit: `git add public/index.html STATUS.md && git commit -m "Session 34e: Breadcrumb nutzt volle Breite (kein 400px-Cut) + Tab-D&D-Bug (links→rechts) behoben, FLIP-Verschiebe-Animation wie Themen-Icons"`

---

## Stand: 2026-06-15 (Session 34d – Aktivitäts-Panel: Akzent-Schrift + Punkte raus)

Paul-Wunsch (Screenshot, 2 Schritte): Das **Claude-Aktivitäts-Panel unten rechts** soll seine
Einträge in der **Akzentfarbe** zeigen und **ohne die farbigen Punkte** auskommen – inkl. dem
grünen Live-Punkt in der Kopfzeile „Claude-Aktivität · live". Reine CSS-Änderung in `public/index.html`.

### Erledigt
- [x] **Schriftfarbe der Log-Zeilen** (`.log-msg`) von hartem `#b9c2d4` auf **`var(--accent-tx)`** umgestellt
  (gleiche theme-aware Akzent-Textfarbe wie Links/Tabellen-Kopf, Session 34c). Uhrzeit (`.log-time`) folgt
  gedimmt mit (`color-mix(in srgb,var(--accent-tx) 55%,transparent)`), bleibt sekundär.
- [x] **Farbige Puls-Punkte vor jeder Zeile** (`.log-pulse`) auf **`display:none`** – `<span>` bleibt im
  Markup (kein JS-Eingriff), fällt aber aus dem Flex-Layout (kein Lücken-Problem).
- [x] **Grüner Live-Punkt in der Kopfzeile** (`.activity header .live-dot`) ebenfalls **`display:none`**.

### Verifikation
- [x] `npm run verify:html` → **OK** (2927 Zeilen, Inline-Script `node --check` grün, Ende `</html>`).
- [x] Theme-/Layout-sicher: nur CSS-Vars (`--accent-tx`, `color-mix`), kein Hartcode; folgt Standard (blau)
  **und** allen Studio-Varianten (Bernstein/Hell).
- [ ] **Live-Augenschein offen (Paul):** Aktivitäts-Panel unten rechts – Text in Akzentfarbe, keine Punkte
  (weder vor den Zeilen noch grün in der Kopfzeile).

### TODO Paul
- [ ] Git-Commit: `git add public/index.html STATUS.md && git commit -m "Session 34d: Aktivitäts-Panel – Akzent-Schrift (var(--accent-tx)), Puls-Punkte + grüner Live-Punkt entfernt"`

---

## Stand: 2026-06-15 (Session 34c – Tabellen-Überschriften in Akzentfarbe)

Paul-Wunsch (Screenshot): Die Kopfzeilen-Überschriften in Tabellen (z. B. „Verfahren" / „Menge")
sollen ebenfalls in der **Akzentfarbe** stehen. Reine CSS-Änderung in `public/index.html`.

### Erledigt
- [x] `.md-table th` Textfarbe von hartem `#cdd6e8` auf **`var(--accent-tx)`** umgestellt (dieselbe
  theme-aware Akzent-Textfarbe wie Links/Wikilinks). Header-Hintergrund unverändert. Folgt damit
  automatisch Standard (blau) **und** allen Studio-Varianten (Bernstein/Hell).

### Verifikation
- [x] `npm run verify:html` → **OK** (2927 Zeilen, Inline-Script `node --check` grün, Ende `</html>`).
- [x] Theme-/Layout-sicher: nur CSS-Var, kein Hartcode; `--accent-tx` ist in allen Themes auf Lesbarkeit ausgelegt.
- [ ] **Live-Augenschein offen (Paul):** Tabellen-Kopfzeile in Akzentfarbe (Standard + Studio).

### TODO Paul
- [ ] Git-Commit: `git add public/index.html STATUS.md && git commit -m "Session 34c: Tabellen-Kopfzeilen in Akzentfarbe (var(--accent-tx) statt hartem #cdd6e8)"`

---

## Stand: 2026-06-15 (Session 34b – Bugfix: Scrollbalken im Notizfenster oben nicht klickbar)

Paul-Report: Der Scrollbalken im Notizfenster ist **nicht bis ganz oben klickbar** – erst ab ca. 1 cm
nach unten. Reine CSS-Änderung in `public/index.html`.

### Ursache
- Die schwebende Tab-Leiste (`.tabbar`, Session 33) ist `position:absolute;top/left/right:0;z-index:20`
  und liegt über die **volle Breite** über dem oberen Bereich (≈ `--tab-h`, ~1 cm) der Notizfläche –
  also auch über dem **oberen Ende des Scrollbalkens** am rechten Rand. Obwohl der Container optisch
  transparent ist, fängt er die Klicks ab → das obere Stück Scrollbalken ist nicht erreichbar.

### Erledigt
- [x] `.tabbar` bekommt **`pointer-events:none`** (transparenter Container lässt Klicks durch zum
  Scrollbalken/Inhalt darunter), `.tabbar>*` bekommt **`pointer-events:auto`** → Tabs, `+`-Button und
  Tab-Nav bleiben voll klickbar. Leerflächen (inkl. über dem Scrollbalken) sind jetzt durchlässig.

### Verifikation
- [x] `npm run verify:html` → **OK** (2927 Zeilen, Inline-Script `node --check` grün, Ende `</html>`).
- [x] Theme-/Layout-sicher: nur Pointer-Events der Tab-Leiste, keine Optik-/Hartcode-Änderung; gilt für
  Standard- und Studio-Layout (beide nutzen dieselbe `.tabbar`).
- [ ] **Live-Augenschein offen (Paul):** Scrollbalken bis ganz oben anklickbar; Tabs/`+`/Nav weiter klickbar.

### TODO Paul
- [ ] Git-Commit: `git add public/index.html STATUS.md && git commit -m "Session 34b: Bugfix Scrollbalken – Tab-Leiste pointer-events:none (Klicks bis oben durch), Tabs/Buttons bleiben klickbar"`

---

## Stand: 2026-06-15 (Session 34 – Bugfix: Gliederung quetscht Einträge statt zu scrollen)

Paul-Report (2 Screenshots): In der **Gliederung**-Ansicht werden bei zu vielen Einträgen alle
Zeilen ins Fenster gequetscht (zusammengestaucht). Soll: **gleiche Formatierung wie im Split-Tab**
(Zeilen in natürlicher Höhe) + **Scrollbalken**. Reine CSS-Änderung in `public/index.html`.

### Ursache
- `#outline-panel` war im **Outline-Modus** (`.right-panel[data-rmode="outline"]`) als
  `display:flex;flex-direction:column` gesetzt → jede `.ol-row` wurde damit zum Flex-Child mit
  Default `flex-shrink:1` und wurde bei Überlauf **zusammengestaucht** statt zu überlaufen.
- Im **Split-Modus** ist `#outline-panel` `display:block` → Zeilen behalten natürliche Höhe, Panel
  scrollt (`overflow:auto`). Genau dieses Verhalten war erwünscht.

### Erledigt
- [x] Outline-Regel auf **`display:block`** umgestellt (wie Split). `flex:1` bleibt (Panel füllt die
  Höhe im `.right-panel`-Flex-Column), `min-height:0` ergänzt (Flex-Child-Scroll sauber), `overflow:auto`
  liefert den Scrollbalken. Zeilen rendern jetzt in natürlicher Höhe und scrollen bei Überlauf.

### Verifikation
- [x] `npm run verify:html` → **OK** (2926 Zeilen, Inline-Script `node --check` grün, Ende `</html>`).
- [x] Theme-/Layout-sicher: nur die eine Modus-Regel geändert, keine Hartcodes; Split-Verhalten unberührt.
- [ ] **Live-Augenschein offen (Paul):** Notiz mit vielen Überschriften öffnen → „Gliederung"-Tab zeigt
  Zeilen in voller Höhe + Scrollbalken (kein Quetschen), wie im „Split"-Tab.

### TODO Paul
- [ ] Git-Commit: `git add public/index.html STATUS.md && git commit -m "Session 34: Bugfix Gliederung – Zeilen nicht mehr gequetscht (display:block statt flex), Scrollbalken wie im Split"`

---

## Stand: 2026-06-15 (Session 33 – Notiztext läuft bis ganz oben unter schwebende Milchglas-Tabs)

Paul-Wunsch (Screenshot): Der Notiztext soll **bis ganz oben** im Notizfenster sichtbar sein – auch wenn Tabs
da sind, soll der Text **unter den Tabs weiterlaufen**. Die Tabs **ganz leicht durchsichtig mit Milch-/Frost-Effekt**
(Text verschwommen dahinter). Reine CSS-Änderung in `public/index.html`, theme-/layout-agnostisch.

### Erledigt
- [x] **Tab-Leiste aus dem Flex-Fluss genommen** (`.tabbar`): `position:absolute; top/left/right:0; z-index:20`.
  **Container vollständig transparent** (kein Hintergrund, kein Border, kein Blur) → die Notizfläche bleibt
  **einheitlich bis ganz oben**, kein dunkler Balken mehr. Horizontales Tab-Scrollen (overflow-x) bleibt.
- [x] **Milch-/Frost-Effekt liegt auf den einzelnen Tab-Kacheln** (`.tab`), nicht auf der Leiste: jede Kachel hat
  jetzt `background:color-mix(in srgb,var(--bg) 52%,transparent)` + **`backdrop-filter:blur(14px) saturate(1.3)`**
  (+ `-webkit-`). So **schweben die Tabs über der Fläche** und der Text wird **nur direkt hinter den Tabs**
  verschwommen, der Bereich dazwischen zeigt die Fläche/den Text scharf. Hover 64 %, aktiver Tab 80 % (solider =
  klar erkennbar). Studio: Leiste transparent, aktiver Tab 82 % Frost (statt `--panel2`), runde Pillen (radius 10).
- [x] **Notizinhalt füllt die volle Höhe und läuft unter die Tabs:** neue CSS-Var **`--tab-h`** auf `.col`
  (Standard 42px). `.note-area` bekommt `padding-top:var(--tab-h)` + `scroll-padding-top:var(--tab-h)` → der
  Scroll-Container reserviert exakt die Tab-Höhe, **alle** Inhaltstypen (Reader `.note-content`, Editor `.editor-wrap`
  height:100%, Datei-/PDF-/Bild-Toolbars, Suchtreffer) starten sauber **unter** der schwebenden Leiste, kein
  Funktionselement wird verdeckt. Beim Scrollen läuft der Text unter die Milchglas-Tabs (verschwommen). Reader-
  `.note-content` Top-Padding 30→16px (Tab-Abstand kommt jetzt aus `--tab-h`).
- [x] **Split-Zweitfenster** (`#note-pane2`) bekommt `padding-top:var(--tab-h)` → dessen Kopfzeile (`np2-head`)
  bleibt unter der über die ganze Spaltenbreite schwebenden Tab-Leiste sichtbar.
- [x] **Studio-Layout (softdark):** Tab-Leiste war bisher `transparent` (lag über `--panel`) → jetzt ebenfalls
  Milchglas (`color-mix(in srgb,var(--bg) 58%,transparent)`, Position/Blur von der Basis geerbt). Höhere Leiste
  (padding 8/16 + min-height 33 ≈ 57px) → `--tab-h:60px` im Studio-`.col`-Scope.

### Verifikation
- [x] `npm run verify:html` → **OK** (2926 Zeilen, Inline-Script `node --check` grün, Ende `</html>`).
- [x] Theme-/Layout-sicher: nur CSS-Vars (`--bg`, `--border`, `--tab-h`, `color-mix`, `backdrop-filter`) → folgt
  Standard **und** allen Studio-Varianten (Standard/Dunkler/Hell). Kein Hartcode.
- [ ] **Live-Augenschein offen (Paul):** im laufenden Electron prüfen – Text bis ganz oben, scrollt verschwommen
  unter den Tabs; Tabs leicht durchsichtig/milchig. In Standard- **und** Studio-Layout, auch im Split.

### TODO Paul
- [ ] Nexus neu laden: Notiz öffnen, scrollen → Text läuft unter die milchigen Tabs (verschwommen sichtbar),
  beginnt direkt oben. Editor-/Datei-/Such-Ansicht prüfen (Toolbars nicht verdeckt). Studio + Split gegentesten.
- [ ] Git-Commit: `git add public/index.html STATUS.md && git commit -m "Session 33: Notiztext läuft bis ganz oben unter schwebende Milchglas-Tabs (backdrop-filter, --tab-h-Reserve)"`

---

## Stand: 2026-06-15 (Session 32 – MCP-Ordnertools, Ordner-Icons überall, Flyout bleibt offen + breitenverstellbar)

Paul-Auftrag (3 Punkte): (1) den „Nebenbefund" beheben, dass Ordner löschen/umbenennen im Mount blockiert
ist (ging nur nach `allow_cowork_file_delete`) – Arbeiten soll für Claude **so einfach wie möglich** sein;
(2) **alle** Ordner (auch Unterordner + neu angelegte) bekommen ein Ordner-Icon, nicht nur die obersten;
(3) das Icon-**Popup (Rail-Flyout)** soll breitenverstellbar (nicht gespeichert) sein und **offen bleiben** –
nur ein anderes Icon / dasselbe Icon erneut (oder Esc) schließt es.

### Erledigt
- [x] **MCP-Datei-/Ordner-Tools** (`src/tools.js` + `src/server.js`): neue Tools **`create_folder`**, **`move`**
  (verschieben **und** umbenennen, Dateien **und** ganze Ordner), **`delete`** (Notiz oder ganzer Ordner rekursiv).
  Alle mit Pfad-Sicherheit (`safeFull` – kein `../`-Ausbruch aus dem Vault) + automatischem `reindex`. Damit
  braucht Claude **keine** blockierte Mount-/Datei-System-Operation mehr (`allow_cowork_file_delete` entfällt).
  - **MCP-`instructions`** ergänzt: Tool-Liste um create_folder/move/delete erweitert + Anweisung, Ordner-Ops
    **immer** über diese Tools zu machen (nie Datei-System/Mount). So weiß Claude Desktop es von selbst.
- [x] **Alle Ordner bekommen ein Ordner-Icon** (`makeFolderEl`, `public/index.html`): bisher nur `depth===0`
  (Top-Ordner) ein Icon + Unterordner nur ein grauer Punkt. Jetzt rendert **jeder** Ordner `folderIcon(name)`
  (Unbekannte/neue → Fallback 📁); der Punkt für Unterordner entfällt. Neu angelegte Ordner bekommen das Icon
  automatisch (Baum wird nach jeder Operation neu gerendert).
- [x] **Rail-Flyout bleibt offen + breitenverstellbar** (`public/index.html`):
  - **Offen bleiben:** Klick auf eine Datei im Flyout öffnet sie, lässt das Popup aber offen (kein
    `closeRailFlyout` mehr); Klick **außerhalb** schließt nicht mehr (Rail-Teil aus dem globalen
    `document click`-Handler entfernt). Schließen nur über **dasselbe Icon** (Toggle in `openRailFlyout`),
    ein **anderes Icon** (öffnet dort neu) oder **Esc**. Drag/Layout-/Vault-Wechsel schließen weiterhin explizit.
  - **Breite verstellbar (nicht gespeichert):** neuer Resizer `#rail-flyout-rz` (fixe Position, folgt der rechten
    Kante des Flyouts via `positionFlyoutResizer()`), Ziehen ändert `fo.style.width` (200–560px). Beim **Öffnen**
    wird `fo.style.width=''` zurückgesetzt → bewusst **keine** Persistenz. CSS: `min/max-width` am Flyout +
    Resizer-Optik (Akzent-Linie bei Hover/Drag).

### Verifikation
- [x] `node --check src/server.js` + `node --check src/tools.js` → **OK**.
- [x] `node test/smoke.js` (neuer Block „3b. Ordner-/Datei-Operationen"): **alle 13 neuen Asserts grün**
  (create_folder ok/doppelt-Fehler/`../`-Fehler, move ok/Quelle-weg/fehlende-Quelle-Fehler, delete Ordner
  rekursiv/Wurzel-Fehler). (Hinweis: das Schluss-`rmSync` des Temp-Vaults wirft auf **Windows** EPERM – offener
  SQLite-Handle, **vorbestehend**, Linux-Sandbox nicht betroffen; alle Asserts liefen davor durch.)
- [x] `npm run verify:html` → **OK** (2925 Zeilen, Inline-Script `node --check` grün, Ende `</html>`).
- [ ] **Live-Augenschein offen (Paul):** im laufenden Electron prüfen (siehe TODO).

### TODO Paul
- [ ] **Claude Desktop neu starten** → testen: „Lege Ordner X an / Verschiebe / Benenne um / Lösche Ordner Y"
  läuft jetzt über Nexus (`create_folder`/`move`/`delete`) ohne Mount-Blockade.
- [ ] Nexus neu laden: (1) Unterordner + neue Ordner zeigen ein Ordner-Icon; (2) Icon anklicken → Popup bleibt
  offen (Datei öffnen / daneben klicken schließt nicht), rechte Kante ziehen verstellt die Breite (nach
  Wieder-Öffnen Standardbreite), dasselbe Icon / anderes Icon / Esc schließt.
- [ ] Git-Commit: `git add src/tools.js src/server.js public/index.html test/smoke.js STATUS.md && git commit -m "Session 32: MCP create_folder/move/delete (Mount-Blockade weg), Ordner-Icons für alle Ordner, Rail-Flyout bleibt offen + breitenverstellbar"`

---

## Stand: 2026-06-15 (Session 31 – R12: Obsidian-Regelwerk nach Nexus migriert + friend-ready Scaffold)

Paul-Auftrag: R12 bearbeiten. Ziel – **mindestens das gleiche Regel-Level wie Obsidian** nach Nexus
holen, **alle Claude-Regeln, die an Obsidian hingen, auf Nexus umschwenken**, und überflüssig
gewordene Mechanik (durch die neue Architektur) entschlacken. **Zusatzwunsch (während der Session):**
Regeln müssen **einfach änderbar** bleiben und als **Grundgerüst an Freunde weitergebbar** sein.

### Architektur-Entscheidung (mit Paul abgestimmt)
- **Plan + sofort erste Umsetzung** (nicht nur Konzept).
- Regeln leben **im Vault `_System/`, Nexus-adaptiert** (eine Quelle für Claude Desktop *und* Claude Code).
- **Original behalten**, neue Fassung daneben (`-Nexus`-Suffix) – Original-`Arbeitsweise.md` unangetastet.
- Live-Vault = **`D:\Knowledge-base`** (was Nexus indexiert). Obsidian-Arbeitskopie unter
  `C:\Users\pjhan\Documents\knowledge-base` wird nicht auto-synchronisiert (bewusst).

### Drei-Schichten-Modell (macht „an Freunde weitergeben" zum First-Class-Feature)
1. **Scaffold (Repo `D:\Nexus\rules\`)** – generisch, versioniert, friend-ready, **ohne** persönliche Daten.
2. **Live-Kopie im Vault `_System/`** – aus dem Scaffold installiert, frei editierbar (Nexus-UI = Markdown-Editor).
3. **Persönliches Overlay `_System/Mein-Setup.md`** – Themen/Farben/Methoden; wird bei Scaffold-Update **nie** überschrieben.
- Abschnitte sind markiert: **🔒 STANDARD** (Kern, behalten) vs. **🔧 ANPASSEN** (nutzerspezifisch).

### Obsidian → Nexus – Mechanik-Mapping (Kern von R12)
| Obsidian-Mechanik | Nexus-Äquivalent |
|---|---|
| `app.vault.getFiles()`-JS-Snippet (Datei suchen) | `search` / `list_notes` |
| `app.metadataCache` Tag-Suche-JS | `search { tag }` / `query { field:"tags", op:"contains" }` |
| `getBacklinksForFile()` | `backlinks` |
| Dataview-Blöcke (dynamische Listen) | `query` / `list_notes` **zur Laufzeit** (keine eingebetteten Blöcke nötig) |
| Properties / Frontmatter-Filter | `query` (war Obsidian-Feature → in Nexus **bereits vorhanden**) |
| Tags | `search { tag }` (in Nexus **bereits vorhanden**) |
| `.obsidian/graph.json` + `snippets/farbschema.css` + Tabelle (Dreifachpflege) | **eine** Stelle: Nexus-UI-Ordnerfarben + Logik-Tabelle in `Mein-Setup.md` |
| `cssclass: fach-xx` (Obsidian-CSS) | Nexus-UI-Styling; Feld bleibt für Obsidian-Kompat |
| Python-Skripte (`extract_cache.py`, `pdf2md.py`, `clean_transcript.py`) | unverändert, aber via **Bash-Tool** statt Obsidian-`spawn` |
| Obsidian Wikilink-Auto-Update beim Umbenennen | ⚠️ **Gap** – Nexus aktualisiert nicht auto; manuell via `search`+`patch` (Roadmap: `rename_note`) |
| Obsidian Scheduled Tasks (vault-check, email, deadline-cleanup) | ⚠️ **Gap** – Nexus schedult nichts; bis dahin manuell beim Session-Start / Claude-Code-Agent / OS-Task (Roadmap: Nexus-Scheduler) |

### Erledigt (Session 31)
- [x] **Repo-Scaffold `D:\Nexus\rules\`** angelegt: `README.md` (Drei-Schichten-Modell + Weitergabe an Freunde),
  `Arbeitsweise.md` (alle 23 Regeln generalisiert, Obsidian-Mechanik → Nexus-MCP, Gaps markiert),
  `Session-Start.md` (MCP-Tool-Tabelle + Pflicht-Routinen), `Mein-Setup.template.md` (leeres Overlay).
- [x] **Live-Kopien im Vault** (`D:\Knowledge-base\_System\`): `Arbeitsweise-Nexus.md` (aus Scaffold kopiert,
  Links auf `-Nexus` gefixt, UTF-8 ohne BOM), `Session-Start-Nexus.md` (Vault-Pfad + Tool-Tabelle + Deadline-Routine).
- [x] **Persönliches Overlay `_System/Mein-Setup.md`** mit Pauls Echtdaten: Themen-Index, Themen→Ziel-Zuordnung,
  voller Farbcode, Uni-Modul-Pflichtstruktur, Frontmatter-Schema + Modul-Kürzel, Verweise auf R17/R18 (Volldetails
  im Original), wiederkehrende Routinen + Scheduling-Gap.
- [x] **MCP-`instructions` in `src/server.js`** (Linchpin): Claude Desktop bekommt beim Verbinden den Auftrag,
  zuerst `_System/Session-Start-Nexus.md` + `Arbeitsweise-Nexus.md` + `Mein-Setup.md` zu lesen → Pflichtlektüre
  (Regel 12) passiert automatisch, ohne Erinnerung. (`McpServer(serverInfo, { instructions })` – SDK-geprüft.)
- [x] **`CLAUDE.md` Regel 7** auf die Nexus-adaptierte Quelle umgeschwenkt (Scaffold + Live + Overlay).
- [x] **Original `_System/Arbeitsweise.md` / `Session-Start.md` unangetastet** (Wechsel erst nach Pauls Freigabe).

### Verifikation
- [x] `node --check src/server.js` → **OK** (instructions-Änderung syntaktisch sauber).
- [x] SDK-Check: `McpServer`-Konstruktor reicht 2. Arg an `Server` weiter, `options.instructions` wird in der
  `initialize`-Antwort gesendet (`node_modules/@modelcontextprotocol/sdk/.../server/index.js:50,279`).
- [x] Live-`Arbeitsweise-Nexus.md` als UTF-8 **ohne BOM** geschrieben (Frontmatter-Parser-sicher), 18.182 Bytes.
- [ ] **Live-Test offen (Paul):** Claude Desktop neu starten → prüfen, ob Nexus die Server-`instructions` zeigt
  und Claude die `_System/*-Nexus.md` von selbst liest.

### Roadmap R12 (verbleibende Feature-Tools – nächste Sessions)
- **R12a – Templates:** MCP-Tool `new_from_template { template, path, vars }` (Obsidian „Templates").
- **R12b – Daily Note:** Tool `daily_note { date? }` legt/öffnet Tagesnotiz nach Schema.
- **R12c – Scheduler (schließt 13c/16/23-Gap):** Nexus-Daemon oder dokumentierter Claude-Code-/OS-Task-Weg
  für Vault-Check / Email / Deadline-Cleanup.
- **R12d – `rename_note` mit Link-Fixup (schließt Regel-9-Gap):** umbenennen + alle `[[Links]]` mitziehen.
- **R12e – Kanban/Properties-UI:** Board-Ansicht über Frontmatter (`query`-basiert) in der Nexus-UI.
- **R12f – First-Run-Installer:** beim ersten Start Scaffold → `_System/` kopieren (wenn fehlend) +
  `Mein-Setup.template.md` → `Mein-Setup.md`. Macht Weitergabe an Freunde Ein-Klick.

### TODO Paul
- [ ] Claude Desktop **neu starten** → testen: liest Claude die Nexus-Regeln (`_System/*-Nexus.md`) von selbst?
- [ ] Neue Live-Regeln gegenlesen: `_System/Arbeitsweise-Nexus.md`, `Session-Start-Nexus.md`, `Mein-Setup.md`.
  Wenn passend: **Freigabe**, die Original-`Arbeitsweise.md`/`Session-Start.md` durch die `-Nexus`-Fassung zu ersetzen.
- [ ] Reihenfolge für R12a–f festlegen (Vorschlag: R12f Installer → R12a Templates → R12c Scheduler).
- [ ] Git-Commit: `git add rules/ src/server.js CLAUDE.md STATUS.md && git commit -m "Session 31: R12 – Obsidian-Regelwerk nach Nexus migriert (Scaffold+Overlay), MCP-instructions, Mapping + Roadmap"`
  (Vault-Dateien unter `D:\Knowledge-base` liegen außerhalb des Repos und werden separat gesichert.)

---

## Stand: 2026-06-15 (Session 30 – Suchfenster modernisiert: Popup „Gruppiert" + Trefferseite „Karten")

Paul-Wunsch: die **beiden Suchfenster** (Befehls-/Such-Popup + Volltext-Trefferseite) moderner machen, passend
zum Rest. Erst je 2 Mockups gezeigt, Paul wählte: **Popup A „Gruppiert & getypt"** + **Trefferseite A „Karten"**.
Reine UI-Änderung in `public/index.html`, theme-/layout-agnostisch (nur CSS-Vars, kein Hartcode).

### Erledigt
- [x] **Such-Popup „Gruppiert & getypt"** (Command-Palette, `#pal-overlay`):
  - Neue Eingabezeile mit führendem 🔍-Icon + `Esc`-Chip (`.pal-inputrow`); Input-`border-bottom` in die Zeile verschoben.
  - Treffer jetzt **zweizeilig**: farbige Icon-Kachel (`.pal-tile`, getönt in der Ordnerfarbe via `color-mix`) +
    Titel (`.pal-name`) + Breadcrumb-Pfad (`.pal-sub`, `crumbHtml()`: `📁 Ordner › Datei`).
  - **Sektions-Überschriften** (`.pal-group`): Treffer nach `group` gruppiert (Notizen / Befehle); „Alle Ergebnisse"
    bleibt als Top-Aktion ohne Header, mit `↵`-Hint (`.pal-hint`).
  - Auswahl (`.pal-item.sel`) zusätzlich mit **Akzent-Leiste links** (`inset 2px 0 0 var(--accent)`).
  - JS: `noteItem()`-Helper, `palTint()`, `crumbHtml()`, `pathExt()`, `bareIcon()`; `showPalDefault`/`onPalInput`/
    `renderPalItems` umgeschrieben (Item-Modell jetzt `{group,icon,tile,label,crumb/sub,hint,fn}`). Navigation (↑↓/↵/Esc)
    unverändert – Header zählen nicht als Items.
- [x] **Volltext-Trefferseite „Karten"** (`doSearch`):
  - Kopf mit Count + Query als Akzent-Chip (`.search-head`/`.sh-q`).
  - Jeder Treffer = **Karte** (`.result-card`, `--panel`, Border, radius 12, Hover = `--panel2`+Akzent-Border+Schatten):
    Icon + Titel (`.rc-title`, `--accent-tx` statt hart blau), Breadcrumb-Pfad (`.rc-path`, `crumbHtml()` mit Chevrons),
    Snippet (`.rc-snip`), Treffer-Begriff als **Akzent-Pill** (`.rc-snip b` = `--accent-14`/`--accent-tx`).
  - Alte Klassen `results-header/result-item/result-title/result-path/result-snip` ersetzt (keine Restreferenzen mehr).

### Verifikation
- [x] `npm run verify:html` → **OK** (2890 Zeilen, Inline-Script `node --check` grün, Ende `</html>`).
- [x] Theme-/Layout-sicher: ausschließlich CSS-Vars (`--accent`, `--accent-tx`, `--panel`, `--panel2`, `--border`,
  `--dim`, `--text`, `color-mix`) → folgt automatisch Standard (blau) **und** Studio-Varianten (Bernstein/Hell).
- [ ] **Live-Augenschein offen (Paul):** im laufenden Electron prüfen (Strg+K Popup; Volltextsuche „Alle Ergebnisse").

### TODO Paul
- [ ] Nexus neu laden: (1) Strg+K → Popup zeigt Icon-Kacheln, Pfad-Breadcrumb, Sektionen, Akzent-Auswahl;
  (2) „Alle Ergebnisse für …" → Trefferseite als Karten mit Breadcrumb + hervorgehobenen Treffern. In Standard- und Studio-Layout prüfen.
- [ ] Git-Commit: `git add public/index.html STATUS.md && git commit -m "Session 30: Suchfenster modernisiert – Popup gruppiert/getypt + Trefferseite als Karten"`

---

## Stand: 2026-06-15 (Session 29 – R8 key-frei: Nexus-MCP in Claude Desktop verifiziert)

Paul-Frage: Claude-Anbindung **ohne extra API-Key**, nur mit **Claude-Pro-Abo** (Desktop-App/claude.ai)?

### Ergebnis (Kernaussage)
- **Pro-Abo ≠ API-Key.** Pro deckt claude.ai + Desktop-App ab, **keinen** API-Zugang. Die in R8 beschriebene
  In-App-Suchbox, die direkt die Anthropic-API anruft, braucht zwingend einen (separat abgerechneten) API-Key.
- **Key-freier Weg = Nexus als MCP-Server in Claude Desktop.** Claude Desktop läuft über das Pro-Abo; Nexus
  ist bereits ein vollwertiger MCP-stdio-Server (`src/server.js`). Man chattet in der Desktop-App, Claude greift
  über die Nexus-Tools auf den Vault zu. Null API-Kosten, ToS-konform.

### Erledigt / verifiziert
- [x] **Backup-Commit** des kompletten offenen Arbeitsstands vor der Anbindung (`1454b75`, 32 Dateien).
- [x] **Config war bereits vorhanden** in `%APPDATA%\Claude\claude_desktop_config.json` (kein Schreibzugriff nötig):
  `"nexus": { "command": "node", "args": ["D:\\Nexus\\src\\server.js"] }`. `node` = `C:\Program Files\nodejs\node.exe` (v24.16.0), auf PATH.
- [x] **End-to-end-MCP-Handshake getestet** (initialize + tools/list über stdin): Server `nexus` v0.2.0 antwortet,
  **alle 10 Tools** gelistet (search/outline/read_note/write_note/append_to_section/backlinks/list_notes/reindex/query/patch),
  Vault `D:\Knowledge-base` mit **3899 Dateien** indexiert, File-Watcher aktiv. Keine Fehler.
- [x] `loadConfig()` löst Pfade über `import.meta.url` + absolute dbPath → läuft cwd-unabhängig (egal von wo Claude Desktop startet).

### TODO Paul
- [ ] Claude Desktop neu starten → im Tool-/MCP-Menü taucht **nexus** auf → testen: „Suche in meinem Vault nach …",
  „Lies Notiz X", „Lege Notiz Y an". Läuft über das Pro-Abo, kein Key.
- [ ] Offen bleibt R8 als **optionale** In-App-API-Box (nur für Leute mit eigenem API-Key) – nicht zwingend.

---

## Stand: 2026-06-15 (Session 28 – Studio: 2 Statusbar/Outline-Fixes + 3 wählbare Farbvarianten)

Paul (2 Reports), alles in `public/index.html`:

### Teil A – zwei Fixes
- [x] **„MCP bereit" unten in Akzentfarbe (nur Studio).** Text+Punkt waren hart auf Grün `#10B981`
  (`.statusbar .ok/.dot-status`). Neu: `body[data-layout="softdark"] .statusbar .ok{color:var(--accent)}` +
  `.dot-status{background/box-shadow:var(--accent)}`. Standard-Layout bleibt grün.
- [x] **Graph erschien fälschlich im „Gliederung"-Tab** (sollte nur im „Split"). Ursache: Studio-Regel
  `.app[data-layout="softdark"] .graph-wrap{display:flex}` (≙ Spezifität wie `.right-panel[data-rmode="outline"]
  .graph-wrap{display:none}`, aber später im Quelltext → gewann). Fix: spezifischere Override
  `.app[data-layout="softdark"] .right-panel[data-rmode="outline"] .graph-wrap{display:none}`. Split unberührt.

### Teil B – 3 wählbare Studio-Farbvarianten (⚙ → „Studio-Variante", nur im Studio-Layout)
- [x] **„Standard"** = aktuelles warmes Dark (Palette unverändert auf `:root[data-layout="softdark"]`).
- [x] **„Dunkler"** = alle Flächen gleichmäßig dunkler (`[data-studio="dark"]`: bg #161514, panel #211f1e,
  panel2 #282624, border #312f2d; Text/Akzent wie Standard).
- [x] **„Hell"** = helles Theme (`[data-studio="cream"]`: bg #e6dccb = Rand, **panel #faf6ee = Notizfeld,
  heller als der Rand**, dunkler Text #3c352a, tieferer Default-Akzent #c8893a, dunkler scrim). Hartkodierte
  weiße Texte (Notiz-Titel-Gradient, `.md-body strong`, `.folder-label`, Outline-Hover) im Creme-Scope auf
  `var(--text)` umgestellt. **Graph-Label-Farbe** folgt jetzt `--text` (Modul-Var `_graphLabelColor` +
  `refreshGraphColors()`, vorher hart `rgba(219,226,238,.92)`) → auf Creme lesbar.
- [x] **Mechanik:** `data-studio` auf html/body/.app via `applyStudioVariant()`; in `applyLayout()` bei Studio
  gesetzt (`currentStudioVariant()`), bei Standard entfernt (`clearStudioVariant()`); Persistenz
  `localStorage['nexus.studioVariant']`. Selector in `renderSettings()` (3 Swatch-Buttons).
- [x] **Nachjustierung (Paul):** Variante in „Hell" umbenannt (vorher „Creme (hell)"); Panel-Schatten **nur in
  „Hell"** abgeschwächt (`0 6px 18px rgba(60,53,42,.18)` statt des harten dunklen Schattens), Dunkel-Varianten
  unverändert.

### Verifikation
- [x] `npm run verify:html` → **OK** (2845 Zeilen, Inline-Script `node --check` grün).
- [x] Creme-Kontrast rechnerisch ok: panel #faf6ee (≈250,246,238) heller als bg #e6dccb (≈230,220,203).
- [ ] **Live-Augenschein offen (Paul):** im laufenden Electron prüfen.

### TODO Paul
- [ ] Nexus neu laden, **Studio**: (1) „● MCP bereit" unten in Akzentfarbe; (2) „Gliederung"-Tab zeigt nur
  Gliederung, „Split" weiterhin Graph+Gliederung; (3) ⚙ → „Studio-Variante" → Standard / Dunkler / Creme (hell)
  durchschalten – Creme: Notizfeld heller als der Rand.
- [ ] Git-Commit: `git add public/index.html STATUS.md && git commit -m "Session 28: Studio – MCP-bereit in Akzentfarbe, Graph nur im Split (nicht Gliederung), 3 wählbare Farbvarianten (Standard/Dunkler/Creme)"`

---

## Stand: 2026-06-15 (Session 27c – Studio: Farb-Regression behoben + Subfolder-Auto-Scroll)

Paul-Report (Screenshot + Mockup `design-mockups/variante-b-soft-dark.html` als Farb-Referenz): 27b-Titelleisten-Fix
machte es **schlimmer** (Titelleiste fälschlich `--panel`/#2a2928), und die eigentliche „weiße Linie" war eine
**vertikale** Linie an der Notizfenster-Rundung. Live im Browser-Preview (`getComputedStyle`) diagnostiziert.

### Erledigt
- [x] **Vertikale weiße Linie an der Rundung = Rail-`border-right`.** Ursache exakt gemessen: `.col.side` trug die
  Basis-Regel `border-right:1px solid var(--border)` (#3a3836) bei x=60 – die abgerundete Karten-Ecke (radius oben-links)
  weicht dort zurück und legt diese gerade Linie frei. Fix: `.app[data-layout="softdark"] .col.side{border-right:none}`.
- [x] **Farben wie im Mockup** („oben + hinter den Icons gleiche Farbe"): Studio-Titelleiste `var(--panel)`→**`var(--bg)`**
  (#1f1e1d). Damit Titelleiste **und** Rail beide #1f1e1d – identisch zum Mockup (`titlebar/rail = --bg`). Karte bleibt
  #2a2928 (wie zuvor). Verifiziert: titlebar bg rgb(31,30,29), rail bg rgb(31,30,29), rail `border-right:0px`.
- [x] **Subfolder-Auto-Scroll im Flyout** (Wunsch „genau so wie das Hochscrollen"): Klappt man im Themen-Flyout einen
  Unterordner auf, wird das **ganze Flyout (`top`) animiert verschoben**, bis der **Mittelpunkt der Unterordner-Reihe
  exakt auf dem Mittelpunkt des Themen-Icons** liegt (Abstand Reihe↔Oberkante bleibt gleich, oberer Rand wandert mit).
  Nur beim Aufklappen, nicht beim Theme-Öffnen (dessen Platzierung bleibt unverändert). Umsetzung: zweiter Click-Listener
  je `.folder-row` (makeFolderEl ruft nur `stopPropagation`, nicht `stopImmediatePropagation` → feuert nach dem
  Aufklappen); `newTop = curTop + (iconCenter − rowCenter)`, animiert via neuem `tween()` (easeOutCubic, 320 ms);
  Icon-Referenz in `_railFlyoutBtn`.
  - *Nachjustierung (Paul-Report „Ausrichtung"):* zuerst auf „knapp unter den Kopf" gescrollt – jetzt exakte
    Mittelpunkt-zu-Mittelpunkt-Ausrichtung wie gewünscht.
  - *Nachjustierung 2 (Paul „solange oben schieben reicht; sonst im Fenster scrollen"):* `newTop` wird bei `<8`
    auf 8 geklemmt und der **Rest per Innen-Scroll** des Flyouts nachgeholt (`scrollRest=8-newTop`, beide gleichzeitig,
    gleicher easeOut). Reicht auch der Scroll-Spielraum nicht (Reihe nahe Inhalts-Unterkante), wird so weit gescrollt
    wie möglich. 3 Fälle live verifiziert (alle exakt bzw. physikalisches Maximum):
    Platz oben → exakt; Top erreicht + Scroll-Spielraum → exakt (rowCenterFinal=133=iconCenter); Top erreicht + Reihe
    unten → bis maxScroll.

- [x] **Trennlinie oben unter dem Vault-Icon** (Paul: „genau diese Trennlinie auch oben"): neues
  `<div class="rail-sep" id="rail-sep-top">` zwischen `.vault-row` und `#side-scroll`; `#rail-sep-top{display:none}`,
  im Studio `display:block;align-self:center` (sonst linksbündig, da `.side` nur `flex-direction:column` ohne
  `align-items:center`). Identisch zur unteren `.rail-sep` (24×1px, `--border`), zentriert, fix (scrollt nicht mit).

### Verifikation (Browser-Preview, getComputedStyle/Geometrie)
- [x] `npm run verify:html` → **OK** (2808 Zeilen, Inline-Script `node --check` grün).
- [x] Trennlinie oben: klassisch `display:none`; Studio `display:block`, `#3a3836`, 24×1px, `sepCenterX==railCenterX` (zentriert),
  unter dem Vault-Icon und über den Theme-Icons.
- [x] Titelleiste/Rail = #1f1e1d, Rail-`border-right`=0 (Linie weg).
- [x] Rail-Auto-Scroll: letztes (15.) Thema öffnen → Flyout-Unterkante 814 ≤ vh 826 (komplett sichtbar).
- [x] Subfolder-Ausrichtung: synthetischer Test (Icon-Mitte=225) → `newTop` so berechnet, dass `rowCenterAfter==225`
  (`aligned:true`), exakte Mittelpunkt-Deckung. **Animation selbst** nur im echten Fenster sichtbar – der Headless-Preview
  ist `visibilityState:hidden`, dort feuert `requestAnimationFrame` nicht (rafFired=false). Logik grün, finaler Augenschein
  steht bei Paul aus. Temp. Preview/launch.json wieder entfernt.

### TODO Paul
- [ ] Nexus neu starten, **Studio**: (1) keine vertikale Linie mehr an der Fenster-Rundung; (2) Titelleiste + Icon-Leiste
  gleiche Farbe wie Mockup (#1f1e1d); (3) Unterordner im Flyout aufklappen → Reihe gleitet sanft auf Höhe des Themen-Icons.
- [ ] Git-Commit: `git add public/index.html STATUS.md && git commit -m "Session 27c: Studio – vertikale Rundungs-Linie (Rail border-right) weg, Titelleiste/Rail = --bg wie Mockup, Subfolder-Auto-Scroll im Flyout"`

---

## Stand: 2026-06-14 (Session 27b – Studio: Feinschliff Notizfenster-Top + Flyout-Auto-Scroll)

Paul-Report („fast perfekt") mit Screenshot, 6 Punkte – alle in `public/index.html` (Studio-Scope + Flyout-JS):

### Erledigt
- [x] **Weiße Linie oben am Notizfenster weg.** Ursache (per Browser-Preview/`getComputedStyle` verifiziert): Karte
  `.col:nth-child(3)` = `--panel` (#2a2928, heller) lag bündig unter der dunkleren Titelleiste (`rgba(31,30,29,.6)`
  über `--bg` #1f1e1d) → die hellere Kartenoberkante las sich als helle Linie. Fix: **Studio-Titelleiste
  `background:var(--panel)`** → eine durchgehende Oberfläche, kein Kontrast-Naht mehr.
- [x] **Tab-Schatten auch unten sichtbar.** `.tabbar` (Studio) `padding-bottom 0→16px` (Schatten liegt jetzt
  innerhalb der Scrollport-Padding-Box statt am Clip-Rand) + aktiver Tab-Schatten kräftiger
  (`0 2px 10px /.25 → 0 3px 12px /.35`). Horizontales Tab-Scrollen bleibt (kein `overflow`-Override).
- [x] **Notizinhalt bis ganz oben.** `.note-content` (Studio) `padding-top:30px→12px` → Text rückt nach oben,
  keine „unsichtbare Abschneidung" mehr; zusammen mit der durchgehenden Titelleiste läuft die Fläche bis oben.
- [x] **Karte nur oben-links gerundet** (wie Mockup): `border-radius:16px 16px 0 0 → 16px 0 0 0`.
- [x] **Flyout erscheint wieder neben jedem Icon** (vorher ab ~8. Icon „abgedockt"): alte Hart-Klammer
  (`innerHeight-min(0.7*ih,440)`) entfernt; Flyout sitzt jetzt direkt neben dem Icon (`top=r.top`), bei Bedarf siehe
  nächster Punkt.
- [x] **Icon-Leiste scrollt automatisch & animiert nach oben,** wenn das Flyout sonst unten abgeschnitten würde:
  in `openRailFlyout()` Flyout-Höhe messen → nötiges `delta` berechnen → `#side-scroll` per **`smoothScrollTop()`**
  (rAF, easeOutCubic, 360 ms, „flüssig, nicht zu schnell") nach oben scrollen, **begrenzt auf `scrollHeight-clientHeight`**
  (letztes Thema kann nicht weiter hoch). Reicht das Scrollen nicht, wird das Flyout am unteren Rand verankert
  (`min(finalTop, vh-12-foH)`), sonst greift sein `max-height:70vh` + interner Scroll.

### Verifikation
- [x] `npm run verify:html` → **OK** (2774 Zeilen, Inline-Script `node --check` grün).
- [x] Weiße-Linie-Ursache live im Browser-Preview gemessen (Karte rgb(42,41,40) heller als Titelleiste/BG);
  Studio-Palette greift nur nach `applyLayout('softdark')` (Inline-Theme-Vars sonst Override – bekanntes Muster aus 26e).
  Temp. `static-public`-launch.json + Preview-Server wieder entfernt.

### TODO Paul
- [ ] Nexus neu laden, **Studio**: (1) keine helle Linie mehr oben am Notizfenster; (2) Tab-Schatten rundum inkl. unten;
  (3) Notiztext beginnt direkt oben; (4) Fenster nur oben-links gerundet; (5) Themen-Flyout erscheint neben jedem Icon;
  (6) tief sitzendes Thema aufklappen → Icon-Leiste gleitet sanft nach oben, ganzes Flyout sichtbar (letztes Thema bleibt).
- [ ] Git-Commit: `git add public/index.html STATUS.md && git commit -m "Session 27b: Studio – weiße Top-Linie/Titelleiste, Tab-Schatten unten, Notiztext bis oben, nur oben-links gerundet, Flyout neben Icon + animierter Rail-Auto-Scroll"`

---

## Stand: 2026-06-14 (Session 27 – Studio: rechtes Graph-Panel als schwebendes Fenster)

Paul-Wunsch (mit Mockup): Im **Studio-Layout** soll das rechte Fenster (Graph/Gliederung) wie im Mockup
aussehen, aber über die **gesamte Höhe** des Feldes – mit **kleinem Abstand am Rand** (schwebendes Fenster
„das darüber liegt"), **leichtem Schatten + abgerundeten Ecken**. Inhalt unverändert. Die **Resize-Linie**
zum seitlichen Vergrößern soll **genau an der Kante des Fensters** sitzen. Reine CSS-Änderung in
`public/index.html`, nur im `.app[data-layout="softdark"]`-Scope.

### Erledigt
- [x] **`.right-panel` (Studio) = schwebende Karte:** `margin:10px 10px 10px 0` (oben/rechts/unten Abstand,
  links 0 → Lücke kommt vom Resizer), `border:1px solid var(--border)`, `border-radius:14px` (alle Ecken),
  `box-shadow:0 10px 34px rgba(0,0,0,.45)`, `overflow:hidden`. Ersetzt das bisherige bündige Panel
  (nur `border-top` + nur Ecke oben-rechts). Volle Feldhöhe minus 10px oben/unten.
- [x] **Resize-Linie genau an der Fensterkante:** Studio-Grid-Track `#rz-r` von `5px`→`12px` (greifbarer
  Bereich = linker „Schwebe-Abstand"); `#rz-r` transparent (kein Panel-BG/`border-top` mehr); `#rz-r::after`
  auf `inset:10px 0 10px auto; right:0; width:3px` → die (auf Hover/Drag amberne) Linie steht bündig an der
  linken Kante des Fensters und ist genau so hoch wie das Fenster (10px oben/unten wie der Karten-Abstand).
- [x] Inhalt (Graph/Gliederung/Split, Toggle, Canvas) **unverändert**.

### Nachbesserung (Paul-Report mit Screenshot)
- [x] **Keine optische Abgrenzung mehr** zwischen Notizfläche und dem Bereich unter dem Panel:
  `.app[data-layout="softdark"] .main{background:var(--panel)}` → die ganze Inhaltsfläche rechts der Icon-Leiste
  ist eine durchgehende `--panel`-Oberfläche. Die Notizseite „läuft optisch durch", das rechte Panel liegt als
  **schwebende Karte** (jetzt **border:none**, nur Schatten `0 8px 30px rgba(0,0,0,.55)` + radius) darüber.
  Der Resizer-Streifen zeigt jetzt ebenfalls `--panel` (kein dunkler Spalt mehr).
- [x] **Graph-Buttons nicht mehr blau:** `.gbtn`-Hartblau `rgba(15,19,32,.85)` → `var(--pop)` (global, theme-aware);
  im Studio zusätzlich `var(--field)`. Folgen damit dem Akzent/Theme statt Blau.
- [x] **Graph-Header abgegrenzt + Buttons in einer Reihe:** Controls (Label / Notiz-Graph-Badge / Haupt / Index /
  ⚙) in neuen `<div class="graph-head">` gewrappt. Default `display:contents` → **klassisches Layout unverändert**
  (Buttons bleiben absolut positioniert). Im Studio: `.graph-head` = Flex-Reihe mit `border-bottom`, `.graph-wrap`
  = Flex-Spalte, `#graph-canvas{flex:1;height:auto}` → der **Graph beginnt erst unter der Header-Leiste** und kann
  nicht mehr bis zu den Buttons reichen. Settings/Filter-Popover `top:46px` (unter den Header gerückt).

### Nachbesserung 2 (Rail-Flyout im Mockup-Stil)
- [x] **Sidebar-Flyout (Icon-Leiste → Ordner) jetzt wie das Mockup:** statt grauer Farb-Punkte (Ordner wurden
  im Flyout auf `depth=1` gerendert → `.dot`) werden die Ordner jetzt auf `depth=0` gerendert → **Ordner-Emoji
  (`folderIcon`, Default 📁) + weißes Label + Count rechts** wie in `variante-b-soft-dark.html`.
- [x] **Flyout-Reihen-CSS** (`#rail-flyout .folder-row/.tree-file`): runde Hover-Flächen (`--panel2`),
  aktive/offene Reihe = `--amber-soft`, Per-Ordner-Farbverlauf im Flyout neutralisiert (`folder-gradient`→`none`),
  Padding/Gap/Radius an Mockup angeglichen; Container `padding:10px 8px`, `width:252px`. D&D, Kontextmenü und
  Öffnen bleiben erhalten (weiterhin `makeFolderEl/makeFileEl`).

### Nachbesserung 3 (Trennlinien weg + Icon-Reihenfolge per D&D)
- [x] **Trennlinie unter der Titelleiste entfernt** (wie Mockup): `.app[data-layout="softdark"] .titlebar`
  → `border-bottom:none`. Titelleiste/Breadcrumb läuft jetzt nahtlos in die Fläche.
- [x] **Icon-Reihenfolge (Themen) per Drag & Drop sortierbar** in der Studio-Icon-Leiste:
  - `orderedTopFolders()` liest gespeicherte Reihenfolge (`localStorage['nexus.railOrder']`, Array der Pfade),
    unbekannte/neue Ordner werden in Baum-Reihenfolge angehängt; `persistRailOrder()` speichert nach dem Ziehen.
  - `renderRail()`: jeder Ordner-Button `draggable`; Live-Umsortierung beim `dragover` über `railAfterEl()`
    (Einfügeposition nach Cursor-Y) + **FLIP-Animation** (`railFlip()`, `transform`-Transition 160 ms,
    cubic-bezier) → die Icons gleiten beim Sortieren weich an ihre neue Position.
  - Optik: gezogenes Icon `opacity:.4; scale(.82)` + Schatten (`.rail-dragging`), `cursor:grab/grabbing`,
    Tooltip-Hinweis „(zum Sortieren ziehen)". Klick=Flyout, Rechtsklick=Kontextmenü bleiben erhalten.

### Nachbesserung 4 (Notiz-Fenster, Dateien in der Leiste, fixer +-Button, Vault-Icon)
- [x] **Mittlere Notizfläche = schwebendes Fenster:** `.col:nth-child(3)` im Studio jetzt `border:none`,
  `border-radius:16px`, `margin:10px 0 10px 10px`, `box-shadow:0 8px 30px rgba(0,0,0,.5)` → rundum saubere
  Rundung + Schatten, schwebt wie das Graph-Panel auf der `--panel`-Fläche (12px-Resizer-Lücke dazwischen).
- [x] **Dateien in der Icon-Leiste** (nicht nur Ordner): `orderedTopItems()` + `renderRail()` rendern jetzt auch
  Top-Level-**Dateien** (z. B. `START.md`) als Rail-Button (`railFileIcon()`: 📝/📄/🌐/🖼/📘/📊), Klick = öffnen,
  Rechtsklick = Kontextmenü, per D&D mitsortierbar.
- [x] **„+ Notiz" fest angepinnt** (wie Einstellungen): neuer `#rail-bottom`-Container zwischen Scroll-Liste und
  Einstellungen (`flex:0 0 auto`) → scrollt nicht mehr weg. **Dezente Abgrenzung** über kurzen, zentrierten
  `.rail-sep` (24px, kein durchgehender Strich) statt voller Linie.
- [x] **Vault-Auswahl-Icon** 🗂 → **📚** (passender für „Wissensspeicher/Vault").

### Nachbesserung 5 (Overlay-Modell wie Mockup: Panel ÜBER dem Notizfenster, kein Kasten dahinter)
- [x] **Kasten hinter den Fenstern entfernt:** `.main` nicht mehr `--panel`, jetzt `background:transparent`
  (App-BG `--bg` scheint durch). Studio-Grid auf `var(--rail-w) 0 1fr` reduziert + `.main{position:relative}`.
- [x] **Notizfenster = volle Basis-Fläche:** mittlere Spalte spannt jetzt die ganze Breite (Schiene→rechter Rand),
  `border-radius:16px 16px 0 0` (**oben gerundet, unten bündig**), kein Rand/Schatten. Inhalt bleibt links neben
  dem Panel: `padding-right:calc(var(--col-r) + 22px)` (Text zentriert sich im sichtbaren Bereich).
- [x] **Rechtes Panel liegt ÜBER dem Notizfenster (wie Mockup-Overlay):** `.right-panel` jetzt `position:absolute`
  (`top/right/bottom:10px`, `width:var(--col-r)`, `z-index:20`, Schatten `0 10px 36px`) → schwebt als Fenster auf
  der durchlaufenden Notizfläche, keine optische Abgrenzung dahinter.
- [x] **Resizer** `#rz-r` absolut an der linken Panel-Kante (`right:calc(var(--col-r)+10px)`), Linie bündig an der
  Kante (Hover=amber); Resize-Logik (`--col-r`) unverändert, Notiz-`padding` folgt automatisch.

### Verifikation
- [x] `npm run verify:html` → **OK** (2749 Zeilen, Ende `</html>`, Inline-Script `node --check` grün).

### TODO Paul
- [ ] Studio: kein Kasten mehr hinter den Fenstern; Notizfenster oben gerundet/unten bündig; Graph-Panel schwebt
  rechts darüber (Resize an der Kante). Wie im Mockup.
- [ ] Studio: `START.md` & andere Top-Level-Dateien sind als
  Icon in der Leiste sichtbar/öffenbar; „+ Notiz" bleibt unten fest (über Einstellungen) mit kurzem Trenner; Vault-Icon = 📚.
- [ ] Studio-Layout: Icons in der Leiste ziehen → Reihenfolge ändert sich animiert + bleibt nach Reload erhalten.
- [ ] Studio-Layout: Icon-Leiste → Ordner anklicken → Flyout sieht aus wie das Mockup (Ordner-Emoji, saubere Reihen).
- [ ] Nexus neu laden / `npm run app`, **Studio**-Layout: (1) rechtes Fenster schwebt mit Abstand+Schatten+runden
  Ecken über volle Höhe; Resize-Linie an der linken Fensterkante (Hover = amber). (2) Keine dunkle Trennlinie/Spalt
  mehr zwischen Notiz und Panel-Bereich – Fläche läuft durch. (3) Graph-Buttons warm statt blau, in einer Reihe,
  Graph beginnt erst unter der Header-Leiste.
- [ ] Git-Commit: `git add public/index.html STATUS.md && git commit -m "Session 27: Studio – rechtes Graph-Panel als schwebendes Fenster (Margin/Schatten/Radius), Resize-Linie an Fensterkante"`

---

## Stand: 2026-06-14 (Session 26e – Pro-Layout-Farbmodell: Standard↔Studio mit getrennter Farbe, Umbenennung)

Paul präzisierte das Zielmodell + es gab einen **echten Logikfehler** (nicht nur Cache): Im Studio-Layout blieben
Slider/Akzent blau, wenn als Theme „Darker" gewählt war. Ursache: `applyTheme()` setzt `--accent` **inline** auf
`:root`; **Inline schlägt die Layout-CSS-Regel** `:root[data-layout=softdark]`. Deshalb wurde es nur warm, wenn man
vorher das Theme auf Gelb stellte; der Akzent-Picker scheiterte am selben Inline-Override.

### Zielmodell (vom User, umgesetzt)
- **Zwei Layouts, jedes mit eigener, getrennt gemerkter Farbe** – kein „Gelb-Bleed" mehr.
- **Standard**: Auswahl unter den 6 Farben; **Default = Tiefsee (blau)**.
- **Studio** (neuer Name, Kontrast zu Standard): bringt automatisch warme Palette mit + **Akzentfarben-Picker**.
- Zurück auf Standard → vorherige Standard-Farbe kommt zurück (nicht die Studio-Farbe).

### Erledigt
- [x] **`applyLayout()` ist jetzt die Single-Source der Farbe pro Layout:** Studio → `THEME_VARS` inline **entfernen**
  (damit die `:root[data-layout]`-Palette + `--sd-accent` greifen) + `applySdAccent(currentSdAccent())`; Standard →
  `--sd-accent` entfernen + `applyTheme(currentTheme())`. Behebt „blau trotz Studio" **und** den toten Akzent-Picker.
- [x] **`currentTheme()` Default `dark`→`darker`** (Standard startet auf Tiefsee/blau).
- [x] **`setTheme()`** wendet nur im Standard-Layout sofort an (speichert immer) – kein versehentliches Inline-Override im Studio.
- [x] **init()** vereinfacht: nur noch `applyLayout(currentLayout())` setzt Theme/Akzent (keine doppelten Aufrufe).
- [x] **Umbenennung:** Layout „Soft Dark (Variante B)"→**„Studio"**; Sektion „Design & Optik"→**„Farbe"**;
  6 Themes→**Nacht / Tiefsee / Himmel / Bernstein / Kupfer / Wald**; Picker-Label „(Soft Dark)"→„(Studio)".

### Live-Verifikation (Browser-Preview, getComputedStyle) – ALLES grün
- [x] Default-Theme=`darker`; Standard-Akzent blau `#7C8CFF`; Studio-Akzent amber `#e8a94a`, BG `#1f1e1d`.
- [x] Studio-Akzent auf Grün → Markierung grün; **zurück auf Standard → wieder blau** (kein Bleed).
- [x] Labels korrekt. `verify:html` OK (2663) + `md-render` 25/25. Preview/launch.json wieder entfernt.

### TODO Paul (NEUSTART nötig wegen no-store aus 26d + neuem JS)
- [ ] Nexus **komplett neu starten**. Dann: Standard zeigt die 6 Farben (Default Tiefsee/blau); Studio ist sofort
  warm + Akzent-Picker wirkt; Hin-/Herschalten behält je Layout die Farbe. Bei Bedarf einmal Strg+Shift+R.
- [ ] Git-Commit: `git add public/index.html src/ui-server.js STATUS.md && git commit -m "Session 26e: Pro-Layout-Farbmodell (Standard↔Studio getrennt), Theme-Inline-Override im Studio behoben, Umbenennung Nacht/Tiefsee/Himmel/Bernstein/Kupfer/Wald + Studio"`

---

## Stand: 2026-06-14 (Session 26d – Eigentliche Wurzel: Electron cachte alte HTML → UI-Server jetzt no-store)

Paul: nach 26c „geht gar nicht mehr", Akzentfarbe wirkungslos, **Slider sogar blau**; warm wird es nur, wenn er
**erst das Theme „Soft Dark" (Design & Optik) und dann das Layout** wählt. Diagnose daraus eindeutig:
- Das **Theme** „Soft Dark" funktioniert (setzt `--accent` **inline** auf `:root` → color-mix-Vars lösen korrekt auf).
- Das **Layout** allein (`:root[data-layout]`-CSS-Regel) griff bei ihm nicht, obwohl die Datei auf der Platte korrekt
  ist und im Browser-Preview nachweislich funktioniert. ⇒ **Electron lädt eine veraltete, gecachte `index.html`**
  (die 26c-Zwischenversion mit dem kaputten `*/`-Kommentar, in der die Layout-Regel tot war). Soft-Reload (Strg+R)
  reichte nicht.

### Erledigt
- [x] **UI-Server liefert `index.html` mit `Cache-Control: no-store` + `etag:false`/`lastModified:false`**
  (`src/ui-server.js`, `express.static`-Optionen). Damit kann Electron nach UI-Änderungen nie wieder eine veraltete
  Version anzeigen. **Greift erst nach komplettem App-Neustart** (Server läuft im Electron-Prozess), danach lädt die
  korrigierte (im Preview verifizierte) HTML frisch.
- [x] `node --check src/ui-server.js` OK, `verify:html` OK (2646).

### TODO Paul (wichtig: NEUSTART, nicht nur Reload)
- [ ] Nexus **komplett schließen und neu starten** (nicht nur Strg+R) bzw. `npm run app`. Dann **Soft Dark als
  Layout** wählen → Suche/Einstellungen/Neue Notiz/Hashtags/Slider/Markierungen warm; Akzentfarbe wirkt sofort.
  Das „erst Theme, dann Layout"-Workaround ist dann nicht mehr nötig.
- [ ] Falls wider Erwarten noch alt: einmalig Strg+Shift+R (harter Reload, ignoriert Cache).
- [ ] Git-Commit: `git add public/index.html src/ui-server.js STATUS.md && git commit -m "Session 26d: UI-Server no-store für index.html (behebt Electron-Stale-Cache hinter den Soft-Dark-Popup-Bugs)"`

---

## Stand: 2026-06-14 (Session 26c – Soft-Dark-Popups: zwei verkettete Bugs, jetzt LIVE verifiziert)

Paul-Report nach 26b: Popups (Suche/Einstellungen/Neue Notiz) + **Hashtags weiterhin blau** im Soft Dark.
Diesmal **live im Browser-Preview reproduziert + gefixt** (statischer `npx serve public`, `getComputedStyle`-Messungen).

**Zwei verkettete Ursachen gefunden:**
1. **color-mix löst `var(--accent)` am Definitions-Element auf.** Die abgeleiteten `--accent-*`/`--pop`-Variablen
   stehen im `:root{}`-Block → ihr `var(--accent)` wird auf `:root` (=html) ausgewertet, wo `--accent` blau ist.
   26b setzte die Soft-Dark-Palette aber auf **`body`**. Ergebnis: Element *erbt* zwar Amber (`--accent` am Element
   = amber), aber `--accent-12` war bereits auf html zu **blau** aufgelöst und vererbte sich blau. → Fix: Palette auf
   **`:root[data-layout="softdark"]`** + `applyLayout()` setzt `data-layout` zusätzlich auf `document.documentElement`.
2. **Selbst verursachter CSS-Kommentar-Bug.** Mein Erklär-Kommentar enthielt die Zeichenfolge `--accent-*/--pop` –
   das `*/` **beendet den CSS-Kommentar vorzeitig**, der Rest wurde als kaputtes CSS geparst und zerstörte die direkt
   folgende `:root[data-layout="softdark"]`-Regel (sie „existierte", aber keine Deklaration griff). Kommentar ohne
   `*/`-Sequenz neu formuliert. **Lehre:** in CSS-Kommentaren nie `*/` im Fließtext (auch nicht in `--var-*/...`).

### Live-Verifikation (Browser-Preview, getComputedStyle)
- [x] Soft Dark: `--accent`=`#e8a94a`, `--bg`=`#1f1e1d`, Popup-Markierung **amber** (vorher blau), Hashtag-Farbe+BG
  **amber**, Popup-BG warm, Body-BG warm (kein blauer Radial mehr).
- [x] Akzent-Picker: `setSdAccent('#33aa55')` → Markierung+Hashtag **grün**; Reset → zurück amber.
- [x] Klassisch/Standard-Theme bleibt korrekt blau (Theme-Design).
- [x] `npm run verify:html` OK (2646 Zeilen) + `md-render` 25/25. Preview-Server + temp. `launch.json` wieder entfernt.

### Hinweis für Paul (wichtig zum Verständnis)
- Die Popups folgen dem **Akzent des aktiven Themes/Layouts**. Im **Standard-Theme ist der Akzent blau** → Popups
  bleiben dort blau (so gewollt). Für warme Popups: **Soft Dark** wählen (Layout in ⚙, oder Theme „Soft Dark" unter
  Design & Optik) – dann sind Markierungen/Hashtags/Suche/Settings warm, und der Akzent-Picker färbt alles um.

### TODO Paul
- [ ] App neu laden, **Soft Dark** aktivieren → Suche/Einstellungen/Neue Notiz/Hashtags sind warm statt blau; Akzent-
  farbe testen. (Falls weiterhin blau: harter Reload `Strg+Shift+R`, da Electron CSS cachen kann.)
- [ ] Git-Commit: `git add public/index.html STATUS.md && git commit -m "Session 26c: Soft-Dark Popups/Hashtags – :root[data-layout] statt body + CSS-Kommentar-Bug (*/) behoben, live verifiziert"`

---

## Stand: 2026-06-14 (Session 26b – Soft-Dark-Layout: echte Popup-Ursache + 5 Layout-Features)

Folge-Report Paul: „**alle** Popups (Einstellungen, neue Notiz, Suche) sind im **Soft-Dark-Layout** noch blau"
+ 5 weitere Wünsche. **Echte Ursache der blauen Popups gefunden:** `.app` schließt in `index.html:683`, aber
**alle Overlays** (`#ctx-menu`, Command-Palette/Suche, Prompt/Neue Notiz, Confirm, Picker, Settings, Usage)
liegen **außerhalb** `.app`. Die Soft-Dark-**Layout**-Variablen saßen aber auf `.app[data-layout="softdark"]`
→ erreichten die Overlays nie, die fielen auf das blaue `:root` zurück. (Session 26 hatte nur die *Theme*-
Variablen gekoppelt – im *Layout*-Pfad greift das nicht.)

### Erledigt
- [x] **Popup-Fix (Kern).** Soft-Dark-Palette von `.app[data-layout="softdark"]` auf **`body[data-layout="softdark"]`**
  verschoben; `applyLayout()` setzt `data-layout` jetzt **zusätzlich auf `document.body`**. Overlays sind Kinder
  von `<body>` → erben `--bg/--panel/--accent/--pop/…` jetzt korrekt. Damit ziehen Settings, Neue-Notiz-Dialog,
  Suche, Rechtsklick-Menü, Usage etc. im Soft-Dark mit.
- [x] **Akzentfarbe (Soft Dark) einstellbar.** Neue Settings-Sektion (nur Soft-Dark): `<input type=color>` →
  `setSdAccent()` setzt `--sd-accent` auf `:root`; Palette liest `--accent:var(--sd-accent,#e8a94a)`. Alle
  bisher gelben Töne (`--amber-soft`, np2-tag-Border, Such-Glow) auf **`color-mix(... var(--accent) …)`** umgestellt
  → „alles Gelbe" wird zur neuen Akzentfarbe. „↺" setzt auf Amber zurück. Persistenz `localStorage['nexus.sdAccent']`.
- [x] **Icon-Leiste Breite einstellbar.** CSS-Var `--rail-w` (Default 60px) steuert Grid-Spalte; Rail-Buttons +
  Vault-Button + Icons über `calc(var(--rail-w) …)` → **skalieren mit, bleiben quadratisch**. Slider 48–96px
  (nur Soft-Dark), `applyRailW()`, Persistenz `localStorage['nexus.railW']`; danach `refitGraph()`.
- [x] **Gliederungs-Off-by-one behoben.** Klick scrollte rect-basiert, Scroll-Spy markierte aber via `offsetTop`
  (anderes Koordinatensystem) → die Überschrift *darüber* wurde aktiv. Beide nutzen jetzt
  `getBoundingClientRect` + gemeinsamen `_olOffset()` (Oberkante note-area + ggf. sticky Toolbar) + 2px Toleranz.
- [x] **Rechtes Panel = bündige eigene Fläche (Soft Dark).** Kein dunkleres Feld / keine Rahmenlinie mehr:
  `.right-panel` ohne `margin/border/box-shadow`, `background:var(--panel)`, nur `border-top` + `border-radius:0 18px 0 0`
  (Fenster-Optik wie Center-Karte); `#rz-r` blendet ein (`background:var(--panel)`, Hover-Akzent) → weiterhin
  nur **vergrößerbar, nicht verschiebbar**, ohne sichtbaren dunklen Spalt.
- [x] **Graph-Glow einstellbar bis aus.** Modul-Var `_graphGlow` (0..1) multipliziert `shadowBlur`; Slider 0–100 %
  (0 = aus, beide Layouts), `setGraphGlow()`+`wakeGraph()`, Persistenz `localStorage['nexus.graphGlow']`.

### Verifikation (Session 26b)
- [x] `npm run verify:html` → **OK** (2644 Zeilen, Ende `</html>`, Inline-Script `node --check` grün).
- [x] `node test/md-render.test.mjs` → **25/25**.
- [ ] **Live-Test offen (Paul):** Build-Checks + Logik geprüft, aber **nicht** im laufenden Electron gerendert.

### TODO Paul
- [ ] App neu laden / `npm run app`, **Soft Dark** wählen und prüfen: (1) Popups (⚙, Neue Notiz, Suche, Rechtsklick,
  Usage) sind warm statt blau. (2) ⚙ → Akzentfarbe ändern → alles Gelbe wechselt. (3) ⚙ → Icon-Leiste-Breite-Slider →
  Rail wird breiter, Icons größer & quadratisch. (4) Gliederungspunkt klicken → genau dieser Abschnitt wird markiert.
  (5) Rechtes Panel: kein dunkler Rand/Rahmen, nur per Trennlinie vergrößerbar. (6) ⚙ → Graph-Glow bis „aus".
- [ ] Git-Commit: `git add public/index.html STATUS.md && git commit -m "Session 26b: Soft-Dark Popups (body-Vars) + Akzentfarbe/Rail-Breite/Graph-Glow-Settings, Gliederungs-Off-by-one, rechtes Panel bündig"`

---

## Stand: 2026-06-14 (Session 26 – Alle Popups/Overlays an das aktive Farb-Theme gekoppelt)

Paul-Report: Statusleiste unten, Markierung eines Gliederungsabschnitts, HTML/Dataview-Vorschau, Scrollbar,
Datei-Markierung beim Anklicken, Claude-Usage-Fenster, Einstellungen, Neue-Notiz-Dialog, Rechtsklick-Menü –
**„generell jedes Popup-Fenster ist noch blau"** und sollte sich automatisch dem aktuellen Farbschema anpassen.
Ursache: Zahlreiche UI-Elemente nutzten **hartkodierte Blautöne** statt der Theme-CSS-Variablen, die seit
Session 21/24 nur `--bg/--panel/--accent/…` umschalten. Reine Front-End-Änderung in `public/index.html`
(direkte `Edit`-Patches, Windows-nativ – kein Mount/Stale-Problem).

### Lösung (ein zentraler Mechanismus statt Einzelfarben)
- [x] **Abgeleitete Theme-Variablen in `:root`** via `color-mix()` – leiten sich aus `--accent`/`--bg`/`--dim` ab
  und folgen damit **automatisch jedem Theme (auch künftigen), ohne pro Theme gepflegt zu werden:**
  - Akzent-Tints `--accent-04/08/10/12/14/20/30` (ersetzen alle `rgba(124,140,255,.XX)`), `--accent-soft`,
    `--accent-tx` (helle Tag-/Chip-Schrift, ersetzt `#9fb0ff`).
  - Oberflächen `--pop` (Popover/Menü/Palette-BG), `--bar` (Titel-/Datei-/Statusleiste, translucent),
    `--scrim` (Overlay-Backdrop), `--field` (Eingaben/Selects/Buttons).
  - Scrollbar `--sb-track/--sb-thumb/--sb-thumb-h`.
- [x] **Alle hartkodierten Blautöne ersetzt:**
  - `.palette` (Command-Palette **+ Settings-Modal + Neue-Notiz-Prompt + Confirm + Folder-Picker**, teilen sich
    die Klasse) `rgba(13,17,30,.95)`/`rgba(124,140,255,.35)` → `var(--pop)`/`var(--accent-30)`.
  - `.statusbar`, `.titlebar`, `.file-toolbar`, `#note-pane2 .np2-head` `rgba(10,13,22,.6/.7/.75)` → `var(--bar)`.
  - `#ctx-menu` (Rechtsklick), `#color-pop`, `#icon-pop`, `.graph-tip`, `#toast`, `.graph-settings`,
    `.graph-filter`, `#usage-popover`, `#vault-sel-drop` `#0f1320`/`#151b2c`/`rgba(11,14,24,.96/.97)` → `var(--pop)`.
  - `#outline-panel .ol-row.active` (Gliederungs-Markierung), `.tree-file.selected` (Datei-Markierung),
    Drop-Targets, Tags/Chips, Blockquote, `.folder-row.active`-Gradient, CodeMirror-Selektion → `--accent-*`.
  - `.set-select`/`#vault-sel-btn` (`#0d1017`/`#2a2f42`) → `var(--field)`/`var(--border)`; Scrollbar
    (`#1a1d2a`/`#3a3f55`/`#5a6080`) → `--sb-*`.
  - `.overlay`-Backdrop `rgba(4,6,12,.55)` → `var(--scrim)`.
- [x] **HTML-Vorschau-iframe** (`renderHtmlView`, „Dataview/Web"-Fenster): iframes erben **keine** CSS-Variablen –
  daher liest die Funktion jetzt zur Laufzeit `getComputedStyle` von `--bg`/`--text`/`--dim` und injiziert die
  konkreten Farben in das `srcdoc`-`<style>` (BG, Text, Scrollbar) statt der bisherigen blauen Festwerte.
- Bewusst **unverändert** (Theme-Identität, kein Bug): `--app-bg`-Gradient des Standard-Themes (`#0e1430`),
  `COLORS`-Ordnerpalette, `NEXUS_THEMES`-Definitionen inkl. „Soft Blue", Graph-Canvas-Knotenfarben.

### Verifikation (Session 26)
- [x] `npm run verify:html` → **OK** (2616 Zeilen, Ende `</html>`, Inline-Script `node --check` grün).
- [x] `node test/md-render.test.mjs` → **25/25**.
- [x] Grep: keine hartkodierten Blau-Token mehr außer den o.g. absichtlichen (Theme-Defs/Palette/iframe-Fallbacks).

### TODO Paul
- [ ] App neu laden (Strg+R) / `npm run app`: ein **anderes Theme** wählen (⚙ → Design & Optik, z.B. Soft Dark /
  Focus Reader) und prüfen, dass **alle** Popups mitziehen: Statusleiste, Rechtsklick-Menü, Einstellungen,
  Neue-Notiz-Dialog, Usage-Fenster, Gliederungs- & Datei-Markierung, Scrollbar, HTML-Vorschau.
- [ ] Git-Commit: `git add public/index.html STATUS.md && git commit -m "Session 26: Alle Popups/Overlays an aktives Farb-Theme gekoppelt (color-mix-Variablen statt hartkodierter Blautöne)"`

---

## Stand: 2026-06-13 (Session 25 – Echte Layout-Umschaltung: Variante B als alternatives Layout)

> **Fix (nach Paul-Report „mittlerer Bereich amber, kein Text, rechts kein Graph"):** Ursache war
> `.app[data-layout="softdark"] #rz-l{display:none}` – ein `display:none`-Grid-Item wird komplett aus
> dem Grid entfernt, dadurch verschoben sich die 4 verbliebenen Items um eine Spalte: Center landete im
> 0px-Track (1px breit), `#rz-r` erbte den 1fr-Track (der amberne „Rand" = Resizer im Hover) und das rechte
> Panel kollabierte auf 5px (daher kein Graph/Gliederung). **Lösung:** `#rz-l{pointer-events:none}` statt
> `display:none` – das Item bleibt im Grid (0px-Track), Mapping wieder 1:1. Headless verifiziert: Tracks
> `60 0 975 5 360`, Notiz rendert, Graph 360px. **Lehre:** Grid-Items nie per `display:none` ausblenden,
> wenn die Spaltenanzahl fix ist – `visibility/pointer-events` nutzen.
>
> **Fix 2 (Rail überdeckt Statusleiste + blaue Reste + rechtes Panel):** (a) Rail lief unten über die
> Statusleiste, weil `.side` (Grid-Item, `min-height:auto`) auf Inhaltshöhe wuchs und `overflow:visible`
> (nötig, damit das Vault-Dropdown seitlich aus den 60px austritt) nichts klippte. Lösung: `.side{min-height:0}`
> → schrumpft auf die Grid-Zelle, dadurch greift `#side-scroll{min-height:0;overflow-y:auto;overflow-x:hidden}`
> und die Icons scrollen intern. Rail-Tooltips von CSS-`.tip` auf **natives `title`** umgestellt (Scroll-Container
> würde ein CSS-Tooltip abschneiden). (b) **Rechtes Panel** als warme Floating-Card: `background:var(--panel)`,
> `margin:10px 12px 12px 6px`, `border-radius:16px`, Box-Shadow; `#right-toggle/.graph-wrap/.activity` transparent.
> (c) **Blaue Reste warm umgefärbt:** Scrollbar (`::-webkit-scrollbar-thumb`→`var(--border)`/`--dim`),
> Split-2.-Pane `#note-pane2` + `.np2-head/.np2-tag` (war `rgba(7,9,15)`/blau → `var(--panel)`/`--panel2`/`--amber-soft`),
> Drop-Targets + `.folder-row.active` + `.tree-file.selected` + `#vault-sel-drop` + Such-Glow → amber.
> Headless verifiziert (1280×720, 14 Themen): kein Statusleisten-Overlap (side-bottom=statusbar-top=694), Rail scrollt,
> Vault-Dropdown tritt aus (right=259), rechtes Panel warm `rgb(42,41,40)`+radius16, Split-Pane warm, 0 Konsolenfehler.

Folgeauftrag zu Session 24: nicht nur Farb-Skins, sondern eine **echte Layout-Umschaltung**. Variante B
(Soft Dark) 1:1 als alternatives Layout, in ⚙ umschaltbar, **ohne Funktionsverlust**. Reine Front-End-Änderung
in `public/index.html`, **15 Patches via `scripts/safe-edit.mjs`** (14 + 1 Folge-Fix, Windows-nativ, Read-Back-Hash OK).
Plan-Datei: `~/.claude/plans/abstract-dreaming-walrus.md` (vom User freigegeben).

Entscheidungen (vom User bestätigt): Baum-Zugriff via **schwebendem Flyout** (1:1 Mockup); Farben **gekoppelt**
(B-Layout bringt warme Palette + Inter mit, Farb-Theme-Auswahl in B ausgeblendet).

### Erledigt
- [x] **Layout-Infrastruktur.** `localStorage['nexus.layout']` ∈ {`classic`,`softdark`} (Default classic).
  `currentLayout()/applyLayout()/setLayout()` setzen `.app[data-layout=…]`; `init()` ruft `applyLayout(currentLayout())`.
  **DOM-IDs/JS-Verdrahtung unverändert** → Umschaltung primär CSS + gezielte JS-Ergänzungen.
- [x] **CSS-Scope `.app[data-layout="softdark"]`** (neuer Block im `<style>`): warme Palette + `font-family`/`background`
  direkt auf `.app` (wichtig: `body` liest `--app-font`/`--app-bg` aus `:root`, daher reicht die Var allein nicht –
  Folge-Fix). `.main`-Grid → `60px 0 1fr 5px var(--col-r)`, `#rz-l` aus; Icon-Rail (`.rail-btn`+Tooltip), Center als
  gerundete Karte, Pillen-Tabs, rechtes Panel/Statusbar warm.
- [x] **Icon-Rail + Flyout.** `renderSidebar()` verzweigt: bei softdark → `renderRail()` (ein `.rail-btn` je
  Top-Level-Ordner mit `folderIcon`+Farb-Dot+Tooltip, dazu „+ Notiz"). Klick → `openRailFlyout(node,btn)`:
  überlagerndes `#rail-flyout` mit Kopf + Unterbaum, **gebaut mit den bestehenden `makeFolderEl()/makeFileEl()`**
  → D&D, Kontextmenü, Öffnen gratis. `closeRailFlyout()` bei Klick außerhalb / Escape / Layout-Wechsel / Dateiklick.
- [x] **Editierbare Themen-Icons (beide Layouts).** `DEFAULT_ICONS` + `localStorage['nexus.folderIcons']`,
  `folderIcon()`. `makeFolderEl()` zeigt bei Top-Level `<span class="folder-ic">`. Icon-Popover `#icon-pop`
  (Emoji-Eingabe + 32 Presets), Kontextmenü „🖼 Icon ändern…", und Auto-Öffnen beim Anlegen eines Top-Level-Ordners.
- [x] **Settings.** Neue Sektion „Layout" (Standard / Soft Dark); „Design & Optik" nur noch im klassischen Layout.
- [x] **Unverändert/nur restyled:** Tab-D&D-Reorder, Tab-Dualscreen (Center-Split), `setRightMode` (Graph/Gliederung/Split),
  Graph-Canvas, `#rz-r`, Vault-Switch, Usage-Widget.

### Verifikation (Session 25) – inkl. echtem Headless-Lauf
- [x] `npm run verify:html` → OK (2580 Zeilen, Inline-Script `node --check` grün, Ende `</html>`); `md-render` 25/25.
- [x] **Live-Test** über Wegwerf-Stub-Server (echte index.html + API-Stubs) + Preview-Browser, **0 Konsolenfehler**:
  - Umschalten classic→softdark→classic sauber; Rail mit 4 Buttons + korrekten Icons; `.side` 60px.
  - Flyout öffnet (Kopf „Uni", Unterordner + Dateien aus `makeFolderEl/makeFileEl`), schließt bei Layout-Wechsel.
  - Nach Folge-Fix: Schrift = **Inter**, `.app`-Hintergrund warm `rgb(31,30,29)`, Center-Karte `border-radius:18px`.
  - Icon-Popover: 32 Presets, Setzen→`localStorage`+Tree-Icon aktualisiert, Entfernen→Default zurück.
  - (Center-Spaltenbreite nur im 0-px-Headless-Viewport „0" – reines Artefakt, kein Bug.)
- [x] Stub-Server/Preview/launch.json wieder entfernt; safe-edit-Backups in `.nexus-backups/`.

### TODO Paul
- [ ] App neu laden (Strg+R) / `npm run app`: ⚙ → Layout → „Soft Dark (Variante B)". Prüfen: Icon-Rail, Flyout
  (Datei öffnen, Rechtsklick, D&D), Icon ändern, Tab-D&D + Tab in die Mitte ziehen (Dualscreen), Graph/Gliederung/Split,
  Vault-Switch (Rail-Icon oben), Einstellungen (Rail-Zahnrad). Zurück auf „Standard" → klassisch unverändert.
- [ ] Git-Commit: `git add public/index.html STATUS.md && git commit -m "Session 25: Echte Layout-Umschaltung – Variante B (Icon-Rail+Flyout, editierbare Icons, Layout-Setting)"`
- [ ] Optional Folgesession: Varianten G (Kanban) und I (Focus Reader) nach demselben Muster als Layouts.

---

## Stand: 2026-06-13 (Session 24 – R11 Drei Design-Mockups als umschaltbare Optik)

Paul-Wunsch: die drei Dark-Mockups aus `design-mockups/` (Variante B Soft Dark, G Kanban/Board,
I Focus Reader) **zusätzlich** zum aktuellen Look einbauen, in den Einstellungen umschaltbar.
Umgesetzt als Erweiterung des bestehenden, verifizierten Theme-Mechanismus (Session 21) statt als
parallele Layout-Engine – d.h. die Mockups sind **vollwertige Design-Presets** (Palette + Seiten-
Hintergrund + Schrift), die über die bereits funktionierende „Design & Optik"-Sektion (⚙) gewählt
werden. Reine Front-End-Änderung in `public/index.html`, **6 Patches via `scripts/safe-edit.mjs`**
(Windows-nativ, kein Mount → Read-Back-Hash OK).

### Erledigt
- [x] **Themebare App-Basis.** `:root` um `--app-bg` (bisher hart kodierter Radial-Gradient),
  `--app-font` (`'Segoe UI',Inter,…`) und `--reader-font` (Default = `--app-font`) ergänzt.
  `body{background:var(--app-bg);font:…var(--app-font)}` zieht jetzt aus diesen Variablen;
  `.md-body{font-family:var(--reader-font)}` macht die **Lese-Schrift des Notizinhalts** themebar
  (Default unverändert). Alte Optik bleibt damit 1:1 Standard.
- [x] **`THEME_VARS`** um `--app-bg`/`--app-font`/`--reader-font` erweitert → sauberes Zurücksetzen
  beim Umschalten (bestehende Themes setzen sie nicht → Fallback auf `:root`-Defaults).
- [x] **3 neue Presets in `NEXUS_THEMES`:**
  - `softdark` **Soft Dark (Variante B)** – warmes Braun `#1f1e1d`, Amber-Accent `#e8a94a`, Inter, flacher BG.
  - `kanban` **Kanban / Board (Variante G)** – warmes Dunkel mit Verlaufs-BG, Accent `#d99a3d`, Inter.
  - `reader` **Focus Reader (Variante I)** – grünstichiges Dunkel `#151715`, Accent `#8fc5a3`,
    seitlicher Verlaufs-BG **und Serifen-Lesefont** (`Georgia,'Times New Roman',serif`) im Notizinhalt.
  Jeder mit `sw`-Swatch; erscheinen automatisch in der Einstellungs-Sektion (Loop über `NEXUS_THEMES`),
  Klick → `setTheme()` (Persistenz `localStorage['nexus.theme']`, beim Start via `applyTheme(currentTheme())`).
- [x] **Label** der Einstellungs-Sektion „Farb-Theme" → **„Design & Optik"** (deckt jetzt komplette Designs ab).

### Scope-Hinweis (ehrlich)
- Eingebaut sind **Farb-/Typografie-Skins** auf dem bestehenden Layout, nicht die abweichenden
  Layouts der Mockups (Icon-Rail, Kanban-Lanes, Paper-Spalte). Die Focus-Reader-Serifenschrift macht
  Variante I deutlich eigenständig; B und G teilen sich (wie in den Mockups) die warme Palette und
  unterscheiden sich v.a. in Accent/BG. Echte Layout-Umschaltung wäre eine eigene, größere Aufgabe
  (Richtung R12) und wurde bewusst nicht in die 2440-Zeilen-Datei gezwängt.

### Verifikation (Session 24)
- [x] `npm run verify:html` → **OK** (2440 Zeilen, Ende `</html>`, Inline-Script `node --check` grün).
- [x] `node test/md-render.test.mjs` → **25/25**.
- [x] safe-edit Read-Back-Hash grün (Windows-nativ, kein Mount); Temp-Generator/JSON wieder entfernt.

### TODO Paul
- [ ] App neu laden (Strg+R) / `npm run app`: ⚙ → „Design & Optik" → Soft Dark / Kanban / Focus Reader
  durchklicken (sofort wirksam, bleibt nach Reload). Bei Focus Reader: Notiz öffnen → Serifen-Lesefont.
- [ ] Git-Commit: `git add public/index.html STATUS.md && git commit -m "Session 24: R11 drei Design-Mockups als umschaltbare Optik (Theme-Presets B/G/I)"`

---

## Stand: 2026-06-12 (Session 23 – R10 Professioneller Installer & vollwertige Windows-App)

Version → **0.3.1**. Schwerpunkt: Nexus fühlt sich wie eine echte Windows-App an
(Installer-Doppelklick, Erster-Start-Wizard, kein CMD-Fenster, Nexus-Identität in der
Taskleiste, geführte Claude-/Usage-Einrichtung). Reine Datei-Edits (Write/Edit), **kein
`safe-edit` nötig** (public/index.html unberührt).

### Erledigt
- [x] **Teil 1 – Neues App-Icon.** `scripts/gen-icon.mjs` (NEU, devDeps `sharp` + `png-to-ico`)
  erzeugt aus EINER SVG-Definition `build/icon.png` (256×256, transparent) + `build/icon.ico`
  (multi-size 16/24/32/48/64/128/256). Design = vertrautes Diamant-Motiv, **leicht abgewandelt**:
  weicher Glow um die Cyan-Elemente + feiner Ring rundherum. Icons sind **bereits generiert** und
  in `build/` abgelegt (png 40 KB, ico 372 KB, 7 Größen verifiziert). Regenerieren: `npm run gen:icon`.
- [x] **Teil 2 – NSIS-Installer (`package.json` build-Block).** `nsis`: `oneClick:false`,
  `perMachine:false`, `allowElevation:false`, `allowToChangeInstallationDirectory:true`
  (korrekter electron-builder-Key statt des in der Vorgabe genannten `allowDirChange`),
  `installerIcon/uninstallerIcon/installerHeaderIcon = build/icon.ico`,
  `installerLanguages:["de_DE","en_US"]`, `language:"1031"`, `createDesktopShortcut`,
  `createStartMenuShortcut`, `shortcutName:"Nexus"`, `runAfterFinish:true`,
  `deleteAppDataOnUninstall:false`. `win.requestedExecutionLevel:"asInvoker"` (kein UAC).
- [x] **Teil 3 – Erster-Start-Wizard.** `public/wizard.html` (NEU, 3 Seiten, Nexus-Dark-Theme):
  (1) Willkommen, (2) Vault-Speicherort mit nativem **„Durchsuchen…"** (`dialog.showOpenDialog`,
  kein CMD), (3) Einstellungen (Autostart via `app.setLoginItemSettings`, „jetzt starten",
  „Anleitung anzeigen"). „Fertigstellen" schreibt `nexus.config.json` in userData (Seeding wanderte
  aus `ensureDataDir` in `wizard:finish`), startet Hauptfenster und/oder Hilfe. IPC via
  `electron/preload.cjs` (contextBridge `nexusAPI`) ↔ `ipcMain.handle` in `main.js`
  (`wizard:browse/default-vault-path/finish/cancel`). Re-Run gefahrlos testbar mit `NEXUS_FORCE_WIZARD=1`
  (überschreibt vorhandene Config nicht).
- [x] **Teil 4 – Kein CMD-Fenster, nie.** `win.requestedExecutionLevel:asInvoker`;
  Main-Logs nur via `log()` → stderr + `%APPDATA%\Nexus\nexus.log` (kein sichtbares stdout, MCP-stdout
  bleibt sauber); `windowsHide:true` an beiden `spawn`-Aufrufen in `ui-server.js` (markitdown + opener)
  → kein aufblitzendes Konsolenfenster. `nodeIntegration:false` bleibt.
- [x] **Taskleiste + Electron verstecken.** `app.setName('Nexus')`, `app.setAppUserModelId('de.hunold.nexus')`,
  `app.setAboutPanelOptions({applicationName:'Nexus'})`, BrowserWindow-`icon` = `build/icon.ico`/`.png`,
  Fenstertitel „Nexus", deutsches Menü ohne Electron-Verweise. → Taskleiste zeigt Nexus-Logo + „Nexus".
- [x] **In-App-Anleitung (Claude-Connect + Session-Key).** `public/help.html` (NEU): Schritt 1 Button
  „Mit Claude Desktop verbinden" (IPC `help:connect-claude` → schreibt/merged claude_desktop_config.json,
  Ergebnis-Status im Fenster), Schritt 2 Schritt-für-Schritt zum `sessionKey`-Cookie fürs Usage-Widget
  (+ Button „claude.ai öffnen" via `app:open-external`). Erreichbar über **Menü „Hilfe → Einrichtung &
  Usage-Key…"** und optional automatisch am Wizard-Ende.
- [x] **Teil 6 – `SETUP.md`** komplett neu: Doppelklick-Flow, SmartScreen-Schritt, Wizard, In-App-Anleitung,
  Build-Hinweis (läuft auf Windows), Pfadtabelle inkl. Log.

### Verifikation (Session 23)
- [x] `npm run verify:html` → **OK** (public/index.html 2434 Zeilen, Ende `</html>`, Inline-Script `node --check` grün; Datei unberührt).
- [x] `node test/md-render.test.mjs` → **25/25 bestanden**.
- [x] `node --check` grün: `scripts/gen-icon.mjs` (real, Mount-synchron), `electron/preload.cjs`,
  `electron/main.js` (Kontrollfluss/Struktur via 1:1-Reproduktion, da Mount stale), package.json-Build-Block (valides electron-builder-JSON).
- [x] Icon real erzeugt: `file` → PNG 256×256 RGBA + „MS Windows icon resource – 7 icons".
- [x] `ui-server.js`: nur additive `windowsHide:true`-Flags (kanonisch via Grep an Z. 233 + 375 bestätigt; war vorher gültig).

### Mount-Hinweis (wie Sessions 14/21)
- Der Linux-Mount lieferte für **per Write überschriebene** Dateien (main.js, preload.cjs, package.json)
  und für ui-server.js (310-Zeilen-Stub) erneut **stale/abgeschnittene** Kopien; die kanonischen Windows-Dateien
  sind vollständig korrekt (per `Read`/`Grep` gegengelesen: main.js `registerIpc`@286, `window-all-closed`@372;
  ui-server.js windowsHide@233/375). `node --check`/JSON-Parse über den Mount schlugen deshalb fälschlich fehl
  → Verifikation in sauberen /tmp-Reproduktionen. **Auf Pauls Windows-PC zur Sicherheit nachfahren:**
  `node --check electron/main.js`, `node --check src/ui-server.js`.

### Build-Ergebnis (2026-06-12, Pauls Windows-PC)
- [x] `npm install` + `npm run dist` erfolgreich. Ergebnis in `D:\Nexus\dist\`:
  **`Nexus Setup 0.3.1.exe`** (NSIS, ~104 MB) + **`Nexus-0.3.1-portable.exe`** (~104 MB).
- [x] **Build-Stolperstein dokumentiert:** `electron-builder` brach zunächst beim Entpacken des
  `winCodeSign`-Caches ab → `Cannot create symbolic link … Dem Client fehlt ein erforderliches Recht`
  (macOS-`.dylib`-Symlinks im Archiv; Windows verlangt für Symlinks ein Sonderrecht). **Fix:** Windows-
  **Entwicklermodus** aktivieren (Einstellungen → Für Entwickler) ODER einmalig im **Admin-Terminal**
  `npm run dist`; danach ist der Cache entpackt und folgende Builds laufen normal. Ggf. vorher
  `rmdir /s /q "%LOCALAPPDATA%\electron-builder\Cache\winCodeSign"`. Kein Code-/Config-Bezug.

### TODO Paul (Windows-PC)
- [ ] Installer testen: Doppelklick → SmartScreen „Trotzdem ausführen" → Ordnerwahl → Wizard (Vault-Pfad, Autostart) →
  Fenster öffnet, Taskleiste zeigt Nexus-Logo + „Nexus". Erststart-Config in `%APPDATA%\Nexus`.
- [ ] „Hilfe → Einrichtung & Usage-Key…": Claude-Connect (dann Claude Desktop neu starten) + Session-Key-Anleitung.
- [ ] Git-Commit: `git add -A && git commit -m "Session 23: R10 Installer/Wizard/Icon/Taskleiste/In-App-Anleitung (v0.3.1)"`

| Session | Datum | Inhalt | Start % | End % |
|---|---|---|---|---|
| 26e | 2026-06-14 | Pro-Layout-Farbmodell: echter Logikbug behoben (Theme setzt `--accent` inline → schlug Studio-Layout-CSS, daher blau/Picker tot) – `applyLayout` entfernt im Studio die THEME_VARS-Inline-Styles + setzt `--sd-accent`, im Standard `applyTheme`; jedes Layout merkt Farbe getrennt (kein Bleed). currentTheme-Default `darker` (Tiefsee). Umbenannt: Layout→Studio, Sektion→Farbe, 6 Themes→Nacht/Tiefsee/Himmel/Bernstein/Kupfer/Wald. Live im Preview verifiziert (Standard blau↔Studio amber↔grün↔zurück blau). verify:html OK (2663) + 25/25 | ~98 | ~99 |
| 26d | 2026-06-14 | UI-Server liefert index.html mit `Cache-Control: no-store` (express.static-Optionen) – behebt Electron-Stale-Cache, das hinter „Soft-Dark-Popups bleiben blau trotz Fix" steckte. node --check + verify:html OK | ~98 | ~98 |
| 26c | 2026-06-14 | Soft-Dark-Popups/Hashtags weiterhin blau – live im Browser-Preview reproduziert: (1) color-mix-Vars lösen `var(--accent)` auf `:root` auf → Palette muss auf `:root[data-layout]` (nicht `body`), `applyLayout` setzt Attribut auch auf documentElement; (2) eigener CSS-Kommentar mit `*/` in „--accent-*/--pop" beendete Kommentar vorzeitig & zerstörte die Regel. Beide gefixt, per getComputedStyle bestätigt (Markierung/Hashtag/Popup amber, Accent-Picker grün/Reset ok). verify:html OK (2646) + 25/25 | ~98 | ~98 |
| 26b | 2026-06-14 | Soft-Dark-Layout: echte Popup-Ursache (Overlays liegen außerhalb `.app`) → Palette auf `body[data-layout]` + `applyLayout` setzt body-Attribut; Akzentfarbe-Setting (`--sd-accent`, `--amber-soft` & Gelb-Töne via `color-mix`); Icon-Leiste-Breite-Slider (`--rail-w`, Buttons skalieren quadratisch); Gliederungs-Off-by-one (Klick+Scroll-Spy beide rect-basiert, `_olOffset`); rechtes Panel bündig ohne dunkles Feld/Rahmen (`#rz-r` blendet ein); Graph-Glow-Slider bis aus (`_graphGlow`). verify:html OK (2644) + 25/25 | ~97 | ~98 |
| 26 | 2026-06-14 | Alle Popups/Overlays an aktives Farb-Theme gekoppelt: abgeleitete `color-mix`-Variablen in `:root` (`--accent-04…30`, `--pop`/`--bar`/`--scrim`/`--field`, `--sb-*`) ersetzen alle hartkodierten Blautöne (`rgba(124,140,255,*)`, `rgba(10,13,22/11,14,24/13,17,30,*)`, `#0f1320/#0d1017/#2a2f42/#151b2c`, Scrollbar-Hex, `#9fb0ff`). Betrifft Palette/Settings/Prompt/Confirm/Picker, Statusleiste, Rechtsklick-/Color-/Icon-Menü, Graph-Popover, Usage-Fenster, Gliederungs- & Datei-Markierung, Vault-Dropdown, Scrollbar; HTML-Vorschau-iframe injiziert berechnete Farben (kein CSS-Var-Erbe). verify:html OK (2616) + 25/25 | ~97 | ~97 |
| 25 | 2026-06-13 | Echte Layout-Umschaltung: Variante B (Soft Dark) als alternatives Layout über `.app[data-layout]` – 60px-Icon-Rail mit editierbaren Themen-Icons (`folderIcon`/`#icon-pop`/`nexus.folderIcons`) + schwebendes Flyout (reuse `makeFolderEl/makeFileEl`), Center-Karte, Pillen-Tabs, gekoppelte warme Palette+Inter; Settings-Sektion „Layout"; alle Funktionen erhalten (Tab-D&D, Center-Split, Graph/Gliederung/Split). 15 Patches via safe-edit; verify:html OK + 25/25 + Headless-Preview-Lauf (0 Konsolenfehler) | ~96 | ~97 |
| 24 | 2026-06-13 | R11: 3 Design-Mockups (B Soft Dark / G Kanban / I Focus Reader) als umschaltbare Theme-Presets in NEXUS_THEMES eingebaut; `:root` um `--app-bg`/`--app-font`/`--reader-font` erweitert, body+`.md-body` themebar; THEME_VARS ergänzt; Sektion „Design & Optik"; 6 Patches via safe-edit; verify:html OK + 25/25 | ~95 | ~96 |
| 23 | 2026-06-12 | R10: neues Icon (gen-icon.mjs, Glow+Ring), NSIS-Optionen+Icons, Erster-Start-Wizard (wizard.html+IPC), kein CMD/windowsHide/stderr-Log, Taskleisten-Identität, In-App-Anleitung (help.html: Claude-Connect + Session-Key), SETUP.md neu; verify:html OK + 25/25; Build erfolgreich: Setup+portable je ~104 MB (winCodeSign-Symlink-Fix: Entwicklermodus/Admin) | ~88 | ~95 |

---

## Stand: 2026-06-12 (Session 22 – R9 Claude Usage-Widget)

5 Patches via `scripts/safe-edit.mjs` auf `public/index.html` + 2 neue Backend-Endpoints in `src/ui-server.js`. Verifiziert: `verify:html` OK (2367 Zeilen, Ende `</html>`, Inline-Script `node --check` grün), `md-render.test.mjs` 25/25.

### Erledigt
- [x] **R9 + R9b – Claude Usage-Widget + Einstellungen.** `<span id="usage-widget">` in der Statusleiste ganz rechts (nach `#sb-vault`). Kompakte Anzeige: `XX% · YY%` (Session 5h / Woche 7d) farbkodiert (grün→orange→rot ab 75%/90%). Klick öffnet Popover `#usage-popover` (fixed, bottom-right) mit:
  - **Auslastungs-Balken** für 5h-Session + 7d-Woche (Utilization 0–100%, Reset-Countdown).
  - **Zugangsdaten-Formular**: Session-Key (password input) + Org-ID (text input) mit ⟳-Auto-Detect-Button (`/api/claude-orgs`). Speichern → `localStorage['nexus.claudeAuth']`.
  - Ohne Credentials: Widget zeigt `— / —`.
  - Esc + Click-outside schließen das Popover.
  - Auto-Refresh alle 5 min via `setInterval`.
  - **R9b – Widget-Einstellungen** im Einstellungs-Menü (⚙): Anzeige-Modus (Prozent / Balken / Beides), konfigurierbare Schwellenwerte (Warnung / Kritisch in %), Position (Rechts Standard / Links neben Watcher). Persistence in `localStorage['nexus.usageCfg']`. Mini-Doppelbalken im Statusbar (`.uw-sb-bar`). `applyUsagePosition()` verschiebt Widget per `insertBefore`/`appendChild`. Alles sofort wirksam beim Klicken.
- [x] **Backend:** `GET /api/claude-usage?sessionKey=&orgId=` → Proxy auf `https://claude.ai/api/organizations/${orgId}/usage` (Cookie-Auth server-side, umgeht CORS). `GET /api/claude-orgs?sessionKey=` → Org-Liste + Filter auf `capabilities.includes('chat')`.

### TODO Paul
- [ ] App neu starten (`npm run app`), Session-Key aus Browser-DevTools holen (`claude.ai` → Application → Cookies → `sessionKey`), Widget klicken → Zugangsdaten eingeben → Org-ID per ⟳ ermitteln → Speichern. Widget sollte Verbrauch anzeigen.
- [ ] Git-Commit: `git add public/index.html src/ui-server.js STATUS.md && git commit -m "Session 22: R9 Claude Usage-Widget (Statusbar, Proxy-Endpoints, localStorage-Auth)"`

---

## Stand: 2026-06-11 (Session 21 – R7 Einstellungs-Menü)

Front-End in `public/index.html` (10 Patches via `scripts/safe-edit.mjs`, 1 Aufruf, Read-Back-Hash OK) + **ein** neuer Backend-Endpoint in `src/ui-server.js`. Verifiziert: `verify:html` OK (2210 Zeilen, Ende `</html>`, Inline-Script `node --check` grün), `md-render.test.mjs` 25/25, `node --check src/ui-server.js` grün (rekonstruiert, s.u.).

### Erledigt
- [x] **R7 – Einstellungs-Menü.** Zahnrad-Button `⚙ Einstellungen` unten in der Sidebar (unter `#side-scroll`, über dem Spalten-Resizer) öffnet Modal (`#settings-overlay`, Klasse `.settings-modal` im Nexus-Stil). Optionen:
  - **Farb-Theme** – 3 Presets (Dark/Standard, Darker, Soft-Blue). `NEXUS_THEMES` setzt CSS-Variablen-Overrides (`--bg/--panel/--panel2/--border/--text/--dim/--accent`) per `documentElement.style.setProperty`; vorher werden alle Theme-Vars zurückgesetzt (saubere Umschaltung). Persistenz `localStorage['nexus.theme']`, beim Start in `init()` via `applyTheme(currentTheme())` angewendet.
  - **Hauptthemen-Farben** – pro Top-Level-Ordner ein `<input type=color>`; schreibt über bestehendes `setCustomFolderColor()` nach `localStorage['nexus.folderColors']`, danach `renderSidebar()+invalidateVaultGraph()+setGraphVault(true)` (sofort sichtbar in Sidebar-Gradient + Graph). „↺"-Button stellt Standardfarbe wieder her (löscht Custom-Key → `folderColor()` fällt auf COLORS/Hash zurück).
  - **Vault-Speicherort** – zeigt aktuellen `vaultsRoot`; Speichern → `POST /api/settings/vaultsRoot` (validiert `existsSync+isDirectory`, schreibt `nexus.config.json` via `saveConfig()`, antwortet mit Reload-/Neustart-Hinweis). Anzeige liest `GET /api/settings/vaultsRoot` (gleicher Pfad → strikt „nur ein Endpoint").
  - **Editor-Schriftgröße** – Slider 12–20px, sofort wirksam über CSS-Var `--editor-fs` (CodeMirror + Textarea-Regeln auf `var(--editor-fs,13.5px)` umgestellt). Persistenz `localStorage['nexus.editorFontSize']`, Start via `applyEditorFs(currentEditorFs())`.
  - **Graph-Standardmodus** – Dropdown Ego-Graph (Default) / Hauptgraph. `openFile()` setzt `graph.pinnedMain` jetzt aus `localStorage['nexus.graphDefault']` (`'main'` → bleibt Hauptgraph beim Notiz-Öffnen). Persistenz `localStorage['nexus.graphDefault']`.
  - **Zusatz (Bugfix beim Lesen aufgefallen):** `colorToHex()` nutzte `/d+/g` (literal „d") statt `/\d+/g` → hsl-Farben wurden zu `#808080`. Korrigiert; verbessert auch den bestehenden Rechtsklick-Farbpicker.
  - Esc schließt das Menü (in globalen Escape-Handler aufgenommen). Input-Specificity-Konflikt mit `.palette input` durch `.set-body`-Präfixe gelöst.
- [x] **Backend:** `GET/POST /api/settings/vaultsRoot` in `src/ui-server.js` (nach `/api/vaults/active`). Nutzt bereits importierte Symbole (`existsSync`, `statSync`, `dataPath`, lokales `saveConfig()`). Strukturelle Persistenz in `nexus.config.json`; rein visuelle Einstellungen ausschließlich in `localStorage`.

### Mount-Hinweis (wichtig für nächste Session)
- Der Linux-Mount lieferte in dieser Session eine **stale/abgeschnittene** Kopie von `src/ui-server.js` (310 Zeilen, mitten in `/api/delete`), während die echte Windows-Datei vollständig ist (337 Zeilen, Ende `app.listen`). `node --check` direkt über den Mount schlug deshalb fälschlich fehl. Verifikation erfolgte über eine rekonstruierte Datei (Mount-Kopf bis Z.310 inkl. der neuen Routes + bekannter, gegengelesener Schwanz) → **Syntax OK**. `public/index.html` war im Mount dagegen in-sync (2210 Zeilen), `safe-edit` lief sauber, Mount→Windows-Schreibpropagation per Marker-Datei bestätigt. Bei Zweifeln auf Pauls Windows-PC `npm run verify:html` + `node --check src/ui-server.js` nachfahren.

### TODO Paul
- [ ] App neu laden (Strg+R) / `npm run app` und live prüfen: ⚙-Button unten links → Modal; Theme umschalten (sofort), Editor-Font-Slider (Editor öffnen), Graph-Standardmodus, Ordnerfarbe ändern/zurücksetzen, Vault-Pfad anzeigen/speichern. Bei Pfadänderung Server-Neustart nötig.
- [ ] Git-Commit: `git add public/index.html src/ui-server.js STATUS.md && git commit -m "Session 21: R7 Einstellungs-Menü (Theme/Ordnerfarben/Vault-Pfad/Editor-Font/Graph-Default + vaultsRoot-Endpoint)"`

---

## Stand: 2026-06-11 (Session 20b – R6a korrigiert: Tab-Split in die MITTE)

Korrektur nach Paul-Feedback: Der rechte „Split"-Button (Gliederung + Ego-Graph zusammen) bleibt wie er ist. Der **Tab-Splitscreen gehört in die Mitte** – zwei Dokumente nebeneinander – und **rechts bleiben Gliederung + Graph daneben** sichtbar. Der alte Ansatz (2. Ansicht als Overlay im rechten Panel) wurde komplett entfernt.

Reine Front-End-Aenderung in `public/index.html`. 8 Patches via `scripts/safe-edit.mjs` (Anker direkt aus der Live-Datei extrahiert → garantiert exakter Match). Verifiziert: `verify:html` OK (2100 Zeilen, Ende `</html>`), `md-render.test.mjs` 25/25, `grep` zeigt keine Reste der alten Funktionen.

### Erledigt
- [x] **R6a neu – Tab-Splitscreen in der Mitte (unabhaengig vom rechten Panel-Modus).**
  - Mittlere Spalte umstrukturiert: `#center-body` (Flex-Row) umschliesst jetzt `#note-area` + `#rz-center` (Spalten-Resizer) + `#note-pane2` (2. Ansicht). Default einspaltig; `#center-body.split` → zweispaltig.
  - `openCenterSplit(path)` rendert die gezogene Datei **read-only** in `#note-pane2` (MD via `renderMarkdown`, Bilder, PDF-iframe, sonst `<pre>`) mit Kopf (Tag „2. Ansicht" + Name + ✕). Gezogener Tab bleibt in der Leiste (parallele Anzeige, kein Move).
  - `initCenterSplitDrop()` haengt `dragover`/`dragleave`/`drop` an `#center-body`; nutzt bestehendes `_draggingTabId` (R4); Drop-Feedback `#center-body.drop-target` (gestrichelter Rahmen). **Funktioniert in jedem rechten Panel-Modus** (Graph/Gliederung/Split), da unabhaengig.
  - `initCenterResizer()` – Spaltenbreite per Drag, Persistenz `localStorage['nexus.centerL']`.
  - `closeCenterSplit()` bei ✕ und bei `switchVault`. Tabbar-`dragend` raeumt `#center-body.drop-target` mit auf.
  - Rechtes Panel (Gliederung + Graph) unveraendert und folgt weiterhin dem aktiven Haupt-Tab (R6b).
  - **Fix (Folge-Patch):** Tab-Dragstart `effectAllowed` von `move` → `copyMove`. Vorher zeigte der Cursor beim Ziehen in die Mitte einen durchgestrichenen Kreis (Drop verboten), weil `dropEffect='copy'` nicht zu `effectAllowed='move'` passte. Reorder in der Tab-Leiste (nutzt `dropEffect='move'`) bleibt unter `copyMove` gueltig.

### TODO Paul
- [ ] App neu laden (Strg+R) und live pruefen: Einen Tab aus der Leiste in den **mittleren** Dokumentbereich ziehen → zweite Ansicht erscheint rechts daneben in der Mitte (read-only), Tab bleibt erhalten, rechts bleiben Gliederung+Graph; Trennlinie verschiebbar; ✕ schliesst. R6b weiterhin: aktiver Tab steuert Graph/Gliederung.
- [ ] Git-Commit: `git add public/index.html STATUS.md && git commit -m "Session 20b: R6a korrigiert – Tab-Splitscreen in der Mitte (rechtes Panel bleibt)"`

---

## Stand: 2026-06-11 (Session 20 – R6 Splitscreen-Upgrade)

Reine Front-End-Aenderung in `public/index.html`. Alle 16 Patches via `scripts/safe-edit.mjs` (1 Aufruf). Verifiziert: `npm run verify:html` OK (2070 Zeilen, Ende `</html>`), `node test/md-render.test.mjs` 25/25, Datei-Ende + alle Einfuegestellen per Windows-`Read` gegengeprueft.

### Erledigt
- [x] **R6b – Rechtes Panel folgt immer dem aktiven Tab.**
  - Neue State-Var `_panelPath` (Guard: letzter synchronisierter Pfad).
  - `graphToMain()` – Graph zurueck zur Vault-Hauptansicht (nur wenn nicht schon `vault`-Modus; `pinnedMain`-Lock bleibt respektiert).
  - `applyActivePanel(path,headings,links)` – zentrale Sync: setzt `_curHeadings/_curNotePath`, ruft `renderOutline()` + `bindScrollSpy()` + `updateGraphForNote()`. Guard: bei reinem Aktivierungswechsel ohne Pfadwechsel No-Op; mit echten Headings (`fresh`) immer anwenden. `pinnedMain` wird NICHT angefasst -> Startup-Hauptgraph bleibt erhalten.
  - `syncFromActivation()` – liest aktiven Tab; MD-Datei im `file`-Modus wird uebersprungen (kommt frisch ueber `wireRendered`, kein Doppel-Render), `folder` -> Hauptgraph, sonst `applyActivePanel`.
  - Verdrahtet in `switchTab()`, `updateActiveTab()`, `newTab()`, `closeTab()` (beide Exits). `wireRendered()` ruft jetzt `applyActivePanel(path,res.headings,res.links)` (ersetzt inline Outline-Sync; doppelter `updateGraphForNote` entfernt).
  - Randfaelle: leerer Tab -> Hauptgraph + leere Gliederung; Nicht-MD-Datei -> Gliederung leer, Graph-Ego soweit moeglich; Editor-Tab -> Ego des bearbeiteten Pfads.
- [x] **R6a – Tab per Drag&Drop als 2. Ansicht in den Split-Bereich.**
  - `#split-preview`-Overlay (absolut, `inset:0`, z-index 45) im `.right-panel` (jetzt `position:relative`); nur im `data-rmode="split"` + `.show` sichtbar (CSS-getriebene Bereinigung bei Modus-Wechsel).
  - `openSplitPreview(path)` rendert die Datei **read-only** (MD via `renderMarkdown`, Bilder, sonst `<pre>`), mit Kopf (Tag „2. Ansicht“ + Dateiname + ✕). Wikilinks im Preview schliessen Preview und oeffnen Ziel.
  - `initSplitDrop()` haengt `dragover`/`dragleave`/`drop` an `.right-panel`: nur im Split-Modus aktiv, nutzt bestehendes `_draggingTabId` (R4), Drop-Feedback `.tab-drop-target` (gestrichelter Rahmen). Gezogener Tab bleibt erhalten (parallele Anzeige, kein Move). In `init()` nach `initTabDnd()`.
  - `closeSplitPreview()` bei ✕, bei `setRightMode(!=split)` (R6a-Cleanup) und bei `switchVault`. Tabbar-`dragend` raeumt Right-Panel-Highlight mit auf.

### TODO Paul
- [ ] App neu laden (Strg+R) und live pruefen: (a) Notiz/Tab wechseln -> Graph wechselt in Ego-Modus der aktiven Datei, Gliederung folgt; leerer Tab -> Hauptgraph; Nicht-MD -> Gliederung leer. (b) Split-Modus aktivieren, einen Tab aus der Leiste in den rechten Bereich ziehen -> read-only 2. Ansicht erscheint, Tab bleibt in der Leiste; Drop-Feedback sichtbar; ✕ schliesst; Moduswechsel raeumt auf.
- [ ] Git-Commit: `git add public/index.html STATUS.md && git commit -m "Session 20: R6 Splitscreen-Upgrade (R6a Tab-D&D Split-Preview + R6b Panel-Sync)"`

---

## Stand: 2026-06-11 (Session 19b – Ordnerfarbe per Rechtsklick)

Reine Front-End-Aenderung. verify:html OK (1977 Zeilen), 25/25 gruen.

### Erledigt
- [x] **Ordnerfarbe per Rechtsklick konfigurierbar.**
  - `localStorage['nexus.folderColors']` = `{Name: "#hex"}` als Custom-Color-Store. `_customFolderColors()` + `setCustomFolderColor(name,color|null)` verwalten ihn.
  - `folderColor()` prueft zuerst Custom-Store, dann COLORS-Map, dann Hash-Fallback.
  - Context-Menu fuer Top-Level-Ordner (`path.indexOf('/')===-1`) bekommt Separator + Eintrag `🎨 Farbe anpassen…`.
  - `#color-pop`-Popover erscheint an Menueposition: `<input type="color">`, Knopf "Uebernehmen", "Entfernen" (nur sichtbar wenn Custom-Farbe gesetzt), "Abbrechen". `colorToHex()` konvertiert hsl/rgb fuer `input[type=color]`.
  - "Entfernen" loescht Custom-Eintrag -> folderColor() faellt auf COLORS/Hash zurueck.
  - Nach Apply/Remove: `renderSidebar()` + `invalidateVaultGraph()` + `setGraphVault(true)` -> Sidebar-Gradient + Graph sofort aktuell.
  - Popover schliesst bei Klick ausserhalb (click-listener prueft `.contains()`) und bei Escape.

### TODO Paul
- [ ] App neu laden (Strg+R), Rechtsklick auf Top-Level-Ordner -> `🎨 Farbe anpassen…` klicken, Farbe waehlen, `Uebernehmen` -> Gradient + Graph aktualisiert sich sofort. `Entfernen` -> Standardfarbe zurueck.
- [ ] Git-Commit: `git add public/index.html STATUS.md && git commit -m "Session 19b: Ordnerfarbe per Rechtsklick (custom localStorage + Graph-Update)"`

---

## Stand: 2026-06-11 (Session 19 – R5 Sidebar-Farbfeld Variante B)

Reine Front-End-Aenderung in `public/index.html`. Verifiziert: `verify:html` OK (1937 Zeilen, Ende `</html>`), `node test/md-render.test.mjs` 25/25. Aenderungen per Node-Skript (literaler split/join, kein safe-edit-JSON-Escaping-Problem bei Template-Literals).

### Erledigt
- [x] **R5 – Sidebar-Themen: Gradient-Zeile statt Farb-Dot (Variante B).**
  - CSS: `.folder-row.folder-gradient` (volle Zeile, `color-mix`-Gradient links→transparent), `:hover` (28%), `.active` (32%), plus `.folder-label` (flex:1, weiß, 500-Weight). Bisherige `.dot`-Regel bleibt (Palette + Picker nutzen sie weiter).
  - JS `makeFolderEl`: `isTop=depth===0`. Top-Level-Ordner (depth 0) bekommen `folder-gradient`-Klasse + `--fc:${color}` CSS-Var, kein dot-Span, stattdessen `<span class="folder-label">`. Sub-Ordner unverändert (grauer dot).

### TODO Paul
- [ ] App neu laden (`npm run app` oder Strg+R) und live prüfen: Top-Level-Ordner haben farbigen Gradient-Hintergrund ohne Punkt, Sub-Ordner haben weiterhin grauen Punkt.
- [ ] Git-Commit: `git add public/index.html STATUS.md && git commit -m "Session 19: R5 Sidebar-Farbfeld Variante B (Gradient)"`

---

## Stand: 2026-06-11 (Session 18 – R4 Tab-D&D-Reorder)

Reine Front-End-Aenderung in `public/index.html`. Verifiziert: `verify:html` OK (1929 Zeilen, Ende `</html>`), `node test/md-render.test.mjs` 25/25. Alle Aenderungen via `scripts/safe-edit.mjs` (1 Aufruf, 5 Patches).

### Erledigt
- [x] **R4 – Tab-Reihenfolge per Drag & Drop.**
  - State-Variable `_draggingTabId=null` ergaenzt (unabhaengig von `_movingPath` fuer Tree-D&D).
  - CSS: `.tab.drop-target` zur bestehenden Drop-Highlight-Regel ergaenzt.
  - `renderTabBar()`: Tab-Divs bekommen `draggable="true" data-tidx="'+i+'"`.
  - `initTabDnd()`: Event-Delegation auf `#tabbar` fuer `dragstart`/`dragover`/`drop`/`dragend`. `dragstart` prueft `if(_movingPath)return` -> kein Konflikt mit Tree-D&D. Drop: `curId`-Tracking (via `tabs[activeTab].id`) stellt `activeTab` nach Splice/Insert korrekt wieder her. `renderTabBar()` am Ende (ruft `saveTabs()` mit ein).
  - `init()`: `initTabDnd()` nach `resetTabs()` aufgerufen.

### TODO Paul
- [ ] App neu laden (`npm run app` oder Strg+R) und live pruefen: Mehrere Tabs oeffnen, per Drag&Drop umsortieren. Aktiver Tab bleibt aktiv. Reihenfolge bleibt nach Reload erhalten (Persistenz ueber `saveTabs`/`localStorage`).
- [ ] Git-Commit: `git add public/index.html STATUS.md && git commit -m "Session 18: R4 Tab-D&D-Reorder"`

---

## Stand: 2026-06-11 (Session 17 – R2 Scrollbar, R1 Checkbox-Toggle, R3 Vault-Selector)

Reine Front-End-Aenderung in `public/index.html`. Verifiziert: `verify:html` OK (1892 Zeilen, Ende `</html>`), `node test/md-render.test.mjs` 25/25. Alle Aenderungen via `scripts/safe-edit.mjs` (4 Aufruf-Rounds).

### Erledigt
- [x] **R2 – Scrollbar-Styling.** Globale `::-webkit-scrollbar`-Regeln auf Theme-Farben umgestellt: Track `#1a1d2a`, Thumb `#3a3f55`, Hover `#5a6080`, 6px Breite, border-radius 3px. Scoped Overrides fuer `#note-area`, `#outline-panel`, `.side-scroll`, `.log-rows`, `.graph-filter`, `.pal-results`, `.graph-settings` (6px) sowie horizontale Scrollbars fuer Code-Blocks / Tabellen / Transklusion (4px Hoehe).
- [x] **R1 – Checkbox-Toggle.** `_curNoteRaw` State-Variable ergaenzt; `renderMarkdownView` speichert Raw-Text; `wireRendered` haengt Click-Listener an alle `.task-cb` Elemente: nth Checkbox wird auf nth `- [ ]`/`- [x]`-Zeile in `_curNoteRaw` gemappt, Line getoggelt, per `POST /api/save` zurueckgeschrieben, Note ohne Full-Reload neu gerendert.
- [x] **R3 – Custom Vault-Dropdown.** Natives `<select>` ersetzt durch `#vault-sel-wrap` / `#vault-sel-btn` (Chevron `▾`, Dark-BG `#0d1017`, Border `#2a2f42`, Hover-Highlight, Rotate-Animation beim Oeffnen) + `#vault-sel-drop` (absolute Positionierung, `#0d1017`, `#2a2f42` Border, `.vs-opt`-Items mit `.active`-Klasse). `toggleVaultDrop()` + `_closeVaultDrop()` (click-outside via capture) + `refreshVaultSelector()` komplett neu. Kein natives OS-Widget mehr.

### TODO Paul
- [ ] App neu laden (`npm run app` oder Strg+R) und live pruefen: Scrollbars in Note-Area / Outline-Panel (dunkel, schmal), Checkbox-Klick toggelt und speichert, Vault-Dropdown oeffnet/schliesst sauber, Klick ausserhalb schliesst es.
- [ ] Git-Commit: `git add public/index.html STATUS.md && git commit -m "Session 17: R2 Scrollbar + R1 Checkbox-Toggle + R3 Vault-Selector"`

---

## Stand: 2026-06-11 (Session 16 – macOS-Dots entfernt, Rechtes Panel: Graph/Gliederung/Split)

Reine Front-End-Aenderung in `public/index.html`. Verifiziert: `verify:html` OK (1806 Zeilen, Ende `</html>`), `node test/md-render.test.mjs` 25/25. Alle Aenderungen via `scripts/safe-edit.mjs` (3 Aufruf-Rounds mit Hash-Verifikation).

### Erledigt
- [x] **Aufgabe A – macOS-Ampel entfernt.** `<div class="dots">…</div>` aus Titlebar geloescht; `.dots span{…}`-CSS-Regel entfernt. Titlebar zeigt jetzt nur noch `◆ NEXUS`, Breadcrumb, Suchleiste.
- [x] **B1 Struktur.** `#right-toggle` (3 Buttons: Graph | Gliederung | Split) + `#outline-panel` vor `.graph-wrap` ins `.right-panel` eingefuegt. Reihenfolge: `#right-toggle` → `#outline-panel` → `.graph-wrap` → `.activity`.
- [x] **B2 CSS-Modi.** `data-rmode`-Attribut-Selektor auf `.right-panel` steuert Sichtbarkeit:
  - Default (`data-rmode` nicht gesetzt oder `graph`): `#outline-panel{display:none}`, `.graph-wrap` voll sichtbar.
  - `outline`: `.graph-wrap{display:none}`, `#outline-panel{flex:1;flex-direction:column}`.
  - `split`: `#outline-panel{flex:0 0 42%;border-bottom}`, `.graph-wrap{flex:1}`.
  - Aktiver Button per `.active`. Persistenz in `localStorage['nexus.rightmode']`. `window.dispatchEvent(new Event('resize'))` bei Wechsel.
- [x] **B3 Outline-Render.** Globale `_curHeadings`, `_curNotePath`, `_scrollSpyFn`. `renderOutline()` fuellt `#outline-panel` mit klickbaren `.ol-row`-Buttons (Einrueckung `(level-1)*13+10px`), Klick → `scrollIntoView({block:'start'})`. Leerer State → "Keine Gliederung"-Hinweis.
- [x] **B4 Scroll-Spy.** `bindScrollSpy()` haengt rAF-gedrosselten Scroll-Listener an `#note-area`. Aktive Ueberschrift = letzte mit `offsetTop <= scrollTop+8`. Entsprechende Outline-Zeile bekommt `.active` + `scrollIntoView({block:'nearest'})`. Alter Listener wird vor Neubindung sauber entfernt.
- [x] **B5 Sync.** `_curHeadings=res.headings; renderOutline(); bindScrollSpy()` in `wireRendered()` (deckt alle MD-Opens + Tab-Wechsel ab). `_curHeadings=[]` + `renderOutline()` in `openFile()` vor dem try-Block (deckt Nicht-MD-Dateien ab). `setRightMode(localStorage.getItem('nexus.rightmode')||'graph')` in `init()`.

### TODO Paul
- [ ] App neu laden (`npm run app` oder Strg+R) und live pruefen: Buttons Graph|Gliederung|Split umschalten, Notiz oeffnen → Gliederung erscheint, Klick springt zur Ueberschrift, Scrollen markiert aktiven Abschnitt, Split zeigt beide Panels, Graph passt nach Wechsel. Persistenz: Modus bleibt nach Reload erhalten.
- [ ] Git-Commit manuell ausfuehren (`.git/index.lock` war in der Session gesperrt, konnte nicht aus der Sandbox entfernt werden):
  ```
  git add public/index.html STATUS.md
  git commit -m "Session 16: macOS-Dots entfernt + Rechtes Panel Graph/Gliederung/Split mit Scroll-Spy"
  ```

---

---

## Stand: 2026-06-11 (Session 15 – Dateiuebersicht: prompt()-Bug, Tree-State, Themed Confirm, Ordner-Picker)

Reine Front-End-Aenderung in `public/index.html`. Verifiziert: `verify-html` OK (1747 Zeilen, Ende `</html>`), `node --check` des Inline-Scripts gruen, Windows-Datei und Mount konsistent gegengeprueft.

### Behoben
- [x] **Kernbug: neue Dateiuebersicht-Aktionen taten nichts.** Ursache: alle neuen Aktionen (Neue Notiz, Neuer Ordner, Umbenennen, Verschieben, „+ Notiz") starteten mit `window.prompt()` – **Electron unterstuetzt `prompt()` nicht** (liefert sofort `null`), daher `if(name===null)return;` = sofortiger Abbruch. `confirm()` funktioniert in Electron, deshalb lief Loeschen unauffaellig. Fix: promise-basiertes Modal `uiPrompt()` (App-Theme) ersetzt alle 5 `prompt()`-Aufrufe.
- [x] **Kein Voll-Reload mehr / Ordner bleiben offen.** Neuer `refreshTree()` ersetzt `loadVault()` nach Aktionen (Neu/Umbenennen/Verschieben/Loeschen/Notiz-Speichern). Aufklappzustand via `openFolders`-Set persistiert ueber Re-Render, Scrollposition bleibt, Graph wird nicht neu initialisiert. `loadVault()` nur noch bei Start, Vault-Wechsel, Vault-Entfernen.
- [x] **Themed Bestaetigungs-Dialog.** `uiConfirm()`-Modal ersetzt den weissen Windows-`confirm()` ueberall (Loeschen, ungespeicherte Aenderungen, Vault entfernen). 0 native `prompt`/`confirm` mehr in der Datei.
- [x] **Verschieben per Ordner-Browser.** `ctxMove` oeffnet jetzt `uiFolderPicker()`: klickbare Ordneruebersicht mit Breadcrumb (Wurzel, `..` zurueck), Button „Hierhin verschieben". Zu verschiebender Ordner + Nachfahren werden ausgeblendet (kein Move in sich selbst).

### Editier-Vorfall (erneut) + Lehre
- Beim ersten Fix-Block hat das **Edit-Tool die Datei an einem `──`-Zeichen abgeschnitten** (Ende ab `renderVaultList` weg). index.html enthaelt 11 `──`. Erkannt via `verify-html`, Schwanz aus `git show HEAD:` rekonstruiert.
- **Danach alle Aenderungen nur per Python-Skript** (literaler String-Replace mit Count-Assertion), nach jedem Block `verify-html` + Host-`Read` von Anfang und Ende. Deckt sich mit Session-14-Regel; kuenftig idealerweise `scripts/safe-edit.mjs` verwenden.

### TODO Paul
- [ ] App neu laden (Strg+R) bzw. `npm run app` neu starten und live pruefen: Rechtsklick Neu/Umbenennen/Verschieben/Loeschen, „+ Notiz", Ordner bleiben beim Arbeiten offen, Confirm-Dialog im Dark-Theme, Verschieben via Ordner-Picker.

## Stand: 2026-06-11 (Session 14 - index.html-Truncation DAUERHAFT geloest)

### Echte Ursache (korrigierte Diagnose -- die alte war ein Symptom)
Die wiederkehrende "Edit-Tool zerschneidet index.html"-Diagnose war unvollstaendig.
Beleg aus den eigenen Protokollen: Session 10/11 zeigten die **Windows-Datei intakt,
nur den Linux-Mount** abgeschnitten/NUL-gepaddet; Session 13 (schwerster Unfall) wurde
durch ein **node-Skript ueber den Mount** ausgeloest, nicht durch Edit -- eine veraltete
Mount-Fassung wurde nach Windows zurueckgeschrieben. Die wahre Fehlerklasse ist damit
**Read-Modify-Write ueber den divergierenden Windows<->Linux-Mount**, nicht ein einzelnes
Tool. Edit zu verbieten behandelte nur ein Symptom und liess den eigentlichen
geladenen Lauf (node/bash-Splice ueber den Mount) offen.

### Loesung: sanktionierter, selbstpruefender Edit-Weg + Commit-Schutz
Neu unter `scripts/`:
- **`verify-html.mjs`** -- Integritaetspruefer. Harte Detektoren: (1) Datei endet mit
  `</html>` (Sentinel), (2) `node --check` des Inline-`<script>`, plus NUL-/Byte-/Zeilen-
  Sanity. Faengt JEDE bisher dokumentierte Truncation. Exit 0/1. `export verifyHtml()`.
- **`safe-edit.mjs`** -- der EINZIGE erlaubte Weg, index.html zu aendern. Ablauf:
  Basis-Check (nie eine bereits kaputte/stale Quelle editieren -> haette Session 13
  gestoppt) -> Backup nach `.nexus-backups/` -> literale Patches (split/join, kein Regex)
  mit exakter Count-Assertion -> atomic write (tmp+rename) -> **Read-Back-sha256 == Soll**
  (faengt Mount-Write-Back-Korruption) -> Ergebnis-Check -> bei Fehler **Auto-Rollback**
  aus Backup. Modi: `--patches <json>` oder `--content <txt>`.
- **`scripts/hooks/pre-commit`** + `install-hooks.mjs` -- Git-Hook prueft den GESTAGTEN
  index.html-Blob via verify-html; eine truncated Datei kann nicht mehr in die Historie
  gelangen. Aktivierung selbstinstallierend ueber npm `prepare` (`core.hooksPath=scripts/hooks`).
- **npm-Scripts**: `npm run verify:html`, `npm run edit:html -- --patches p.json`.

### HARTE REGEL (ersetzt "index.html nie mit Edit")
1. index.html NUR ueber `scripts/safe-edit.mjs` aendern (Patches oder --content).
   Edit/Write-Tool direkt = verboten; bash/node-Splice ueber den Mount = verboten.
2. Nach jeder Aenderung zusaetzlich per Windows-`Read` Kopf UND Ende gegenpruefen.
3. Am sichersten laeuft safe-edit auf Pauls Windows-PC (kein Mount im Spiel). In der
   Sandbox schuetzt der Read-Back-Hash trotzdem.
4. Bei Mount-Divergenz kanonische Datei via `git show HEAD:...` / `git archive HEAD`
   holen, NIE blind vom Mount kopieren.

### Verifikation
- [ ] **OFFEN (Sandbox war in dieser Session nicht startbar):** safe-edit/verify gegen
  /tmp-Kopie testen: erfolgreicher Patch, simulierte Truncation -> Rollback greift,
  `node --check`, `test/md-render.test.mjs` (25), `test/smoke.js` (48). Beim naechsten
  Sandbox-Zugang oder auf Pauls PC nachholen (`npm run verify:html`, dann ein Test-Patch).
- [x] Statisch geprueft: index.html aktuell gesund (1622 Zeilen, Ende `</html>`, kein NUL,
  genau ein Inline-`<script>` 441-1620 -> Extraktor eindeutig).

## Stand: 2026-06-11 (Session 10 - Tabs: Back/Forward, Persistenz, Drag&Drop-Move)

Reine Front-End-Aenderung in `public/index.html` (Server/Tools unveraendert -> Smoke-Tests Session 7: 48/48 bleiben gueltig). `node --check` der Script-Sektion: gruen. `node test/md-render.test.mjs`: 25/25. Datei-Ende korrekt (`</html>`), jetzt 1622 Zeilen.

### Erledigt
- [x] **Pfeil-zurueck / Vor (pro-Tab Navigationshistorie).** Jeder Tab hat `hist[]` + `hi` (Index). `pushHist()` schneidet beim Navigieren den Vorwaerts-Zweig ab (Browser-Logik), dedupliziert gleiche Stelle. `‹`/`›`-Buttons links in der Tab-Leiste (`.tab-nav`/`.tnav`, disabled-Style `.off`) wirken auf den aktiven Tab via `tabBack()`/`tabForward()`. Historie wird in `updateActiveTab()` gepflegt (greift bei jedem openFile/openEditor/openFolderView, ausser `_silentRender`).
- [x] **Tabs ueber Reloads persistieren (pro Vault).** `saveTabs()` schreibt `{activeTab, tabs:[{path,mode,hist,hi}]}` je Vault nach `localStorage['nexus.tabs']`; gehookt in `renderTabBar()` (deckt alle Mutationen ab). `restoreTabs()` stellt beim Start (`init`) und Vault-Wechsel (`switchVault`) wieder her; faellt sonst auf START.md / leeren Tab zurueck. `switchVault` sichert die Tabs des alten Vaults vor dem Wechsel.
- [x] **Drag&Drop-Verschieben im Tree.** Datei- (`.tree-file`) und Ordner-Zeilen (`.folder-row`) sind `draggable`; `_movingPath` haelt die Quelle. Drop auf eine Ordnerzeile = hinein verschieben; Drop auf leeren Bereich/`#folder-list` = in die Wurzel. `moveInto()` nutzt `/api/rename` (wie ctxMove), mit Guards: kein No-Op in denselben Ordner, kein Ordner-in-sich-selbst/Nachfahre. Visuelles Feedback `.drop-target` / `.drop-root`. Externe Datei-Uploads (Files-Drop) unveraendert, da getrennt ueber `types.includes('Files')`.

### Verifikation Session 10
- [x] `node --check` der extrahierten Script-Sektion: OK.
- [x] `node test/md-render.test.mjs`: 25/25 (Markdown-Renderer unberuehrt).
- [x] Einfach-Definition aller neuen/geaenderten Funktionen geprueft (renderTabBar/updateActiveTab/pushHist/tabBack/tabForward/saveTabs/restoreTabs/moveInto/clearDropHL/resetTabs je 1x).
- [ ] **TODO Paul:** UI Hard-Reload und live pruefen: (a) Pfeil zurueck/vor pro Tab, (b) Tabs bleiben nach Reload + nach Vault-Wechsel erhalten, (c) Datei/Ordner per Drag&Drop in anderen Ordner und in die Wurzel ziehen. Server-Neustart NICHT noetig (reine Front-End-Datei).

### WICHTIG - Vorfall Session 10: Edit-Tool hat index.html erneut abgeschnitten
- Beim Editieren von `public/index.html` mit dem **Edit-Tool** wurde die Datei wieder mittendrin (in `uploadFiles`) abgeschnitten -> Ende (`</script></body></html>`) weg. Bestaetigt die bestehende Regel.
- **Loesung diese Session:** aus Backup wiederhergestellt und alle 10 Aenderungen per **Python-Skript mit exaktem String-Replace** (Count-Assertion ==1 je Edit) angewendet. Datei danach `node --check` gruen, Ende korrekt.
- **Lehre (verschaerft):** index.html NIE mit dem Edit-Tool aendern. Vorher Backup, dann Python/bash-Replace, danach `tail`/`node --check`.

### Offen / Naechste Schritte (Session 10)
- Optional: Editor-Inhalt pro Tab live halten (statt Reload-from-disk beim Tab-Wechsel) - weiterhin offen.
- Optional: Tab-Reihenfolge per Drag&Drop sortieren.
- Optional: leerer-Bereich-Rechtsklick im Tree fuer "Neue Notiz/Ordner" in der Wurzel.
- Optional: gespeicherte Tabs auf nicht mehr existierende Pfade pruefen/bereinigen beim Restore.

## Stand: 2026-06-11 (Session 9 - Dateiuebersicht: Kontextmenue, Resizer, Tabs)

Reine Front-End-Aenderung in `public/index.html` (Server/Tools unveraendert -> Smoke-Tests Session 7: 48/48 bleiben gueltig). `node --check` der Inline-Script-Sektion: gruen. Datei-Ende korrekt (`init(); </script></body></html>`).

### Erledigt
- [x] **Kontextmenue-Aktionen (Dateiuebersicht).** `showCtx` erweitert + neue Handler `ctxNewNote / ctxNewFolder / ctxRename / ctxMove / ctxDelete`.
  - Datei-Rechtsklick: Umbenennen, Verschieben nach…, Loeschen (zus. zu Oeffnen/Bearbeiten/Markitdown/Pfad).
  - Ordner-Rechtsklick: Neue Notiz, Neuer Ordner, Umbenennen, Verschieben nach…, Loeschen.
  - Verdrahtet an bestehende Endpunkte: `/api/save` (create), `/api/mkdir`, `/api/rename` (dient auch als Move), `/api/delete`. `api()` wirft NICHT -> Handler pruefen `r.error`. Nach Aenderung: `invalidateVaultGraph()` + `loadVault()`. Verschieben = rename auf `Zielordner/basename`.
- [x] **Resizable Panes.** `.main`-Grid nutzt CSS-Vars `--col-l`/`--col-r` + zwei `.resizer`-Handles (`#rz-l`, `#rz-r`) zwischen den Spalten. `initResizers()` (mousedown/move/up), Grenzen geklemmt, Persistenz in `localStorage` (`nexus.cols`), Graph-Resize via `window.dispatchEvent('resize')` (nutzt bestehenden resize-Closure).
- [x] **Multi-Tab-System (Obsidian-Logik).** Tab-Leiste `#tabbar` ueber `note-area`.
  - State: `tabs[]` {id,path,mode}, `activeTab`, `_silentRender`. Modi: file/editor/folder/empty.
  - Klick auf Datei/Ordner -> `updateActiveTab()` ersetzt NUR den aktiven Tab (Hook in `openFile`/`openEditor`/`openFolderView`, unterdrueckt bei `_silentRender`).
  - `+` (`newTab`) oeffnet leeren Tab; `switchTab` rendert gespeicherten Pfad neu (silent); `closeTab` mit Nachbar-Auswahl, letzter Tab -> leerer Tab.
  - `maybeLeaveEditor()` vor Tab-Wechsel/Schliessen (ungespeicherte Edits). `resetTabs()` bei Init + Vault-Wechsel. `tabsRenamePath`/`tabsClosePath` halten Tabs bei ctxRename/ctxMove/ctxDelete konsistent.

### Verifikation Session 9
- [x] `node --check` der extrahierten Script-Sektion: OK.
- [x] Keine Funktions-Namenskollisionen (renderTab/switchTab/closeTab/newTab/updateActiveTab/showEmptyTab/resetTabs je 1x).
- [x] Hooks an korrekter Stelle (openFile 858, openEditor 994, openFolderView 1317); resetTabs in init + switchVault.
- [ ] **TODO Paul:** UI Hard-Reload (localStorage-Cache) und live pruefen: Rechtsklick-Aktionen, Spalten ziehen, Tabs (Plus, Wechsel, Schliessen, Datei in neuem Tab). Server-Neustart NICHT noetig (reine Front-End-Datei).

### Offen / Naechste Schritte (Session 9)
- Optional: Tab-Zustand (offene Tabs) in localStorage persistieren ueber Reloads.
- Optional: Drag&Drop zum Verschieben im Tree (statt Prompt-Zielordner).
- Optional: Editor-Inhalt pro Tab live halten (statt Reload-from-disk beim Tab-Wechsel).
- Optional: leerer-Bereich-Rechtsklick im Tree fuer "Neue Notiz/Ordner" in der Wurzel.

## Stand: 2026-06-11 (Session 8 - Graph-UI ueberarbeitet)

Alle Aenderungen NUR in `public/index.html` (Front-End). Server/Tools unveraendert -> Smoke-Tests (Session 7: 48/48) bleiben gueltig.

### Issue 3 (Kern-Bug): Physik "springt wild umher" = VORZEICHENFEHLER in der Abstoszung
- [x] Ursache gefunden: In `physicsGraph()` war `charge` negativ, die Kraft aber entlang `(n - m)` -> effektiv **Anziehung** statt Abstoszung. Knoten wurden zusammengezogen, kollabierten und schossen mit dem riesigen, ungedeckelten `charge` (d2-Minimum = 1px) durcheinander. "Abstoszung"-Regler verstaerkte die versteckte Anziehung.
- [x] **`physicsGraph()` komplett neu** (numerisch verifiziert, auch mit echtem Code aus der Datei):
  - charge POSITIV, Kraft entlang `(n-m)` = echte Abstoszung
  - Nahbereichs-Deckel `minD2=(0.5L)^2` statt 1px -> keine Kraftspitzen
  - harte Geschwindigkeitsbegrenzung `vmax=0.3L` + Daempfung 0.62 -> kein Ueberschiessen
  - Zentrieren per **Translation** (kein komprimierender Feder-Term mehr) -> kein Kollaps zur Mitte
  - Laengenmassstab `L=max(30,70*linkDist)*dpr`; `charge=0.9*GS.charge*L*L`; `ls=0.06*GS.link`
  - Verifikation: N=1500 -> endBbox 23L, End-Jitter 0.07px (praktisch in Ruhe), kein NaN. Alle Slider-Extreme stabil.

### Issue 2: Konzentrierte Notiz-Ansicht war chaotisch statt Kreis
- [x] `buildEgo()`: Ringknoten + Zentrum werden jetzt auf der Kreisposition **fixiert** (`fx/fy` + `homeX/homeY`). Physik laesst sie in Ruhe -> gleichmaessiger, sauberer Kreis. Drag eines Knotens schnappt beim Loslassen auf die Kreisposition zurueck (`onGraphUp`).

### Issue 1: Hauptgraph lud "ewig"
- [x] **In-Memory-Cache** `_vaultCache` je Vault: `setGraphVault(force)` baut nur bei `force=true` (Reindex/Upload/Convert) neu, sonst sofort aus dem Speicher. Home-Button & Vault-Rueckkehr sind dadurch instant.
- [x] **Render-Drossel**: `cx.shadowBlur` (sehr teuer) nur noch bei <=200 Knoten oder fuer den Hover-Knoten.
- [x] **Animationsschleife stoppt** im Ruhezustand (`graph.raf=0`), `wakeGraph()` startet sie bei Interaktion neu -> keine Dauer-60fps-Last mehr.
- [x] **Auto-Einpassen** (`fitGraphView`): Kamera zieht beim Aufbau sanft mit, bis das Layout ruht; bei manuellem Zoom/Pan (`_userMoved`) ausgesetzt.
- [x] Aufrufer nach Datenaenderung auf `setGraphVault(true)` umgestellt (Upload/Convert/Reindex).

### Verifikation Session 8
- [x] `node --check` des kompletten Inline-Scripts: OK. Klammern balanciert.
- [x] Physik headless mit echtem `physicsGraph` aus der Datei getestet (s.o.).
- [ ] **TODO Paul:** UI im Browser neu laden (Hard-Reload, da localStorage-Graph-Settings gecacht sind) und Graph live pruefen. Server-Neustart NICHT noetig (reine Front-End-Datei).

### Erweiterung Session 8b - Graph-Bedienung
- [x] **Hauptthemen-Filter** (Vault): Button "Filter" + Panel mit Checkboxen je Top-Level-Ordner, **Mehrfachauswahl**. `applyVaultFilter()` filtert aus dem Cache (gleiche Knotenobjekte -> Positionen bleiben). "alle"-Reset. Button leuchtet bei aktivem Filter.
- [x] **Index-Schalter** (Ego-Sicht): Button "Index" blendet Dateien mit "index" im Namen (case-insensitive, `isIndexFile`) aus/ein. Zustand in localStorage (`nexus.ego.index`).
- [x] **Hover = Fokus** statt Aufhellung: `onGraphMove` berechnet bei Hover-Wechsel die Nachbarschaft (`graph.hoverSet`). `frameGraph` laesst Hover-Knoten + verknuepfte normal, **dunkelt alle uebrigen ab** (globalAlpha 0.16 Knoten / 0.10 Kanten). Keine Vergroesserung/Aufhellung mehr.
- [x] Buttons modusabhaengig: Filter nur im Vault, Index nur in der Notiz-Sicht (`updateGraphChrome`).

### WICHTIG - Vorfall Session 8b: Edit-Tool hat index.html abgeschnitten
- Beim Editieren von `public/index.html` hat das Edit-Tool die Datei bei ~Zeile 1276 (mitten in `showCtx`, bei Template-Literals/Emojis) **abgeschnitten** - alles danach (Kontextmenue, Drag&Drop, Markitdown, Reindex, Vault-Mgmt, `init()`) war weg.
- Wiederhergestellt per `head -n 1275` + `cat >> ... << 'NEXUSEOF'` (bash-Heredoc). Datei jetzt 1382 Zeilen, `node --check` gruen, Ende korrekt (`init(); </script></body></html>`).
- **Lehre (vgl. bestehende Regel):** Grosse/sonderzeichenhaltige Bloecke in index.html NICHT mit dem Edit-Tool, sondern per bash-Heredoc schreiben. Nach jedem Edit an index.html `tail` + `node --check` der Script-Sektion pruefen.

### Naechste Schritte (offen, Session 8)
- Optional: echtes inkrementelles Hinzufuegen einzelner Knoten in den Cache (statt Voll-Rebuild bei force). Aktuell genuegt Cache + force-Rebuild.
- Optional: Anzahl gezeichneter Labels bei sehr grossen Graphen weiter begrenzen.

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
| 34d | 2026-06-15 | Aktivitäts-Panel unten rechts: Log-Schrift auf var(--accent-tx) (Uhrzeit gedimmt via color-mix), Puls-Punkte (.log-pulse) + grüner Live-Punkt (.live-dot) auf display:none; reine CSS; verify:html 2927 Zeilen gruen | - | - |
| 30 | 2026-06-15 | Suchfenster modernisiert: Such-Popup „Gruppiert & getypt" (Icon-Kacheln/Breadcrumb/Sektionen/Akzent-Leiste, neue pal-Helper) + Trefferseite „Karten" (search-head/result-card, crumbHtml, Akzent-Pill-Treffer); alte result-*-Klassen ersetzt; verify:html 2890 Zeilen gruen | - | - |
| 22 | 2026-06-12 | R9 Claude Usage-Widget: 5 Patches safe-edit (CSS/Statusbar/Popover-HTML/Esc-Handler/JS), 2 Backend-Proxy-Endpoints (/api/claude-usage + /api/claude-orgs), localStorage nexus.claudeAuth; verify:html 2367 Zeilen + 25/25 gruen | - | - |
| 21 | 2026-06-11 | R7 Einstellungs-Menü: Theme/Ordnerfarben/Vault-Pfad/Editor-Font/Graph-Default + vaultsRoot-Endpoint; 10 Patches safe-edit; verify:html 2210 Zeilen + 25/25 gruen | - | - |
| 20b | 2026-06-11 | R6a korrigiert: Tab-Splitscreen in die MITTE (#center-body/#note-pane2/#rz-center, openCenterSplit/closeCenterSplit/initCenterSplitDrop/initCenterResizer), alter Right-Panel-Overlay-Ansatz entfernt; rechtes Panel bleibt daneben; 8 Patches via safe-edit; verify:html 2100 Zeilen + 25/25 gruen | - | - |
| 20 | 2026-06-11 | R6 Splitscreen-Upgrade: R6b Panel-Sync (_panelPath-Guard, applyActivePanel/syncFromActivation/graphToMain in switchTab/updateActiveTab/wireRendered/newTab/closeTab) + R6a Tab-D&D Split-Preview (#split-preview Overlay, openSplitPreview/closeSplitPreview/initSplitDrop, Drop-Feedback); 16 Patches via safe-edit; verify:html 2070 Zeilen + 25/25 gruen | - | - |
| 19 | 2026-06-11 | R5 Sidebar-Farbfeld Variante B: isTop in makeFolderEl, folder-gradient CSS (color-mix Gradient), folder-label; verify:html 1937 Zeilen + 25/25 gruen |
| 18 | 2026-06-11 | R4 Tab-D&D-Reorder: _draggingTabId, draggable+data-tidx in renderTabBar, initTabDnd() (Event-Delegation, curId-Tracking), .tab.drop-target CSS; verify:html 1929 Zeilen + 25/25 gruen | - | - |
| 17 | 2026-06-11 | R2 Scrollbar (#1a1d2a/#3a3f55/#5a6080, 6px), R1 Checkbox-Toggle (_curNoteRaw+wireRendered+POST /api/save), R3 Custom Vault-Dropdown (toggleVaultDrop+CSS); verify:html 1892 Zeilen + 25/25 gruen | - | - |
| 16 | 2026-06-11 | macOS-Dots entfernt; Rechtes Panel: #right-toggle (Graph/Gliederung/Split), CSS-Modi per data-rmode, renderOutline(), bindScrollSpy() (rAF), Sync in wireRendered+openFile+init; verify:html+25/25 gruen | - | - |
| 15 | 2026-06-11 | Dateiuebersicht-Fixes: Electron-prompt()-Bug -> uiPrompt, refreshTree (Tree-State/Scroll erhalten), uiConfirm (themed), uiFolderPicker (Verschieben); Edit-Truncation erneut, per Python gefixt | - | - |
| 1 | 2026-06-10 | Scaffold | 60 | 79 |
| 2 | 2026-06-10 | Multi-Vault-Config, Indexer, Markitdown (Web-UI Drag&Drop, Markitdown) | 79 | ~95 |
| 2b | 2026-06-10 | better-sqlite3 -> node:sqlite (kein Compiler), Vault-Pfad auf D:\Knowledge-base direkt | 95 | ~97 |
| 3  | 2026-06-10 | Smoke-Tests (25/25), Bugfixes FTS/lineNo/backlinks, /api/reindex | ~97 | ~99 |
| 4  | 2026-06-10 | Setup PC (npm, markitdown), File-Watcher (chokidar), query-Tool, 32 Tests | ~15 | ~40 |
| 8  | 2026-06-11 | Graph-UI: Physik-Vorzeichenbug gefixt, Ego-Kreis fixiert, Hauptgraph-Cache + Render-Drossel | - | - |
| 8b | 2026-06-11 | Graph: Hauptthemen-Filter (Mehrfachauswahl), Index-Schalter (Ego), Hover-Fokus/Abdunklung; index.html-Truncation behoben | - | - |
| 5  | 2026-06-10 | P0: search FTS-Fix (Schema-Version + kein JOIN + buildFtsQuery), P1: patch-Tool, P2: Pagination | ~5 | ~25 |
| 6  | 2026-06-10 | P0 live verifiziert (search ok, Sonderzeichen ok); P2-Luecke gefunden+gefixt (offset in server.js); Sandbox down -> smoke.js offen | ~25 | ~30 |
| 7  | 2026-06-10 | smoke.js in Sandbox gelaufen: 48 bestanden, 0 Fehler. Test-Verifikation aus Session 5/6 abgeschlossen. Nur P3 offen. | ~30 | ~32 |
| 9  | 2026-06-11 | Dateiuebersicht: Kontextmenue (neu/umbenennen/verschieben/loeschen), Resizable Panes, Multi-Tab (Obsidian-Logik) | - | - |
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
