# Nexus installieren & einrichten

Nexus verhält sich wie eine normale Windows-Anwendung: herunterladen, doppelklicken,
fertig. Kein CMD-Fenster, kein manuelles Node.js, kein Konfigurieren von Hand.
Der Ziel-PC braucht **kein Node.js** und keine Entwicklungsumgebung.

---

## Schnellstart (Ziel-PC)

1. **`Nexus Setup X.Y.Z.exe` herunterladen** (z. B. `Nexus Setup 0.3.2.exe`) und doppelklicken.
2. **SmartScreen-Hinweis:** Windows zeigt evtl. „Der Computer wurde durch Windows
   geschützt". Das ist normal bei noch nicht signierten Apps.
   → **„Weitere Informationen"** anklicken → **„Trotzdem ausführen"**.
3. **Installationsordner wählen** (oder Vorschlag übernehmen) → **Installieren**.
   Es werden keine Administratorrechte benötigt (Installation in den Benutzerordner).
4. Nexus startet automatisch und führt durch den **Einrichtungs-Assistenten:**
   - **Willkommen** → Weiter
   - **Vault-Speicherort wählen** – Vorschlag `Dokumente\Nexus Vaults` übernehmen
     oder per **„Durchsuchen…"** einen eigenen Ordner wählen.
   - **Einstellungen** – optional „beim Windows-Start automatisch starten", „jetzt
     starten", „Einrichtungs-Anleitung anzeigen" → **Fertigstellen**.
5. Das Nexus-Fenster öffnet sich – leerer Vault, voll funktionsfähig.
   In der Taskleiste erscheint das Nexus-Logo mit dem Namen „Nexus".

> **Portable Variante:** Statt des Installers kann `Nexus-X.Y.Z-portable.exe` einfach
> doppelgeklickt werden (z. B. vom USB-Stick) – ohne Installation. Der Einrichtungs-
> Assistent läuft genauso beim ersten Start.

Beim ersten Start legt Nexus automatisch an:
- eine frische Konfiguration unter `%APPDATA%\Nexus\nexus.config.json` (ohne fremde Inhalte),
- den gewählten Vault-Ordner mit einem leeren Vault `knowledge-base`.

---

## Inhalte hinzufügen

Vault-Inhalte werden **bewusst nicht** mitgeliefert. Den Vault füllst du so:
- Markdown-/PDF-/Office-Dateien per **Drag & Drop** ins Nexus-Fenster ziehen
  (Nicht-MD-Dateien per Rechtsklick → Markitdown nach `.md` konvertieren), **oder**
- Dateien direkt in den Vault-Ordner legen und in der UI „Reindex" drücken, **oder**
- über das `+` einen weiteren Vault anlegen / einen bestehenden Ordner als Vault eintragen.

---

## Claude-Desktop-Anbindung & Usage-Widget (in der App)

Beides ist direkt aus Nexus heraus eingerichtet – ohne CMD, ohne Dateien von Hand:

**Menü „Hilfe → Einrichtung & Usage-Key…"** öffnet ein Anleitungsfenster mit:

1. **„Mit Claude Desktop verbinden"** (ein Klick) – trägt Nexus als MCP-Server in
   `%APPDATA%\Claude\claude_desktop_config.json` ein (alte Datei wird als
   `…nexus-backup` gesichert). Der Eintrag startet **genau diese .exe** im MCP-Modus
   (`--mcp`) – darum ist auf dem Ziel-PC kein Node nötig.
   Danach **Claude Desktop komplett neu starten** (beenden + öffnen). Die Nexus-Tools
   (`search`, `read_note`, `write_note`, `backlinks`, `query`, `patch`, …) stehen dann bereit.
2. **Session-Key für das Usage-Widget** – Schritt-für-Schritt, wie man den
   `sessionKey` aus claude.ai (F12 → Application → Cookies → `https://claude.ai` →
   `sessionKey`) kopiert und unten rechts ins Verbrauchs-Widget einträgt. Org-ID per
   ⟳-Button automatisch. Der Key bleibt lokal (Browser-`localStorage`).

Dieselbe Anleitung erscheint auf Wunsch automatisch am Ende des Einrichtungs-Assistenten.

---

## Installer bauen (einmalig, auf dem Entwickler-PC)

Auf dem PC mit dem Repo `D:\Nexus` und Node.js:

```bash
cd D:\Nexus
npm install        # zieht electron, electron-builder, sharp, png-to-ico (devDependencies)
npm run dist       # baut den Windows-Installer (NSIS + portable)
```

Ergebnis in `D:\Nexus\dist\`:

| Datei | Was |
|---|---|
| `Nexus Setup X.Y.Z.exe` | NSIS-Installer (Ordnerwahl, Desktop-/Startmenü-Verknüpfung, Autostart nach Installation) |
| `Nexus-X.Y.Z-portable.exe` | Portable Variante – kein Installieren, direkt startbar |

Eine dieser Dateien kopierst du auf den Ziel-PC. Mehr nicht.

> `npm run dist` muss auf **Windows** laufen (NSIS-Target; in einer Linux-Sandbox nicht baubar).
> Das **App-Icon** liegt bereits fertig in `build/` – bei Bedarf neu erzeugen mit
> `npm run gen:icon` (nutzt `sharp` + `png-to-ico`).

---

## Wo liegt was (installierte App)

| Zweck | Ort |
|---|---|
| Programm | Installationsordner bzw. die portable `.exe` (read-only) |
| Konfiguration | `%APPDATA%\Nexus\nexus.config.json` |
| Such-Index (SQLite) | `%APPDATA%\Nexus\.nexus\*.db` (wegwerfbar, wird neu gebaut) |
| Upload-Temp | `%APPDATA%\Nexus\.nexus\tmp\` |
| Log | `%APPDATA%\Nexus\nexus.log` |
| Vault-Inhalte | gewählter Vault-Ordner (Standard `Dokumente\Nexus Vaults\<vault>\`) |
| Claude-Desktop-Anbindung | `%APPDATA%\Claude\claude_desktop_config.json` |

Im **Entwickler-Modus** (`npm run app` aus dem Repo) bleibt alles im Repo (`D:\Nexus`).
Die userData-Umleitung greift nur in der gepackten App.

---

## Zwei Betriebsarten – eine .exe

- **Doppelklick / Verknüpfung** → GUI-Modus: Web-UI im Fenster (beim 1. Start: Einrichtungs-Assistent).
- **`Nexus.exe --mcp`** → MCP-Modus: kein Fenster, spricht stdio mit Claude Desktop.
  Genau diesen Aufruf trägt „Mit Claude Desktop verbinden" ein.

---

## Troubleshooting

- **SmartScreen blockiert:** „Weitere Informationen" → „Trotzdem ausführen" (App ist nicht signiert).
- **Fenster bleibt leer:** Menü „Ansicht → Entwicklerwerkzeuge", Konsole prüfen.
- **Claude Desktop sieht Nexus nicht:** Claude Desktop wirklich beenden (Tray) und neu starten;
  prüfen, ob der `nexus`-Eintrag in `claude_desktop_config.json` auf die echte `.exe` zeigt.
- **Usage-Widget zeigt `— / —`:** Session-Key fehlt/abgelaufen → „Hilfe → Einrichtung & Usage-Key…" erneut durchgehen.
- **Suche/Index leer:** in der UI „Reindex" drücken (oder MCP-Tool `reindex`).
- **Wizard nochmal sehen (Test):** Nexus mit gesetzter Umgebungsvariable `NEXUS_FORCE_WIZARD=1` starten
  (überschreibt eine vorhandene Config nicht).
