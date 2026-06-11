# Nexus auf einem anderen PC einrichten

Ziel: Nexus mit minimalem Aufwand auf einem fremden Windows-PC zum Laufen bringen
– **ohne** deine Vault-Inhalte, aber mit Aufbau, Verhalten und Claude-Desktop-Anbindung.
Der Ziel-PC braucht **kein Node.js** und keine Entwicklungsumgebung.

---

## Teil A – Installer bauen (einmalig, auf deinem Entwickler-PC)

Auf dem PC, der das Repo `D:\Nexus` und Node.js hat:

```bash
cd D:\Nexus
npm install        # zieht electron + electron-builder (devDependencies, ~300 MB)
npm run dist       # baut den Windows-Installer
```

Ergebnis in `D:\Nexus\dist\`:

| Datei | Was |
|---|---|
| `Nexus Setup 0.3.0.exe` | NSIS-Installer (installiert, legt Startmenue-/Desktop-Verknuepfung an) |
| `Nexus-0.3.0-portable.exe` | Portable Variante – kein Installieren, direkt startbar (z.B. vom USB-Stick) |

Eine dieser beiden Dateien kopierst du auf den Ziel-PC. Mehr nicht.

> Build-Hinweis: `npm run dist` muss auf **Windows** laufen (NSIS-Target). Vom
> Entwickler-PC aus reicht das – der Ziel-PC braucht nur die fertige `.exe`.

---

## Teil B – Auf dem fremden PC einrichten

### 1. Starten
- **Installer-Variante:** `Nexus Setup 0.3.0.exe` ausfuehren, Zielordner waehlen, fertig.
- **Portable-Variante:** `Nexus-0.3.0-portable.exe` einfach doppelklicken.

Beim **ersten Start** legt Nexus automatisch an:
- eine frische Konfiguration unter `%APPDATA%\Nexus\nexus.config.json` (ohne deine Inhalte),
- einen leeren Vault-Ordner unter `Dokumente\Nexus Vaults\knowledge-base\`.

Das Nexus-Fenster oeffnet sich mit der Web-UI – leerer Vault, voll funktionsfaehig.

### 2. Inhalte hinzufuegen
Vault-Inhalte werden **bewusst nicht** mitgeliefert. Du fuellst den Vault auf eine
dieser Arten:
- Markdown-/PDF-/Office-Dateien per **Drag & Drop** ins Nexus-Fenster ziehen
  (Nicht-MD-Dateien koennen per Rechtsklick → Markitdown nach `.md` konvertiert werden), **oder**
- Dateien direkt in `Dokumente\Nexus Vaults\knowledge-base\` ablegen und in der UI „Reindex" druecken, **oder**
- in der UI ueber das `+` einen weiteren Vault anlegen / einen bestehenden Ordner als Vault eintragen.

### 3. Mit Claude Desktop verbinden (1 Klick)
Im Nexus-Menue: **Nexus → „Mit Claude Desktop verbinden"**.

Das schreibt automatisch einen `nexus`-Eintrag in
`%APPDATA%\Claude\claude_desktop_config.json` (vorhandene Datei wird vorher als
`...nexus-backup` gesichert) und zeigt den Pfad an. Der Eintrag startet **genau diese
.exe** im MCP-Modus (`--mcp`) – darum ist auf dem Ziel-PC kein Node noetig.

Danach **Claude Desktop komplett neu starten** (beenden + neu oeffnen). Die Nexus-Tools
(`search`, `read_note`, `write_note`, `backlinks`, `query`, `patch`, …) stehen dann zur Verfuegung.

### 4. Deine Regeln (optional)
„Regeln" gibt es in zwei Sorten:
- **App-Verhalten** (MCP-Tools, Config-Struktur, Indexer, UI) – steckt in der `.exe`, kommt automatisch mit.
- **Vault-eigene Regeln** (z.B. `CLAUDE.md`, `_System/Arbeitsweise.md` in deinem Wissens-Vault) – das ist
  **Inhalt**. Wenn du sie auf dem neuen PC willst, kopierst du diese Dateien einmalig in den neuen Vault-Ordner.

---

## Wo liegt was (gepackte App)

| Zweck | Ort |
|---|---|
| Programm | Installationsordner bzw. die portable `.exe` (read-only) |
| Konfiguration | `%APPDATA%\Nexus\nexus.config.json` |
| Such-Index (SQLite) | `%APPDATA%\Nexus\.nexus\*.db` (wegwerfbar, wird neu gebaut) |
| Upload-Temp | `%APPDATA%\Nexus\.nexus\tmp\` |
| Vault-Inhalte | `Dokumente\Nexus Vaults\<vault>\` (frei verschiebbar, in Config eintragen) |
| Claude-Desktop-Anbindung | `%APPDATA%\Claude\claude_desktop_config.json` |

Im **Entwickler-Modus** (`npm run app` aus dem Repo) bleibt alles wie bisher: Config,
Index und Temp liegen in `D:\Nexus`. Die userData-Umleitung greift nur in der gepackten App.

---

## Zwei Betriebsarten – eine .exe

- **Doppelklick / Verknuepfung** → GUI-Modus: Web-UI im Fenster.
- **`Nexus.exe --mcp`** → MCP-Modus: kein Fenster, spricht stdio mit Claude Desktop.
  Genau diesen Aufruf traegt „Mit Claude Desktop verbinden" ein.

---

## Troubleshooting

- **Fenster bleibt leer:** Menue „Ansicht → DevTools", Konsole pruefen.
- **Claude Desktop sieht Nexus nicht:** Claude Desktop wirklich beenden (Tray) und neu starten;
  pruefen, ob der `nexus`-Eintrag in `claude_desktop_config.json` auf die echte `.exe` zeigt.
- **Suche/Index leer:** in der UI „Reindex" druecken (oder MCP-Tool `reindex`).
- **Mermaid/Math zeigen nur Quelltext:** brauchen Internet (CDN); sonst Fallback auf Rohtext.
