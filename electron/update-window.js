// electron/update-window.js – eigenes, gestyltes Update-Fenster (ersetzt die nativen
// OS-Dialoge). Ein einziges, rahmenloses Fenster begleitet den ganzen Ablauf:
//   Hinweis ("herunterladen?") -> Fortschritt -> "installieren & neu starten?".
// Optik = Studio-Dunkel + Amber (public/update.html). Steuerung per IPC ueber preload.cjs.

import { BrowserWindow, ipcMain } from 'electron';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const HTML = join(__dir, '..', 'public', 'update.html');
const PRELOAD = join(__dir, 'preload.cjs');

// Erzeugt das Fenster und gibt einen Controller zurueck:
//   prompt({title,message,detail,buttons}) -> Promise<number>  (Index des Klicks, -1 wenn geschlossen)
//   progress(percent, label)               -> void              (Fortschrittsansicht)
//   close() / isAlive()
export function createUpdateWindow(parent) {
  const useParent = parent && !parent.isDestroyed();
  const win = new BrowserWindow({
    width: 460,
    height: 250,
    parent: useParent ? parent : undefined,
    modal: useParent,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    frame: false,
    backgroundColor: '#161514',
    show: false,
    title: 'Nexus Update',
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Nachrichten erst nach dem Laden senden (sonst gehen sie verloren).
  let ready = false;
  const queue = [];
  function send(channel, payload) {
    if (win.isDestroyed()) return;
    if (ready) win.webContents.send(channel, payload);
    else queue.push([channel, payload]);
  }
  win.webContents.once('did-finish-load', () => {
    ready = true;
    for (const [c, p] of queue) win.webContents.send(c, p);
    queue.length = 0;
    win.show();
  });
  win.loadFile(HTML);

  let pendingResolve = null;
  let closed = false;
  function resolvePending(value) {
    const r = pendingResolve;
    pendingResolve = null;
    if (r) r(value);
  }
  const onAction = (_e, index) => resolvePending(typeof index === 'number' ? index : -1);
  ipcMain.on('update:action', onAction);

  win.on('closed', () => {
    closed = true;
    ipcMain.removeListener('update:action', onAction);
    resolvePending(-1);
  });

  return {
    prompt(opts) {
      return new Promise((resolve) => {
        if (closed) { resolve(-1); return; }
        pendingResolve = resolve;
        send('update:view', { view: 'prompt', ...opts });
      });
    },
    progress(percent, label) {
      send('update:view', { view: 'progress', percent: Math.max(0, Math.min(100, percent || 0)), label });
    },
    close() {
      if (closed) return;
      closed = true;
      ipcMain.removeListener('update:action', onAction);
      resolvePending(-1);
      if (!win.isDestroyed()) win.close();
    },
    isAlive() { return !closed && !win.isDestroyed(); },
  };
}
