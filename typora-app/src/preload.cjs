'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('via', {
  chooseDocument: () => ipcRenderer.invoke('document:choose'),
  openDocument: filePath => ipcRenderer.invoke('document:open', filePath),
  saveRecord: payload => ipcRenderer.invoke('record:save', payload),
  exportMarkdown: payload => ipcRenderer.invoke('export:markdown', payload),
  exportPdf: payload => ipcRenderer.invoke('export:pdf', payload),
  aiStatus: () => ipcRenderer.invoke('ai:status'),
  answer: payload => ipcRenderer.invoke('ai:answer', payload),
  openDesktop: () => ipcRenderer.send('desktop:show'),
  closeWindow: () => ipcRenderer.send('window:close'),
  minimizeWindow: () => ipcRenderer.send('window:minimize'),
  onLaunch: callback => {
    ipcRenderer.on('document:launched', (_event, payload) => callback(payload));
  },
  onAiChanged: callback => ipcRenderer.on('ai:changed', (_event, status) => callback(status))
});
