---
typ: persoenliches-overlay
status: aktiv
---

# Mein Setup – persönliche Anpassungen

> Diese Datei ergänzt `_System/Arbeitsweise.md` (das generische Scaffold) um **deine** Themen,
> Farben und Methoden. Sie wird bei einem Scaffold-Update **nicht überschrieben**.
> Kopiere diese Vorlage nach `_System/Mein-Setup.md` und fülle die Abschnitte.

## Über mich (für Regel 10 – Meta-Beobachtungen)
> Wer bist du, wie arbeitest du, was ist dir wichtig? Hier sammelt Claude Präferenzen und
> Verhaltensbeobachtungen. (Kann auch in eine eigene Profil-Notiz ausgelagert und hier verlinkt werden.)

-

## Themen & Zuordnung (für Regel 6a – Wissens-Extraktion)
> Welche Information gehört in welchen Ordner/welche Notiz?

| Thema / Stichwort | Ziel-Notiz |
|---|---|
| `<Thema>` | `<Pfad/zur/Notiz.md>` |

## Farbcode-Zuweisung (für Farbcode-System)
> Pro Thema eine feste Farbe. In Nexus zusätzlich in den UI-Ordnerfarben einstellen.

| Thema | Farbe | Hex |
|---|---|---|
| `<Thema>` | `<Farbe>` | `#______` |

## Pflicht-Strukturen (für Regel 11)
> Feste Ordnerbäume/Namensschemata für wiederkehrende Bereiche (Module, Projekte, Kunden).

```
<Bereich>/
├── 00 – Index.md
└── Dateien/
```

## Frontmatter-Schema (für Regel 20)
> Pflichtfelder für deine Übersichts-Notizen + Bereichs-Kürzel.

```yaml
---
typ: <…>
bereich: <…>
datum: YYYY-MM-DD
themen:
  - <…>
quelle: <…>
---
```

## Persönliche Standard-Methoden (für Regeln 17–18)
> Je wiederkehrender Methode ein Abschnitt: Auslöser → Vorgehen → Ausgabe-Datei/Struktur → Verlinkungen.

### <Name der Methode>
- **Auslöser:**
- **Vorgehen:**
- **Ausgabe:**

## Wiederkehrende Routinen (für Regeln 13c/16/23 – Scheduling)
> Welche Routinen sollen regelmäßig laufen, in welchem Takt, ausgelöst wodurch (Session-Start /
> Claude-Code-Agent / OS-Task-Scheduler)?

| Routine | Takt | Auslöser |
|---|---|---|
| `<z. B. Vault-Check>` | `<wöchentlich>` | `<manuell beim Session-Start>` |
