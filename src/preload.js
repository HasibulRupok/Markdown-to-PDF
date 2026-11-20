'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getSettings: () => ipcRenderer.invoke('get-settings'),
  setSetting: (key, value) => ipcRenderer.invoke('set-setting', key, value),
  saveFile: (args) => ipcRenderer.invoke('save-file', args),
  openDialog: () => ipcRenderer.invoke('open-dialog'),
  openPath: (p) => ipcRenderer.invoke('open-path', p),
  exportPdf: (args) => ipcRenderer.invoke('export-pdf', args),
  exportHtml: (args) => ipcRenderer.invoke('export-html', args),
  print: (args) => ipcRenderer.invoke('print', args),
  confirmDiscard: () => ipcRenderer.invoke('confirm-discard'),
  docState: (state) => ipcRenderer.send('doc-state', state),
  forceClose: () => ipcRenderer.send('force-close'),
  pathForFile: (file) => webUtils.getPathForFile(file),
  onMenu: (handler) => ipcRenderer.on('menu', (_e, action, payload) => handler(action, payload))
});
