---
typ: session-cheatsheet
scaffold-version: 1
status: aktiv
---

# Session-Start (Nexus) – Schnellreferenz

> Generisches Scaffold. Beim ersten Start nach `_System/Session-Start.md` im Vault kopieren und
> die 🔧-Abschnitte anpassen. Ergänzt – ersetzt nicht – die vollen Regeln in `_System/Arbeitsweise.md`.

## 🔒 STANDARD – Womit ich arbeite (Nexus-MCP-Tools)

Der Vault wird über die Nexus-MCP-Tools angesprochen – **nie raten, immer ein Tool nehmen.**

| Aufgabe | Nexus-Tool |
|---|---|
| Volltextsuche (FTS5), Snippet + Pfad | `search { q, limit, offset, tag }` |
| Datei nach Pfad-Prefix finden/auflisten | `list_notes { prefix, limit, offset }` |
| Notiz lesen (ganz / Abschnitt / N Zeilen) | `read_note { path, section, lines }` |
| Überschriften-Gerüst einer Notiz | `outline { path }` |
| Notiz schreiben / neu anlegen | `write_note { path, content, create }` |
| An Abschnitt anhängen (ohne Neuschreiben) | `append_to_section { path, section, text }` |
| Mehrere Stellen punktuell ersetzen | `patch { path, patches:[{old_str,new_str}] }` |
| Eingehende Links einer Notiz | `backlinks { path }` |
| Nach Frontmatter filtern (Properties/Tags/Status/Due) | `query { field, op, value }` |
| Index neu aufbauen | `reindex {}` |

> **Token-Disziplin (Kernprinzip):** erst `outline` / `search`-Snippet / `read_note section=…`,
> nicht blind ganze Dateien lesen. Schreiben bevorzugt mit `append_to_section` / `patch`.

## 🔧 ANPASSEN – Vault-Basispfad
`<DEIN-VAULT-PFAD>`  (z. B. der Ordner, den Nexus als aktiven Vault indexiert)

## 🔧 ANPASSEN – Themen-Index (direkte Pfade – nie suchen, wenn hier gelistet)

> Trage hier deine wichtigsten Hub-Notizen ein, damit Claude sie direkt öffnet statt zu suchen.

| Thema / Stichwort | Datei |
|---|---|
| `<Stichwort>` | `<Pfad/zur/Notiz.md>` |

> **Regel:** Steht das Thema oben → direkt `read_note` öffnen, nicht `search`.

## 🔒 STANDARD – Datei suchen (nie Pfad raten)

- Stichwort im Inhalt → `search { q: "BEGRIFF", limit: 20 }`
- Alles unter einem Ordner → `list_notes { prefix: "Ordner/" }`
- Nach Tag → `search { q: "...", tag: "tagname" }` oder `query { field: "tags", op: "contains", value: "tagname" }`
- Nach beliebigem Frontmatter → `query { field: "status", op: "=", value: "aktiv" }`
  (Operatoren: `=`, `!=`, `contains`, `exists`, `<`, `>`)

## 🔧 ANPASSEN – Wiederkehrende Session-Start-Routinen

> Eigene Pflicht-Routinen beim Session-Start hier eintragen (z. B. Deadlines abgleichen,
> Inbox prüfen). Beispiel-Routine – ersetzen oder löschen:
>
> 1. `read_note { path: "_System/Deadlines.md" }` → fällige Punkte in `START.md` spiegeln (via `patch`).

## 🔒 STANDARD – Regeln (Kurzform)

- **Datei finden**: `search` / `list_notes` – nie Pfad raten.
- **Neue Notiz**: Vorlage aus `_System/Templates/` per `read_note` holen, dann `write_note { create: true }`.
- **Konversationsende (PFLICHT)**: erst Erkenntnisse in die echten Vault-Notizen einpflegen,
  **dann** Konversationsarchiv anlegen (Regel 6 in `Arbeitsweise.md`).
- **Sofort-Speicher-Reflex**: jeder Fehler/jede Korrektur → sofort in den Vault, nicht aufschieben (Regel 0a).

→ `_System/Arbeitsweise.md` | `_System/Mein-Setup.md` | `START.md`
