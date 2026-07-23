# Nexus – Bauen & Verteilen (Release-Handbuch)

Kurzanleitung, wie aus dem Quellcode ein neues, signiertes Tauri-Release entsteht
und wie bestehende Installationen es automatisch bekommen.

> **Es gibt Auto-Update.** Der In-App-Updater (`tauri-plugin-updater`) prüft ca. 3 s nach
> dem Start gegen die GitHub-Releases-API, fragt vor dem Download **und** vor dem
> Neustart, und installiert das signierte Paket direkt – kein manueller Installer-Download
> für Nutzer nötig. Config/Index/Vault bleiben dabei erhalten (liegen im Nutzer-Datenordner,
> nicht im Installationsordner).

---

## 0. Versionsnummer erhöhen (vor jedem Release)

```powershell
npm version patch    # 1.0.0 -> 1.0.1  (oder: minor / major)
```

Aktualisiert `package.json` (+ `package-lock.json`), committet und legt einen Git-Tag
`vX.Y.Z` an. `tauri.conf.json` zieht die Version automatisch aus `package.json`
(`"version": "../package.json"`) – keine zweite Stelle zum Pflegen.

**Eine Ausnahme:** `src-tauri/Cargo.toml` hat ein eigenes `version`-Feld, das Cargo für
sich selbst nutzt (Crate-Metadaten) und das `npm version` nicht anfasst. Für saubere
`cargo`-Metadaten manuell mitziehen:

```powershell
# Cargo.toml: version = "X.Y.Z" von Hand editieren, dann:
cd src-tauri
cargo check --release   # aktualisiert Cargo.lock
cd ..
git add src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "chore: Cargo.toml Version auf X.Y.Z"
```

Danach `git push && git push --tags`.

> **Robust gegen Vergessen:** Der CI-Workflow setzt die `package.json`-Version beim Build
> ohnehin **aus dem gepushten Tag**. Wichtig bleibt nur, dass der **Tag** die gewünschte
> Versionsnummer trägt (Format `vX.Y.Z`, z. B. `v1.0.1`).

---

## 1. Bauen (lokal, zum Testen)

```powershell
npm run tauri build
```

Baut Windows-NSIS (+ signierte Updater-Artefakte, sofern `TAURI_SIGNING_PRIVATE_KEY`
lokal als Umgebungsvariable gesetzt ist – sonst bricht nur der Signier-Schritt ab, der
NSIS-Installer selbst entsteht trotzdem und reicht zum Installtest).

Ergebnis: `src-tauri\target\release\bundle\nsis\Nexus_X.Y.Z_x64-setup.exe`

macOS lässt sich auf Windows nicht bauen (Cross-Compile fürs Signieren/Bundling reicht
nicht) – dafür immer den CI-Workflow nutzen (Abschnitt 2).

---

## 2. Release bauen + verteilen (über GitHub Actions)

```powershell
git push                 # Code hochladen
git push --tags          # Tag vX.Y.Z pushen -> startet den Build
```

→ `.github/workflows/tauri-release.yml` baut **Windows + macOS (arm64 UND x64)**
parallel, signiert die Updater-Artefakte (minisign, Secret `TAURI_SIGNING_PRIVATE_KEY`)
und legt einen **Draft-Release** mit allen Dateien + `latest.json` (Auto-Update-Feed) an.
Draft im GitHub-Release-Tab prüfen → „Publish". **Erst danach** sehen installierte Apps
das Update (der Updater fragt gegen `releases/latest`, Drafts zählen nicht).

Ohne Tag: im Actions-Tab **„Run workflow"** (workflow_dispatch) → baut nur Artefakte
zum Testen, ohne Release/Tag anzufassen.

> Tags `v0.*` lösen stattdessen den ALTEN Workflow (`release.yml`, Electron-Ära) aus –
> der ist mit 0.6.0 final abgeschlossen und wird nicht mehr gebraucht.

---

## 3. macOS-Erststart (unsigniert)

Ohne Apple-Zertifikat blockt Gatekeeper den ersten Start (App-Code-Signing ist bewusst
aus, siehe Abschnitt 5). Die App ist dabei **nicht** „beschädigt" – das ist nur die
Gatekeeper-Ablehnung einer nicht notarisierten, per Browser geladenen App
(`com.apple.quarantine`-Flag). Vorgehen:

1. DMG öffnen und `Nexus.app` **einzeln** per Drag nach `Programme`/`/Applications` ziehen.
   (Ein *einzelnes* Verschieben deaktiviert „App Translocation" dauerhaft – nicht mehrere
   Objekte gleichzeitig ziehen.)
2. Quarantäne-Flag entfernen – **der zuverlässigste Weg auf aktuellem macOS**, im Terminal:
   ```
   xattr -dr com.apple.quarantine /Applications/Nexus.app
   ```

> **macOS 15 „Sequoia" und neuer:** Apple hat den früheren **Rechtsklick → Öffnen**-Trick für
> nicht notarisierte Apps entfernt – er funktioniert nicht mehr zuverlässig. Alternativ zum
> Terminal: App einmal starten (wird blockiert), dann **Systemeinstellungen → Datenschutz &
> Sicherheit → „Trotzdem öffnen"** (Admin-Passwort, pro App einmalig).

Nach dem allerersten Start läuft der In-App-Updater ganz normal weiter (kein erneuter
Gatekeeper-Schritt bei Updates) – der Workaround entfällt vollständig erst mit
Apple-Developer-Zertifikat + Notarisierung (siehe Abschnitt 5).

---

## 4. Was steckt drin / Härtung

- Kein `asar`, kein Chromium-Bundle: die App ist eine schlanke Rust-Shell (Tauri/WebView2
  bzw. WKWebView) + ein gebündelter Node-Sidecar (`node.exe` + `resources/`) für UI-Server
  und MCP. Quellcode liegt offen im Installationsordner (kein loses Editieren *wirkt* sich
  aber aus, da nichts signiert/integritätsgeprüft ist – siehe Abschnitt 5 für die
  Nachrüst-Option).
- Updater-Artefakte sind **minisign-signiert** (`TAURI_SIGNING_PRIVATE_KEY`); ein
  Update, dessen Signatur nicht zum eingebetteten Public Key passt, wird abgelehnt.
- Keine persönlichen Daten im gebündelten Code; keine sichtbaren Tauri-Hinweise
  (Fenster/Taskleiste/`app.exe`/Über-Dialog = „Nexus").

## 5. Später nachrüstbar: App-Code-Signing (volle Fälschungssicherheit)

Aktuell bewusst aus (kein Zertifikat). Betrifft die *Binary selbst* (Windows
SmartScreen-Warnung, macOS Gatekeeper-Workaround aus Abschnitt 3) – unabhängig von der
oben beschriebenen Updater-Signatur, die schon aktiv ist.

- **Windows:** OV/EV-Code-Signing-Zertifikat → `tauri.conf.json` → `bundle.windows.certificateThumbprint`
  (oder `signCommand` für einen externen Signer) + `WIX`/`NSIS`-Signierung; verhindert die
  SmartScreen-„Computer wurde geschützt"-Warnung beim Erstinstall.
- **macOS:** Apple Developer Program (99 $/Jahr) → `bundle.macOS.signingIdentity` setzen,
  Notarisierung über `APPLE_ID`/`APPLE_PASSWORD`/`APPLE_TEAM_ID`-Secrets in der CI
  (`tauri-action` unterstützt das eingebaut); dann entfällt der Gatekeeper-Workaround aus
  Abschnitt 3 vollständig.
