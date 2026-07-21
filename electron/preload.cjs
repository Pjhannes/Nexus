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
  // Auto-Update-Fenster (update.html): Main steuert die Ansicht, Renderer meldet den Klick zurueck.
  onUpdateView:     (cb)   => ipcRenderer.on('update:view', (_e, data) => cb(data)),
  updateAction:     (index)=> ipcRenderer.send('update:action', index),
  // R24b: Piper-Neural-TTS fuer den Vortrag-Button (Status, Download, Synthese).
  piperStatus:      ()          => ipcRenderer.invoke('piper:status'),
  piperInstall:     (id)        => ipcRenderer.invoke('piper:install', id),
  piperDelete:      (id)        => ipcRenderer.invoke('piper:delete', id),
  piperSynth:       (text,opts) => ipcRenderer.invoke('piper:synth', text, opts),
  onPiperProgress:  (cb)        => ipcRenderer.on('piper:progress', (_e, p) => cb(p)),
});
