# Nexus – Bauen & Verteilen (Release-Handbuch)

Kurzanleitung, wie aus dem Quellcode (deiner **Entwickler-Version**) die fertigen,
gehärteten Installer für **Windows** und **macOS** entstehen und wie du sie als
**Update-Paket** über bestehende Installationen spielst.

> **Kein Auto-Update.** Ein „Update" = ein neuer, versionierter Installer, den du drüber
> installierst. Config/Index/Vault bleiben dabei erhalten (liegen im Nutzer-Datenordner,
> nicht im Programmordner).

---

## 0. Versionsnummer erhöhen (vor jedem Release)

```powershell
npm version patch    # 0.3.1 -> 0.3.2  (oder: minor / major)
```

Das aktualisiert `package.json` und legt einen Git-Tag `vX.Y.Z` an.

---

## 1. Windows-Installer (lokal, schnell)

Auf deinem Windows-PC:

```powershell
npm install         # nur beim ersten Mal / nach Dependency-Änderungen
npm run dist        # baut NSIS-Installer + Portable nach dist\
```

Ergebnis in `dist\`:
- `Nexus Setup X.Y.Z.exe`  → der Installer (Doppelklick, installiert nach `%LOCALAPPDATA%\Programs\Nexus`)
- `Nexus-X.Y.Z-portable.exe` → portable Variante (ohne Installation startbar)

Schnelltest ohne Installer (entpackte App): `npm run dist:dir` → `dist\win-unpacked\Nexus.exe`.

---

## 2. macOS-DMG (über GitHub Actions – kein eigener Mac nötig)

Eine **DMG** lässt sich nur auf macOS bauen. Das übernimmt der CI-Workflow
`.github/workflows/release.yml` auf einem macOS-Runner.

```powershell
git push                 # Code hochladen (privates Repo)
git push --tags          # Tag vX.Y.Z pushen  -> startet den Build
```

→ Actions baut **Windows + macOS** parallel und legt einen **Draft-Release** mit allen
Dateien an (`Nexus-X.Y.Z-arm64.dmg`, `Nexus-X.Y.Z-x64.dmg`, `*.zip`, Windows-Installer).
Draft im GitHub-Release-Tab prüfen → „Publish".

Ohne Tag: im Actions-Tab **„Run workflow"** → baut nur Artefakte (zum Testen).

> Apple-Silicon-Mac → `arm64`-DMG, Intel-Mac → `x64`-DMG.

---

## 3. Update einspielen (auf den festen Installationen)

- **Windows:** neuen `Nexus Setup X.Y.Z.exe` ausführen → installiert über die alte Version.
  Da `appId` gleich bleibt (`com.nexusapp.nexus`) und `deleteAppDataOnUninstall:false` gesetzt
  ist, bleiben Config + Suchindex in `%APPDATA%\Nexus` erhalten.
- **macOS:** neue `Nexus.app` aus der DMG nach `Programme/Applications` ziehen, „Ersetzen".
  Daten in `~/Library/Application Support/Nexus` bleiben erhalten.

---

## 4. macOS-Erststart (unsigniert)

Ohne Apple-Zertifikat blockt Gatekeeper den ersten Start. Einmalig:

- **Rechtsklick** auf `Nexus.app` → **Öffnen** → im Dialog **Öffnen** bestätigen, **oder**
- Terminal: `xattr -dr com.apple.quarantine /Applications/Nexus.app`

Danach startet die App normal. (Verschwindet vollständig, sobald ein Apple-Developer-Zertifikat
hinterlegt wird – siehe Abschnitt 6.)

---

## 5. Was steckt drin / Härtung

- Quellcode liegt in `app.asar` (kein loses Editieren im Programmordner).
- Electron-Fuses (`scripts/afterPack.cjs`): `RunAsNode` aus, `NODE_OPTIONS`/`--inspect` aus,
  Cookie-Verschlüsselung an, **`OnlyLoadAppFromAsar` an** (ignoriert untergeschobene Dateien).
- Keine persönlichen Daten im gebündelten Code; keine sichtbaren Electron-Hinweise
  (Fenster/Taskleiste/`Nexus.exe`/About = „Nexus").

## 6. Später nachrüstbar: Code-Signing (volle Fälschungssicherheit)

- **Windows:** OV/EV-Code-Signing-Zertifikat → `win.certificateFile` + `CSC_*`-Secrets; danach
  zusätzlich `EnableEmbeddedAsarIntegrityValidation` im afterPack einschalten (Integritäts-Resource
  wird von electron-builder bereits eingebettet).
- **macOS:** Apple Developer Program (99 $/Jahr) → `identity` setzen, Notarisierung über
  `APPLE_ID`/`APPLE_APP_SPECIFIC_PASSWORD`/`APPLE_TEAM_ID`-Secrets in der CI; dann entfällt der
  Gatekeeper-Workaround aus Abschnitt 4.
