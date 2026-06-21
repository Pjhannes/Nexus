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
// Quelle ist das OEFFENTLICHE Repo Pjhannes/Nexus  ->  kein Token auf den Ziel-PCs.

import { app, dialog, shell } from 'electron';

const REPO = 'Pjhannes/Nexus';
const RELEASES_PAGE = `https://github.com/${REPO}/releases/latest`;
const API_LATEST = `https://api.github.com/repos/${REPO}/releases/latest`;

// "v0.3.7" / "0.3.7" -> [0,3,7]. Nicht-numerische Suffixe (z. B. "-beta") werden ignoriert.
function parseVersion(v) {
  return String(v || '').replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
}
// Ist remote echt neuer als local? (nur Major.Minor.Patch, reicht fuer unseren Tag-Schema)
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

// macOS: schlanke Prüfung gegen die oeffentliche API, dann Link auf die Download-Seite.
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

  const r = await dialog.showMessageBox(win && !win.isDestroyed() ? win : null, {
    type: 'info',
    title: 'Update verfügbar',
    message: `Eine neue Version von Nexus ist verfügbar (${tag}).`,
    detail:
      `Installiert: ${app.getVersion()}.\n\n` +
      'Lade die neue Version von der Download-Seite und installiere sie über die alte – ' +
      'deine Konfiguration, der Index und der Vault bleiben dabei erhalten.',
    buttons: ['Download-Seite öffnen', 'Später'],
    defaultId: 0,
    cancelId: 1,
  });
  if (r.response === 0) shell.openExternal(RELEASES_PAGE);
}

// Windows: voll via electron-updater.
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

  const parent = () => (win && !win.isDestroyed() ? win : null);

  autoUpdater.on('update-available', async (info) => {
    const r = await dialog.showMessageBox(parent(), {
      type: 'info',
      title: 'Update verfügbar',
      message: `Eine neue Version von Nexus ist verfügbar (${info && info.version}).`,
      detail: `Installiert: ${app.getVersion()}.\n\nJetzt herunterladen?`,
      buttons: ['Herunterladen', 'Später'],
      defaultId: 0,
      cancelId: 1,
    });
    if (r.response === 0) {
      try { await autoUpdater.downloadUpdate(); }
      catch (e) { log('downloadUpdate fehlgeschlagen:', e && e.message); }
    }
  });

  autoUpdater.on('update-downloaded', async (info) => {
    const r = await dialog.showMessageBox(parent(), {
      type: 'info',
      title: 'Update bereit',
      message: `Nexus ${info && info.version} wurde heruntergeladen.`,
      detail: 'Jetzt installieren und neu starten? Deine Daten bleiben erhalten.',
      buttons: ['Installieren & neu starten', 'Später'],
      defaultId: 0,
      cancelId: 1,
    });
    // Beim Beenden wird ohnehin installiert (autoInstallOnAppQuit). Auf Wunsch sofort:
    if (r.response === 0) setImmediate(() => autoUpdater.quitAndInstall());
  });

  autoUpdater.on('update-not-available', () => log('updater: keine neue Version'));
  autoUpdater.on('error', (err) => log('updater error:', err && err.message));

  try { await autoUpdater.checkForUpdates(); }
  catch (e) { log('checkForUpdates fehlgeschlagen:', e && e.message); }
}

// Einstiegspunkt. win = Hauptfenster (Dialog-Eltern), darf null sein. log = Logger aus main.js.
export async function setupAutoUpdate(win, log = () => {}) {
  // Nur in der gepackten App sinnvoll: in Dev gibt es keine Releases/Signatur, im MCP-Modus
  // kein Fenster/keinen Nutzer (main.js ruft uns dort ohnehin nicht auf).
  if (!app.isPackaged) return;
  try {
    if (process.platform === 'win32') await checkWin(win, log);
    else if (process.platform === 'darwin') await checkMac(win, log);
    // Linux: kein Distributionsweg fuer Endnutzer -> bewusst nichts.
  } catch (err) {
    log('Auto-Update fehlgeschlagen:', err && err.message);
  }
}
