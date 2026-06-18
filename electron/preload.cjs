// electron/preload.cjs – Preload (CommonJS, .cjs erzwingt CJS trotz "type":"module")
//
// Exponiert eine schmale, sichere Bruecke (contextBridge) fuer Wizard, Hilfe-Fenster
// und das Hauptfenster. Kein nodeIntegration im Renderer – nur diese Whitelist.
'use strict';
// R10: Bruecke fuer Wizard + Hilfe-Fenster.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('nexusAPI', {
  // Erster-Start-Assistent
  browseFolder:     ()     => ipcRenderer.invoke('wizard:browse'),
  defaultVaultPath: ()     => ipcRenderer.invoke('wizard:default-vault-path'),
  finishWizard:     (opts) => ipcRenderer.invoke('wizard:finish', opts),
  cancelWizard:     ()     => ipcRenderer.invoke('wizard:cancel'),
  // Hilfe / Einrichtung
  connectClaude:    ()     => ipcRenderer.invoke('help:connect-claude'),
  openHelp:         ()     => ipcRenderer.invoke('help:open'),
  openExternal:     (url)  => ipcRenderer.invoke('app:open-external', url),
  appVersion:       ()     => ipcRenderer.invoke('app:version'),
});
