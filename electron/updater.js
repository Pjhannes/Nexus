// electron/updater.js – Auto-Update der installierten Nexus-App.
//
// Zwei Wege, je nach Plattform:
//   - Windows: voll automatisch via electron-updater (laden + installieren). Der
//     Nutzer wird vor dem Download UND vor der Installation gefragt – es passiert
//     nichts ungefragt (autoDownload = false).
//   - macOS: nur Hinweis. Wir fragen die oeffentliche GitHub-Releases-API ab und
//     oeffnen bei einer neueren Version die Download-Seite im Browser. Echtes
//     Auto-Install ginge nur mit Apple-Signierung/Notarisierung (bewusst out of scope).
//
// Die Dialoge sind ein EIGENES, gestyltes Fenster (update.html, Studio-Dunkel + Amber)
// statt der nativen OS-Dialoge. Faellt auf den System-Dialog zurueck, falls das
// Fenster nicht erstellbar ist.
//
// Quelle ist das OEFFENTLICHE Repo Pjhannes/Nexus  ->  kein Token auf den Ziel-PCs.

import { app, dialog, shell } from 'electron';
import { createUpdateWindow } from './update-window.js';

const REPO = 'Pjhannes/Nexus';
const RELEASES_PAGE = `https://github.com/${REPO}/releases/latest`;
const API_LATEST = `https://api.github.com/repos/${REPO}/releases/latest`;

// "v0.3.7" / "0.3.7" -> [0,3,7]. Nicht-numerische Suffixe (z. B. "-beta") werden ignoriert.
function parseVersion(v) {
  return String(v || '').replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
}
// Ist remote echt neuer als local? (nur Major.Minor.Patch, reicht fuer unser Tag-Schema)
function isNewer(remote, local) {
  const a = parseVersion(remote);
  const b = parseVersion(local);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] || 0;
    const y = b[i] || 0;
    if (x !== y) return x > y;
  }
  return false;
}

// Controller fuer das gestylte Update-Fenster, mit Fallback auf den nativen Dialog.
function makeController(parent, log) {
  try {
    return createUpdateWindow(parent);
  } catch (e) {
    log('Update-Fenster nicht erstellbar -> System-Dialog:', e && e.message);
    return nativeController(parent);
  }
}
// Minimaler Ersatz mit derselben API, falls kein eigenes Fenster moeglich ist.
function nativeController(parent) {
  const p = () => (parent && !parent.isDestroyed() ? parent : null);
  let alive = true;
  return {
    async prompt(o) {
      const r = await dialog.showMessageBox(p(), {
        type: 'info', title: o.title, message: o.message, detail: o.detail,
        buttons: o.buttons, defaultId: 0, cancelId: (o.buttons || []).length - 1,
      });
      return r.response;
    },
    progress() {},
    close() { alive = false; },
    isAlive() { return alive; },
  };
}

// ── R25-Bruecke: Generationswechsel Electron (0.x) -> Tauri (>= 1.0.0) ────────
// electron-updater kann technisch NICHT auf die Tauri-App updaten (anderes
// Paketformat, keine latest.yml mehr). Sobald das neueste Release Major >= 1
// ist, zeigt die Electron-App deshalb einen Hinweis mit Download-Link statt
// des normalen Auto-Updates – auf ALLEN Plattformen. Gibt true zurueck, wenn
// der Generationsfall vorlag (dann keine weitere Update-Logik).
async function checkGenerationBridge(win, log) {
  let data;
  try {
    const resp = await fetch(API_LATEST, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Nexus-Updater' },
    });
    if (!resp.ok) { log('Bruecken-Check: HTTP', resp.status); return false; }
    data = await resp.json();
  } catch (err) {
    log('Bruecken-Check fehlgeschlagen:', err && err.message);
    return false;
  }
  const tag = data && data.tag_name;
  if (!tag || !isNewer(tag, app.getVersion())) return false;
  if ((parseVersion(tag)[0] || 0) < 1) return false;   // normales 0.x-Update -> alte Wege

  const c = makeController(win, log);
  const idx = await c.prompt({
    title: 'Nexus – neue Generation verfügbar',
    message: `Nexus ${String(tag).replace(/^v/i, '')} ist verfügbar.`,
    detail:
      `Installiert: ${app.getVersion()}.\n\n` +
      'Nexus ist auf eine neue, schlankere Technik umgestiegen. Dieses eine Mal ' +
      'bitte den neuen Installer von der Download-Seite laden und über die ' +
      'bestehende Version installieren – Konfiguration, Index und Vaults bleiben ' +
      'vollständig erhalten. Danach aktualisiert sich Nexus wieder von selbst.',
    buttons: ['Download-Seite öffnen', 'Später'],
  });
  c.close();
  if (idx === 0) shell.openExternal(RELEASES_PAGE);
  return true;
}

// macOS: schlanke Pruefung gegen die oeffentliche API, dann Link auf die Download-Seite.
async function checkMac(win, log) {
  let data;
  try {
    const resp = await fetch(API_LATEST, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Nexus-Updater' },
    });
    if (!resp.ok) { log('Update-Check (mac): HTTP', resp.status); return; }
    data = await resp.json();
  } catch (err) {
    log('Update-Check (mac) fehlgeschlagen:', err && err.message);
    return;
  }
  const tag = data && data.tag_name;
  if (!tag || !isNewer(tag, app.getVersion())) { log('Update-Check (mac): aktuell'); return; }

  const c = makeController(win, log);
  const idx = await c.prompt({
    title: 'Update verfügbar',
    message: `Version ${tag} ist verfügbar.`,
    detail:
      `Installiert: ${app.getVersion()}.\n\n` +
      'Lade die neue Version von der Download-Seite und installiere sie über die alte – ' +
      'deine Konfiguration, der Index und der Vault bleiben dabei erhalten.',
    buttons: ['Download-Seite öffnen', 'Später'],
  });
  c.close();
  if (idx === 0) shell.openExternal(RELEASES_PAGE);
}

// Windows: voll via electron-updater. Ein Fenster begleitet Hinweis -> Fortschritt -> Installation.
async function checkWin(win, log) {
  const mod = await import('electron-updater');
  // electron-updater ist CommonJS -> Named-Export liegt je nach Interop auf default oder direkt.
  const autoUpdater = (mod.default && mod.default.autoUpdater) || mod.autoUpdater;
  if (!autoUpdater) { log('electron-updater: autoUpdater nicht gefunden'); return; }

  autoUpdater.autoDownload = false;          // erst fragen, dann laden
  autoUpdater.autoInstallOnAppQuit = true;   // bereits geladenes Update spaetestens beim Beenden anwenden
  autoUpdater.logger = {
    info: (...a) => log('updater:', ...a),
    warn: (...a) => log('updater warn:', ...a),
    error: (...a) => log('updater error:', ...a),
    debug: () => {},
  };

  let ui = null;
  const ensureUi = () => { if (!ui || !ui.isAlive()) ui = makeController(win, log); return ui; };

  autoUpdater.on('update-available', async (info) => {
    const c = ensureUi();
    const idx = await c.prompt({
      title: 'Update verfügbar',
      message: `Version ${info && info.version} ist verfügbar.`,
      detail: `Installiert: ${app.getVersion()}.\n\nJetzt herunterladen?`,
      buttons: ['Herunterladen', 'Später'],
    });
    if (idx === 0) {
      c.progress(0, 'Wird heruntergeladen…');
      try { await autoUpdater.downloadUpdate(); }
      catch (e) { log('downloadUpdate fehlgeschlagen:', e && e.message); c.close(); ui = null; }
    } else {
      c.close(); ui = null;
    }
  });

  autoUpdater.on('download-progress', (p) => {
    if (ui && ui.isAlive()) ui.progress(Math.round((p && p.percent) || 0), 'Wird heruntergeladen…');
  });

  autoUpdater.on('update-downloaded', async (info) => {
    const c = ensureUi();
    const idx = await c.prompt({
      title: 'Update bereit',
      message: `Nexus ${info && info.version} wurde heruntergeladen.`,
      detail: 'Jetzt installieren und neu starten? Deine Daten bleiben erhalten.',
      buttons: ['Installieren & neu starten', 'Später'],
    });
    c.close(); ui = null;
    // Beim Beenden wird ohnehin installiert (autoInstallOnAppQuit). Auf Wunsch sofort:
    if (idx === 0) setImmediate(() => autoUpdater.quitAndInstall());
  });

  autoUpdater.on('update-not-available', () => log('updater: keine neue Version'));
  autoUpdater.on('error', (err) => {
    log('updater error:', err && err.message);
    if (ui) { ui.close(); ui = null; }
  });

  try { await autoUpdater.checkForUpdates(); }
  catch (e) { log('checkForUpdates fehlgeschlagen:', e && e.message); }
}

// Einstiegspunkt. win = Hauptfenster (Dialog-Eltern), darf null sein. log = Logger aus main.js.
export async function setupAutoUpdate(win, log = () => {}) {
  // Nur in der gepackten App sinnvoll: in Dev gibt es keine Releases/Signatur, im MCP-Modus
  // kein Fenster/keinen Nutzer (main.js ruft uns dort ohnehin nicht auf).
  if (!app.isPackaged) return;
  try {
    // R25: erst der Generationswechsel-Check (Tauri >= 1.0.0). Liegt er vor,
    // uebernimmt der Hinweis-Dialog – electron-updater wuerde die neuen
    // Artefakte ohnehin nicht verstehen.
    if (await checkGenerationBridge(win, log)) return;
    if (process.platform === 'win32') await checkWin(win, log);
    else if (process.platform === 'darwin') await checkMac(win, log);
    // Linux: kein Distributionsweg fuer Endnutzer -> bewusst nichts.
  } catch (err) {
    log('Auto-Update fehlgeschlagen:', err && err.message);
  }
}
