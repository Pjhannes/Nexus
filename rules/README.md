# Nexus – Regelwerk-Scaffold

Dieses Verzeichnis enthält das **generische Regelwerk**, mit dem Nexus ausgeliefert wird.
Es ist die Vorlage, die jeder Nutzer (auch Freunde, die Nexus bekommen) als Grundgerüst
übernimmt und dann **selbst anpasst**. Kein persönlicher Inhalt steht hier drin.

## Drei-Schichten-Modell

1. **Scaffold (hier, `D:\Nexus\rules\`)** – generische Regeln, versioniert, zentral aktualisierbar.
   Wird mit Nexus ausgeliefert. Enthält *keine* persönlichen Daten.
2. **Live-Kopie im Vault (`_System/`)** – wird beim ersten Start (bzw. manuell) aus dem Scaffold
   in den aktiven Vault kopiert. Diese Datei wird im Alltag gelesen und darf frei bearbeitet werden.
3. **Persönliche Overlay-Datei (`_System/Mein-Setup.md`)** – die eigenen Themen, Farben und
   Standard-Methoden. Getrennt vom Scaffold, damit ein Scaffold-Update die persönlichen Anpassungen
   **nie überschreibt** und ein neuer Nutzer mit einem leeren Overlay startet.

## Dateien

| Datei | Zweck |
|---|---|
| `Arbeitsweise.md` | Dauerhafte Arbeitsregeln (generisch). Quelle der Wahrheit für „wie arbeitet Claude". |
| `Session-Start.md` | Schnellreferenz für den Session-Einstieg (welche Tools, welche Pflicht-Routinen). |
| `Mein-Setup.template.md` | Leere Vorlage für die persönliche Overlay-Datei. |

## Anpassen – so einfach wie möglich

- **Regeln ändern** = Markdown bearbeiten. Direkt in der Nexus-UI (Notizeditor) oder jedem Editor.
- Abschnitte sind markiert: **🔒 STANDARD** = generischer Kern (behalten), **🔧 ANPASSEN** =
  hier trägt jeder Nutzer sein Eigenes ein.
- Claude liest die Regeln über die **MCP-`instructions`** des Nexus-Servers (zeigt auf
  `_System/Session-Start.md` im Vault). Keine Code-Änderung nötig, um Regeln zu ändern.

## Weitergabe an Freunde

Ein Freund bekommt Nexus inkl. dieses `rules/`-Ordners. Beim ersten Start kopiert er
`Arbeitsweise.md` + `Session-Start.md` nach `_System/` seines Vaults und `Mein-Setup.template.md`
nach `_System/Mein-Setup.md`. Danach passt er nur die **🔧-Abschnitte** und sein Overlay an –
der generische Kern bleibt und kann später durch eine neue Scaffold-Version aktualisiert werden.
