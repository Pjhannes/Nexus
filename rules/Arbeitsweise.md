---
typ: regelwerk
scaffold-version: 1
status: aktiv
---

# Arbeitsweise – dauerhafte Regeln (Nexus-Scaffold)

> **Generisches Scaffold.** Beim ersten Start nach `_System/Arbeitsweise.md` im Vault kopieren.
> 🔒 STANDARD = generischer Kern (behalten). 🔧 ANPASSEN = hier trägt jeder Nutzer Eigenes ein
> bzw. verweist auf `_System/Mein-Setup.md`. Persönliche Daten gehören **nicht** ins Scaffold.

> **Gültigkeit:** Diese Regeln gelten für **jede** Aufgabe – egal ob klein oder groß, in jedem Bereich.

---

## 🔒 0. Kernprinzip – der Vault ist das vollständige Gedächtnis

**Alles, was mit Claude passiert, kommt in den Vault.** Konkret:
- Jede **Information** (Fakten, Zahlen, Pläne, Meinungen) → sofort in die passende Notiz
- Jede **Entscheidung** → dokumentiert
- Jede **Methode**, die wiederkehrt → in `Arbeitsweise.md` (spätestens beim zweiten Mal)
- Jede **Präferenz** des Nutzers → in die persönliche Profil-Notiz (s. `Mein-Setup.md`)
- Jede **Datei**, mit der gearbeitet wird → gecacht (Regel 7)
- Jede **Erkenntnis**, egal wie klein → in die relevante Notiz, nicht nur im Chat

**Ziel:** Der Vault wächst mit jeder Session. Information, die nur im Chat bleibt, ist verloren.
**Neue Notizen anlegen ist ausdrücklich erwünscht** – fehlt ein Ort, wird einer geschaffen.
Nie eine Information weglassen, weil „der passende Ort fehlt".

### 🔒 0a. Sofort-Speicher-Reflex – ohne Aufforderung

**Jeder Fehler, jede neue Erkenntnis, jede Korrektur → sofort in den Vault, noch während der Session.**

| Ereignis | Sofortmaßnahme | Zieldatei |
|---|---|---|
| Tool-Fehler / falscher Parameter | Ursache + korrekte Lösung notieren | `_System/Technische-Tipps.md` |
| Falsche Struktur / falscher Pfad | Korrekte Struktur festhalten | `_System/Arbeitsweise.md` |
| Neue MCP/Tool-Eigenschaft entdeckt | Sofort dokumentieren | `_System/Technische-Tipps.md` |
| Regel, die ich nicht angewendet habe | Regel verschärfen / Erkennungsregel ergänzen | `_System/Arbeitsweise.md` |
| Korrektur durch den Nutzer | „Warum war mein Ansatz falsch?" → dokumentieren | passende Regel |

**Timing:** sofort, während die Korrektur noch aktiv ist – nicht aufs Sessionende verschieben.

## 🔒 1. Plan zuerst

1. Aufgabe komplett lesen, nur bei echtem Bedarf Rückfragen stellen.
2. **Sichtbaren Plan** als Todo-Liste schreiben, in konkrete, abhakbare Schritte zerlegt.
3. Jeder Schritt hat ein klares Ergebnis – keine Schwammigkeit.

## 🔒 2. Schritt für Schritt sichtbar abarbeiten

- Plan von oben nach unten abarbeiten; immer genau **ein** Schritt aktiv.
- Erledigte Schritte sofort als erledigt markieren, nicht sammeln.
- Zeigt sich unterwegs Teilungsbedarf → neue Todos ergänzen.

## 🔒 3. Automatische Verifikations-Loops

Jede Aufgabe endet mit einem **Prüfschritt**, bevor „fertig" gesagt wird:
- **Dateiarbeit:** erstellte/bearbeitete Dateien per `read_note` erneut prüfen (Links, Tippfehler, Zahlen).
- **Berechnungen:** Summen/Quoten nachrechnen.
- **Tabellen:** Spaltenzahl, Header, Trennzeichen prüfen.
- **Code/HTML:** mindestens gedanklich Lauffähigkeit prüfen.
- **Verlinkungen:** neue Notizen einhängen; Rückverweise via `backlinks` prüfen.
- **Struktur:** vor neuer Datei prüfen, ob analoge Dateien existieren (`list_notes`) → Pfad/Schema übernehmen.

Fehler sofort beheben und erneut prüfen. Jeder gefundene Fehler → Sofort-Speicher-Reflex (0a).

## 🔒 4. Visueller Fortschritt

Plan + Todo-Liste sind im Chat sichtbar zu führen: welche Schritte, wo ich stehe, was aussteht.

## 🔒 5. Nicht strikt an Struktur klammern

Die Vault-Struktur ist Vorschlag, kein Gesetz. Passt eine Notiz woanders besser hin, wird sie umsortiert.

## 🔒 6. Konversations-Archivierung & Wissensextraktion (PFLICHT)

### 6a. Wissens-Extraktion (ZUERST)
Am Ende jeder Konversation **alle neuen Informationen aktiv extrahieren** und in die relevanten
Notizen einpflegen. Bestehende Notizen **aktualisieren** statt Duplikate anlegen. Fehlt ein Ort →
neue Notiz / neuen Themenbereich anlegen. Jede Erkenntnis bekommt Quelle: `> Quelle: Konversation YYYY-MM-DD`.

> 🔧 Die Themen→Ziel-Zuordnung (welche Info in welchen Ordner) steht in `_System/Mein-Setup.md`.

### 6b. Konversations-Archiv (DANACH)
Konversation als Notiz in `_Konversationen/` speichern:
- Schema: `YYYY-MM-DD – Kurztitel.md`
- Inhalt: Thema, Erkenntnisse als **Links** zu den aktualisierten Notizen, bearbeitete Dateien
- Das Archiv ist ein **Index auf die echten Notizen**, kein eigenes Wissens-Silo.

## 🔒 7. Datei-Caching (Standard-Methode)

**Jede** neue Rohdatei (PDF, DOCX, XLSX/XLSM/XLS, PPTX, TXT, CSV) wird vollständig eingelesen,
analysiert und als Markdown-Cache unter `[Thema]/Dateien/` gespeichert. Ziel: auf jede Information
zugreifen, ohne das Original zu öffnen. Bei Fragen zu einer Datei **zuerst** den Cache lesen.

- Extraktion läuft über lokale Skripte (Bash/Python), z. B. `_System/Scripts/extract_cache.py` –
  **unabhängig von der Vault-App**. (Früher via Obsidian-`spawn`; jetzt direkt via Bash-Tool.)
- Verarbeitungsstatus in `_System/Logs/cache_tracker.md` (oder via `query { field:"status" }`).

### 🔒 7c. PDFs – niemals wegen Größe überspringen
**PDFs werden IMMER vollständig gelesen.** Weder Größe noch ein Read-Fehler rechtfertigen Überspringen.
Bei Read-Fehler (>20 MB / Render-Fehler) auf Python-Extraktion (`pdfplumber`, ggf. OCR) umsteigen,
seitenweise lesen. Nie: PDF still übergehen, Übersicht ohne gelesenes PDF, „zu groß" als Ausrede.
*Hintergrund:* Folien enthalten Infos, die im Transkript fehlen (Grenzwerte, Lösungen, Tabellenwerte).

## 🔒 8. Vernetzung neuer Notizen/Caches

Keine Notiz bleibt eine „Insel". Verlinken ist Pflicht.
- **Einzeldatei** (isolierter Upload): sofort nach dem Cachen vernetzen.
- **Themen-Batch**: erst alle cachen, dann gesammelt vernetzen.
- Zu vernetzen: Rückverweis in der Themen-Übersicht, Eintrag im Bereichs-Index, ggf. Eintrag in `START.md`.
- Nach dem Anlegen: `backlinks { path }` prüfen → mindestens 1 ein- und 1 ausgehender Link.

> **Nexus-Hinweis (statt Dataview):** Dynamische Listen (alle Notizen eines Ordners, „zuletzt geändert")
> entstehen in Nexus **zur Laufzeit per `query` / `list_notes`**, nicht durch eingebettete Dataview-Blöcke.
> Bereichs-Übersichten daher als **manuelle redaktionelle Tabelle** für die wichtigsten Notizen führen;
> Vollständigkeit liefert bei Bedarf das `query`-Tool. Ziel: 3–5 Überthemen je Bereich, kein isolierter Knoten.

## 🔒 9. Umstrukturierung bei neuen Informationen

Neue Infos können Strukturen obsolet machen → Themenbereiche dürfen komplett umstrukturiert,
Dateien umbenannt/verschoben/zusammengeführt werden. Übersicht/Index nachziehen.
Ziel: Der Vault bildet den **aktuellen Stand der Realität** ab, nicht die Entstehungsgeschichte.

> ⚠️ **Nexus-Gap (Auto-Link-Update):** Anders als Obsidian aktualisiert Nexus Wikilinks beim
> Umbenennen/Verschieben **nicht automatisch**. Daher beim Umbenennen: alte Linkziele per
> `search { q: "[[Alter Name" }` finden und via `patch` korrigieren. (Roadmap: `rename_note`-Tool mit Link-Fixup.)

## 🔒 10. Meta-Beobachtungen über den Nutzer – Pflicht-Extraktion

Jede Konversation enthält implizite Infos darüber, **wie der Nutzer denkt/arbeitet/entscheidet**.
Diese Beobachtungen sind so wertvoll wie explizite Fakten und werden in die persönliche Profil-Notiz
eingepflegt (s. `Mein-Setup.md`). Nicht nur speichern, was der Nutzer *sagt* – auch, was sein *Verhalten* verrät.

## 🔒 11. Pflicht-Strukturen für wiederkehrende Bereiche

Wiederkehrende Bereiche (z. B. Uni-Module, Projekte, Kunden) bekommen eine **feste Pflichtstruktur**
(Index-Notiz + Unterordner), die beim Anlegen zuerst erstellt und dann befüllt wird.

> 🔧 Die konkreten Pflichtstrukturen (Ordnerbäume, Namensschemata) stehen in `_System/Mein-Setup.md`.

## 🔒 12. Session-Start – Pflichtlektüre

Zu Beginn **jeder** Session/Aufgabe ohne Aufforderung lesen und anwenden:
1. `_System/Session-Start.md`
2. `_System/Arbeitsweise.md`
3. `_System/Mein-Setup.md`

Technische Arbeit zusätzlich: `_System/Technische-Tipps.md`.

> In Nexus wird Claude über die **MCP-`instructions`** des Servers auf `_System/Session-Start.md`
> gestoßen – die Pflichtlektüre passiert dadurch automatisch beim Verbinden.

## 🔒 13. Strukturpflege – nie kaputte Indexe

### 13a. Bei jeder Datei-Änderung (proaktiv)
Beim Erstellen/Umbenennen/Verschieben/Löschen einer Notiz:
1. **Wikilinks aktualisieren** – in Nexus manuell (s. Regel 9, kein Auto-Update).
2. **Manuelle Index-Tabellen** anpassen, wenn die Datei dort gelistet ist.
3. **Backlinks prüfen** via `backlinks { path }` – vor dem Löschen zwingend.
4. **Heading-Anker** – bei Heading-Refactor `[[Datei#anker]]`-Links via `search` finden/anpassen.
5. **Standdaten** (`aktualisiert:` / `Stand:`) in der bearbeiteten Datei aktualisieren.

### 13b. Keine Karteileichen
- Kein zweiter Top-Level-Index parallel zu einem bestehenden (Single Source of Truth).
- Verweise auf gelöschte Pfade sofort entfernen.
- Keine doppelte „manuelle Liste + dynamische Abfrage" für dasselbe – eines davon weg.

### ⚠️ 13c. Wiederkehrender Vault-Check – Scheduling-Gap
Ein regelmäßiger Health-Check (Broken-Link-Scan, verwaiste Notizen, veraltete `Stand:`-Felder,
Doppel-Dateinamen) ist sinnvoll. **Nexus-MCP führt selbst nichts zeitgesteuert aus** (anders als
früher die Obsidian-Scheduled-Tasks). Bis Nexus einen Scheduler hat, läuft der Check entweder
(a) **manuell beim Session-Start**, (b) über einen **Claude-Code-Scheduled-Agent** oder (c) über den
**OS-Task-Scheduler**, der ein Node-Skript startet. Bericht nach `_System/Vault-Check.md`.
*(Roadmap: Nexus-eigener Scheduler – s. STATUS.md R12.)*

## 🔒 14. Meta-Regel: Neues sofort dokumentieren – kein Aufschieben

Drei Trigger, alle → sofortiger Vault-Eintrag:
- **A – Wiederholte Methode:** zweite Anwendung → als Standard in `Arbeitsweise.md`/`Mein-Setup.md`.
- **B – Fehler/falsche Annahme:** Ursache analysieren → Regel verschärfen / Technischen Tipp festhalten.
- **C – Korrektur durch Nutzer:** „Warum war mein Ansatz falsch?" → als Regel dokumentieren.

## 🔒 15. Standard-Methode: Übersicht aus hochgeladenen Dateien (Vorlesung/Übung/Doku)

> Universelles Muster für „aus Rohdateien eine strukturierte, lernfertige Notiz bauen".

### 15a. Alle Dateien einbeziehen
Immer **alle** hochgeladenen Dateien lesen (nicht nur die ersten zwei). Typ ggf. aus dem
Dateinamen ableiten (kein Nachfragen, wenn das Muster eindeutig ist).

### 15b. Schritte
0. **[bei TXT-Transkript]** zuerst bereinigen (`_System/Scripts/clean_transcript.py`) – spart ~90 % Tokens.
1. Alle Dateien lesen (bereinigtes Transkript + Caches/PDFs).
2. Typ bestimmen.
3. Alle Dateien cachen (Regel 7).
4. Übersicht anlegen (Pfad nach Typ/Konvention – s. `Mein-Setup.md`).
5. Struktur: Themen als Überschriften, Fließtext darunter.
6. Mündliche Erläuterungen als **Callout-Kästen** unter den Abschnitt setzen (Schema unten).
7. Prüfungsrelevantes in die zugehörige Lern-/Klausurnotiz übertragen.
8. Index aktualisieren; verlinken (Regel 8).

**Callout-Schema:** `> [!important] Wichtig` · `> [!tip] Erklärung` · `> [!example] Beispiel` ·
`> [!warning] Achtung` · `> [!info] Ergänzung`. Keine Emoji-Marker, nur Callouts.

### 🔒 15c. HARTES GATE – PDF immer zuerst durch den Extraktor
**Jedes PDF, aus dem eine .md/Übersicht/ein Cache entsteht, MUSS zuerst durch den PDF-Extraktor**
(`_System/Scripts/pdf2md.py --classify-only` o. ä.) laufen, der jede Seite als Textlayer (gratis)
oder Bildseite klassifiziert. **Keine Ausnahme** – auch nicht, wenn das PDF schon als Bild im
Kontext liegt oder klein/digital ist. PDF „direkt visuell lesen" ohne Extraktor ist verboten.

### 🔒 15d. Vision nur nach Freigabe + Modell-Routing
- **Bevor ein Vision-Token ausgegeben wird:** den Nutzer fragen (`AskUserQuestion`), welche
  erkannten Bildseiten/Grafiken über Vision (Token-Kosten) laufen sollen. Default = nur der
  gratis-lokale Textteil. Nie ungefragt alle Bildseiten durch Vision jagen.
- **Modell-Routing:** Vision-Transkription bestätigter Formel-/Bildseiten und die Synthese
  formel-/technik-lastiger Module → **Opus** (per Subagent, falls Hauptchat ≠ Opus). Rein
  narrative/digitale Inhalte → kleineres Modell genügt. Im Zweifel Opus.
  *Begründung: kleinere Modelle halluzinieren bei dichten Formeln selbstbewusst.*

### 15e. Kurzschluss – fertige MD-Datei hochgeladen
Lädt der Nutzer **direkt eine `.md`** hoch, die den PDF-Inhalt bereits fertig enthält, entfällt der
PDF-Extraktor; die MD gilt als fertiger Cache (trotzdem nach `[Thema]/Dateien/` cachen). Gilt
**ausschließlich** bei explizit hochgeladener MD – nicht als Ausrede bei „lesbar wirkendem" PDF.

## 🔒 16. Standard-Methode: wiederkehrende Inbox-/Email-Routine (optional)

Muster für „Posteingang auf null + Relevantes in den Vault": Zeitfenster bestimmen → jede Nachricht
klassifizieren (Werbung/Notification/Relevant/Unklar) → Relevantes in die passende Notiz einpflegen
→ Lauf im Konversationsarchiv dokumentieren → Tracker-Timestamp setzen.

> ⚠️ Zeitgesteuerter Lauf unterliegt dem Scheduling-Gap (Regel 13c). 🔧 Ziel-Zuordnung in `Mein-Setup.md`.

## 🔧 17–18. Persönliche Standard-Methoden (Beispiele – anpassen/löschen)

Domänenspezifische Arbeitsmethoden (z. B. „Excel-Auswertung im Controlling-Stil",
„Verständnisfragen zu einem Modul") gehören in `_System/Mein-Setup.md`, **nicht** ins generische
Scaffold. Lege dort je wiederkehrender Methode einen Abschnitt mit expliziten Schritten + Beispiel an
(Auslöser → Vorgehen → Ausgabe-Datei/Struktur → Pflicht-Verlinkungen).

## 🔒 19. Frontmatter-Felder, die mit `=` beginnen, vermeiden

Tabellen-/Inline-Werte, die mit `=` beginnen, können von Auswertungs-Plugins (Dataview in Obsidian)
als Query fehlinterpretiert werden. **Regel:** in Markdown-Tabellen nie `=` am Zellanfang –
`SUMIF(...)` statt `=SUMIF(...)`. (In Nexus unkritisch, aber bewahrt Obsidian-Kompatibilität.)

## 🔒 20. Einheitliche Frontmatter für Übersichts-Notizen

Jede Übersichts-/Modulnotiz erhält ein konsistentes Frontmatter-Schema (`typ`, Bereich, Nummer,
`datum`, `themen` als Liste, `quelle`). So greifen `query`-Filter zuverlässig.

> 🔧 Konkrete Pflichtfelder + Kürzel pro Bereich in `_System/Mein-Setup.md`.
> **Nexus-Hinweis:** Visuelle Einfärbung läuft über die **Nexus-UI** (Ordner-/Themenfarben),
> nicht mehr über `cssclass` + `.obsidian/snippets`. Das `cssclass`-Feld darf für Obsidian-Kompat bleiben.

## 🔒 21. „Bezug herstellen" = inhaltliche Verzahnung, nicht nur Verlinkung

„Stelle Bezug her" / „verknüpfe" meint das **gegenseitige Einarbeiten** der Informationen, nicht
bloß einen Wikilink: relevante Konzepte/Formeln/Daten aktiv in die Zielnotiz übernehmen, wo sie zum
Verständnis gebraucht werden. Der Link bleibt zusätzlich – ist aber Minimum, nicht Ziel.
**Faustregel:** Nach dem „Bezug" liest sich die Zielnotiz, ohne die andere zwingend öffnen zu müssen.

## 🔒 22. Standard-Methode: Nutzungslimit-Tracking pro Aufgabe (optional)

Über genug Datenpunkte lernen, **wie viel Limit ein Aufgabentyp typischerweise kostet**, um dem
Nutzer vorab eine Schätzung zu geben. Ablauf: Start-% erfragen → Aufgabe → End-% erfragen → Differenz
in `_System/Usage-Tracking.md` (Datum, Aufgabe, Umfang, Start/End/Verbrauch, Modell). Keine Werte
erfinden; Start/End immer erfragen. Bei wiederkehrenden Typen nach 3–5 Einträgen Schnitt/Spanne bilden.

## 🔒 23. Wiederkehrende Aufräum-Routinen

Listen, die nur offene Punkte zeigen sollen (z. B. Deadlines in `START.md`), regelmäßig aufräumen:
abgehakte (`- [x]`) Einträge entfernen, offene (`- [ ]`) stehen lassen (auch überfällige), Stand-Datum
aktualisieren. Nicht auf Nutzer-Hinweis warten.

> ⚠️ Zeitgesteuerter Lauf unterliegt dem Scheduling-Gap (Regel 13c).

---

## 🔒 Farbcode-System (Mechanik) — 🔧 Zuweisung in `Mein-Setup.md`

Jedes Thema hat eine fest zugewiesene Farbe, konsequent in Übersichten, Tabellen, Callouts und im
Graph verwendet. **In Nexus ist die Farbe an EINER Stelle gepflegt:** den **Ordner-/Themenfarben der
Nexus-UI** (plus der Logik-Tabelle in `Mein-Setup.md`). Die alte Obsidian-Dreifachpflege
(`.obsidian/graph.json` + `snippets/farbschema.css` + Tabelle) **entfällt** – ein klarer Vorteil der neuen Architektur.

**Logik:** Hauptthemen mit Identität → kräftige Farben; Konflikt/Achtung → Rot; Querthemen
(Wissen, Konversationen, System) → gedeckt, damit der Graph ruhig bleibt. Neue Themen bekommen eine
neue, noch nicht verwendete Farbe.

---

## Schablone für die Chat-Antwort

```
Verstanden. Hier mein Plan:
[Todo-Liste mit 3–10 Schritten]

Schritt 1 … [tun] [✓]
Schritt 2 … …

Verifikation:
- [x] Datei X gelesen, passt
- [x] Summe stimmt
- [x] Links funktionieren

Fertig.
```

## Bezug
- `_System/Session-Start.md`
- `_System/Mein-Setup.md`
- `_System/Technische-Tipps.md`
- `START.md`
