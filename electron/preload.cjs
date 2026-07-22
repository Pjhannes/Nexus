// electron/preload.cjs – Preload (CommonJS, .cjs erzwingt CJS trotz "type":"module")
//
// Exponiert eine schmale, sichere Bruecke (contextBridge) fuer Wizard, Hilfe-Fenster
// und das Hauptfenster. Kein nodeIntegration im Renderer – nur diese Whitelist.
'use strict';
// R10: Bruecke fuer Wizard + Hilfe-Fenster.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('nexusAPI', {
  // Erster-Start-Assistent (native Dialoge/Prozess-Lifecycle -> bleibt Electron-IPC,
  // bekommt in Phase 2 ein Tauri-Aequivalent)
  browseFolder:     ()     => ipcRenderer.invoke('wizard:browse'),
  defaultVaultPath: ()     => ipcRenderer.invoke('wizard:default-vault-path'),
  finishWizard:     (opts) => ipcRenderer.invoke('wizard:finish', opts),
  cancelWizard:     ()     => ipcRenderer.invoke('wizard:cancel'),
  // Hilfe-Fenster oeffnen (natives BrowserWindow -> bleibt Electron-IPC)
  openHelp:         ()     => ipcRenderer.invoke('help:open'),
  // Auto-Update-Fenster (update.html): Main steuert die Ansicht, Renderer meldet den Klick zurueck.
  onUpdateView:     (cb)   => ipcRenderer.on('update:view', (_e, data) => cb(data)),
  updateAction:     (index)=> ipcRenderer.send('update:action', index),
  // connectClaude/openExternal/appVersion/piper* entfallen seit Phase 1 – laufen als
  // REST-Endpunkte ueber den UI-Server (funktioniert identisch unter Electron und Tauri).
});
