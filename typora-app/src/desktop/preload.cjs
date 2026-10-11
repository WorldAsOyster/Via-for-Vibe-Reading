'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('viaDesktop', {
  generateReview: date => ipcRenderer.invoke('desktop:review-generate', date),
  chooseReviewAnswer: (date, id, option) => ipcRenderer.invoke('desktop:review-choose', date, id, option),
  submitReview: date => ipcRenderer.invoke('desktop:review-submit', date),
  saveReviewReminder: time => ipcRenderer.invoke('desktop:review-reminder', time),
  askDailyReview: (date, text) => ipcRenderer.invoke('desktop:review-ask', date, text),
  getData: () => ipcRenderer.invoke('desktop:get-data'),
  authStatus: () => ipcRenderer.invoke('desktop:auth-status'),
  authSendCode: input => ipcRenderer.invoke('desktop:auth-send-code', input),
  authVerifyCode: input => ipcRenderer.invoke('desktop:auth-verify-code', input),
  authSignIn: input => ipcRenderer.invoke('desktop:auth-sign-in', input),
  authSignOut: () => ipcRenderer.invoke('desktop:auth-sign-out'),
  searchStatus: () => ipcRenderer.invoke('desktop:search-status'),
  openSource: id => ipcRenderer.invoke('desktop:open-source', id),
  removeSource: id => ipcRenderer.invoke('desktop:remove-source', id),
  toggleTodo: (sourceId, messageId, resolved) => ipcRenderer.invoke('desktop:toggle-todo', sourceId, messageId, resolved),
  exportTodos: (sourceId, person) => ipcRenderer.invoke('desktop:export-todos', sourceId, person),
  saveProfile: (name, email, signature, avatar) => ipcRenderer.invoke('desktop:save-profile', name, email, signature, avatar),
  saveAiKey: (provider, key) => ipcRenderer.invoke('desktop:save-ai-key', provider, key),
  setAiProvider: provider => ipcRenderer.invoke('desktop:set-ai-provider', provider),
  toggleTypora: enabled => ipcRenderer.invoke('desktop:toggle-typora', enabled),
  setTyporaShortcut: shortcut => ipcRenderer.invoke('desktop:set-typora-shortcut', shortcut),
  openLink: url => ipcRenderer.invoke('desktop:open-link', url),
  minimize: () => ipcRenderer.send('desktop:minimize'),
  maximize: () => ipcRenderer.send('desktop:maximize'),
  close: () => ipcRenderer.send('desktop:close'),
  onChanged: callback => ipcRenderer.on('desktop:changed', () => callback())
});
