'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('StudioDesktop', Object.freeze({
  saveProject: (json, suggestedName) => ipcRenderer.invoke('studio:save-project', json, suggestedName),
  openProject: () => ipcRenderer.invoke('studio:open-project'),
  exportImages: items => ipcRenderer.invoke('studio:export-images', items),
  saveImage: (dataUrl, name) => ipcRenderer.invoke('studio:save-image', dataUrl, name),
  saveVideo: (dataUrl, name) => ipcRenderer.invoke('studio:save-video', dataUrl, name),
  saveText: (text, name) => ipcRenderer.invoke('studio:save-text', text, name),
  copyText: text => ipcRenderer.invoke('studio:copy-text', text),
  getInfo: () => ipcRenderer.invoke('studio:info'),
  getUpdateState: () => ipcRenderer.invoke('studio:update-state'),
  configureUpdates: options => ipcRenderer.invoke('studio:update-configure', options),
  checkForUpdates: () => ipcRenderer.invoke('studio:update-check'),
  downloadUpdate: () => ipcRenderer.invoke('studio:update-download'),
  installUpdate: projectJson => ipcRenderer.invoke('studio:update-install', projectJson),
  finishClose: saved => ipcRenderer.send('studio:finish-close', saved)
}));

ipcRenderer.on('studio:command', (_event, command) => {
  if (['new', 'open', 'save', 'undo', 'redo', 'export', 'help', 'updates'].includes(command)) {
    window.dispatchEvent(new CustomEvent('studio-command', { detail: command }));
  }
});

ipcRenderer.on('studio:update-state', (_event, state) => {
  window.dispatchEvent(new CustomEvent('studio-update-state', { detail: state }));
});

ipcRenderer.on('studio:before-close', () => {
  window.dispatchEvent(new Event('studio-before-close'));
});
