'use strict';

const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('viaPdf', { save: () => ipcRenderer.invoke('pdf:save') });
