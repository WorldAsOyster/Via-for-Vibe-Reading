'use strict';

const { app, BrowserWindow, dialog, ipcMain, screen, safeStorage, shell, Tray, Menu } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { execFile, spawn } = require('node:child_process');
const { DocumentStore } = require('./store.cjs');
const { buildPdfHtml } = require('./pdf.cjs');
const { DeepSeekSettings, answerWithDeepSeek } = require('./deepseek.cjs');
const { OpenAISettings, answerWithOpenAI } = require('./openai.cjs');
const { DesktopSettings } = require('./desktop-settings.cjs');
const { DEFAULT_TYPORA_SHORTCUT } = require('./shortcut.cjs');
const { deriveDesktopData, mentions, buildTodoMarkdown } = require('./desktop-data.cjs');
const releaseInfo = require('./release-info.cjs');
const { CloudAuth } = require('./cloud-auth.cjs');
const { DailyReview, dayKey } = require('./daily-review.cjs');
const { installExamples } = require('./onboarding.cjs');
const { protectNavigation, requireDesktopSender } = require('./navigation.cjs');
const { pathToFileURL } = require('node:url');

// Keep the development and installed builds on the same local record directory.
app.setPath('userData', process.env.VIA_TEST_USER_DATA || path.join(app.getPath('appData'), 'via-local-markdown'));

let window;
let desktopWindow;
let store;
let deepSeek;
let openAI;
let cloudAuth;
let dailyReview;
let desktopSettings;
let reminderTimer;
let tray;
let pdfWindow;
let pdfExportName = null;
let activeDocumentPath = null;
const openedDocumentPaths = new Set();
let launchPending = null;
let launchSequence = 0;
let rendererReady = false;
let dockState = null;
let hotkeyProcess = null;
let hotkeyBinding = null;
let hotkeyLaunchPending = false;
let focusingFromTypora = false;

const wantsDesktop = argv => argv.includes('--via-desktop');

function notifyDesktop() {
  if (desktopWindow && !desktopWindow.isDestroyed()) desktopWindow.webContents.send('desktop:changed');
}
function localSources() { return store.list(); }
function allSources() { return localSources(); }
function recordsChanged() { notifyDesktop(); }

function argumentPath(argv) {
  const tagged = argv.find(value => value.startsWith('--via-document='));
  if (tagged) return tagged.slice('--via-document='.length);
  const index = argv.indexOf('--document');
  const next = index >= 0 ? argv[index + 1] : null;
  if (next && !next.startsWith('--')) return next;
  return argv.findLast(value => /\.(md|markdown)$/i.test(value)) || null;
}

function readTyporaSelection(documentName) {
  if (process.platform !== 'win32') return Promise.resolve({ text: '', windowHandle: 0, windowBounds: null });
  const script = path.join(__dirname, 'windows-selection.ps1');
  return new Promise(resolve => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-DocumentName', documentName],
      { windowsHide: true, timeout: 5000, maxBuffer: 256 * 1024 },
      (error, stdout) => {
        if (error) return resolve({ text: '', windowHandle: 0, windowBounds: null });
        try {
          const result = JSON.parse(stdout.trim());
          resolve({
            text: typeof result.text === 'string' ? result.text.trim() : '',
            windowHandle: Number(result.windowHandle) || 0,
            windowBounds: result.windowBounds || null
          });
        } catch {
          resolve({ text: '', windowHandle: 0, windowBounds: null });
        }
      });
  });
}

function runLayout(args) {
  const script = path.join(__dirname, 'windows-layout.ps1');
  return new Promise(resolve => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, ...args],
      { windowsHide: true, timeout: 5000, maxBuffer: 32 * 1024 },
      (error, stdout) => {
        if (error) return resolve({ ok: false });
        try { resolve(JSON.parse(stdout.trim())); } catch { resolve({ ok: false }); }
      });
  });
}

async function restoreTypora() {
  if (!dockState) return;
  const { handle, original, assigned } = dockState;
  dockState = null;
  await runLayout([
    '-Mode', 'restore', '-Handle', String(handle),
    '-X', String(assigned.x), '-Y', String(assigned.y),
    '-Width', String(assigned.width), '-Height', String(assigned.height),
    '-OriginalX', String(original.x), '-OriginalY', String(original.y),
    '-OriginalWidth', String(original.width), '-OriginalHeight', String(original.height),
    '-WasMaximized', String(Boolean(original.maximized))
  ]);
}

async function dockTypora(selection) {
  if (!selection.windowHandle || !selection.windowBounds || !window) return;
  // Dock only when associating a different Typora window. Repeated annotations
  // must not restore and resize the window, even if the user moved it.
  if (dockState?.handle === selection.windowHandle) return;
  await restoreTypora();
  const area = screen.getDisplayMatching(selection.windowBounds).workArea;
  const sideWidth = window.getBounds().width;
  const gap = 8;
  if (area.width < sideWidth + 600 + gap) return;
  const assigned = { x: area.x, y: area.y, width: area.width - sideWidth - gap, height: area.height };
  const result = await runLayout([
    '-Mode', 'dock', '-Handle', String(selection.windowHandle),
    '-X', String(assigned.x), '-Y', String(assigned.y),
    '-Width', String(assigned.width), '-Height', String(assigned.height)
  ]);
  if (!result.ok || !result.original) return;
  dockState = { handle: selection.windowHandle, original: result.original, assigned };
  window.setBounds({
    x: area.x + assigned.width + gap, y: area.y,
    width: sideWidth, height: area.height
  });
}

function stopTyporaHotkey() {
  const child = hotkeyProcess;
  hotkeyProcess = null;
  hotkeyBinding = null;
  hotkeyLaunchPending = false;
  if (child && !child.killed) child.kill();
}

function startTyporaHotkey(handle, documentPath) {
  if (process.platform !== 'win32' || !handle) return;
  const identity = path.resolve(documentPath).toLowerCase();
  const shortcut = desktopSettings.read().typoraShortcut || DEFAULT_TYPORA_SHORTCUT;
  if (hotkeyProcess && hotkeyBinding?.handle === handle && hotkeyBinding.identity === identity && hotkeyBinding.shortcut === shortcut) return;
  stopTyporaHotkey();
  const script = path.join(__dirname, 'typora-hotkey.ps1');
  const child = spawn('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script,
    '-Handle', String(handle), '-DocumentName', path.basename(documentPath),
    '-ParentProcessId', String(process.pid), '-Shortcut', shortcut
  ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  hotkeyProcess = child;
  hotkeyBinding = { handle, identity, documentPath, shortcut };
  let pendingOutput = '';
  child.stdout.on('data', chunk => {
    if (hotkeyProcess !== child) return;
    pendingOutput += chunk.toString('utf8');
    const lines = pendingOutput.split(/\r?\n/);
    pendingOutput = lines.pop();
    for (const line of lines) {
      if (!line.startsWith('HOTKEY\t') || hotkeyLaunchPending) continue;
      const [, encoded = '', x, y, width, height] = line.trim().split('\t');
      const bounds = [x, y, width, height].map(Number);
      const selection = {
        text: Buffer.from(encoded, 'base64').toString('utf8').trim(),
        windowHandle: handle,
        windowBounds: bounds.every(Number.isFinite) && bounds[2] > 0 && bounds[3] > 0
          ? { x: bounds[0], y: bounds[1], width: bounds[2], height: bounds[3] }
          : null
      };
      hotkeyLaunchPending = true;
      launchDocument(documentPath, { fastShortcut: true, selectionOverride: selection })
        .finally(() => { hotkeyLaunchPending = false; });
    }
  });
  child.stderr.on('data', () => {});
  child.on('error', () => { if (hotkeyProcess === child) stopTyporaHotkey(); });
  child.on('exit', () => {
    if (hotkeyProcess === child) {
      hotkeyProcess = null;
      hotkeyBinding = null;
    }
  });
}

async function keepTyporaBesideVia() {
  if (!dockState || !window || window.isDestroyed() || !window.isFocused()) return;
  const handle = dockState.handle;
  const result = await runLayout(['-Mode', 'raise', '-Handle', String(handle)]);
  if (result.ok && dockState?.handle === handle && window && !window.isDestroyed() && window.isFocused()) {
    window.moveTop();
  }
}

async function launchDocument(filePath, { fastShortcut = false, selectionOverride = null } = {}) {
  const sequence = ++launchSequence;
  try {
    if (hotkeyBinding && path.resolve(filePath).toLowerCase() !== hotkeyBinding.identity) stopTyporaHotkey();
    const existingSidecar = Boolean(window && !window.isDestroyed());
    if (!window || window.isDestroyed()) createWindow();
    const initialDocument = store.open(filePath);
    const selection = selectionOverride || await readTyporaSelection(initialDocument.name);
    if (sequence !== launchSequence) return;
    // Ctrl+S may complete while the selection request is in flight. Reopen the
    // file now so only the newest saved source reaches the renderer.
    const document = store.open(filePath);
    const comparable = value => String(value || '').replace(/[\s\u200B-\u200D\uFEFF*_~`]/gu, '');
    if (fastShortcut && selection.text &&
        !comparable(document.content).includes(comparable(selection.text))) {
      stopTyporaHotkey();
      dialog.showMessageBox({
        type: 'warning',
        message: '当前选区与已关联的文档不匹配',
        detail: '请在 Typora 中通过「文件 → 导出 → 问 Via」重新关联当前文档。'
      });
      return;
    }
    const sameAssociatedWindow = existingSidecar && selection.windowHandle &&
      hotkeyBinding?.handle === selection.windowHandle &&
      hotkeyBinding.identity === path.resolve(document.documentPath).toLowerCase();
    if (!sameAssociatedWindow) await dockTypora(selection);
    if (sequence !== launchSequence) return;
    if (selection.windowHandle) startTyporaHotkey(selection.windowHandle, document.documentPath);
    activeDocumentPath = document.documentPath;
    openedDocumentPaths.add(document.documentPath);
    const payload = { ...document, selectedText: selection.text };
    // Typora is already in front when its shortcut opens Via. Raising both
    // windows again here causes an unnecessary visible focus shuffle.
    focusingFromTypora = true;
    if (window?.isMinimized()) window.restore();
    window?.show();
    window?.focus();
    setTimeout(() => { focusingFromTypora = false; }, 300);
    if (!rendererReady) launchPending = payload;
    else window?.webContents.send('document:launched', payload);
    notifyDesktop();
  } catch (error) {
    if (sequence !== launchSequence) return;
    dialog.showErrorBox('无法打开文档', error.message);
  }
}

function createWindow() {
  const area = screen.getPrimaryDisplay().workArea;
  const height = Math.min(area.height - 24, 900);
  window = new BrowserWindow({
    width: 360,
    minWidth: 340,
    height,
    minHeight: 480,
    x: area.x + area.width - 372,
    y: area.y + 12,
    frame: false,
    backgroundColor: '#ffffff',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  protectNavigation(window.webContents, url => shell.openExternal(url));
  window.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  window.webContents.on('did-start-loading', () => { rendererReady = false; });
  window.webContents.on('did-finish-load', () => {
    rendererReady = true;
    if (launchPending) {
      window.webContents.send('document:launched', launchPending);
      launchPending = null;
    }
  });
  window.on('close', async event => {
    if (!dockState) return;
    event.preventDefault();
    await restoreTypora();
    window.destroy();
  });
  window.on('closed', () => { window = null; });
  window.on('focus', () => {
    if (!focusingFromTypora) keepTyporaBesideVia().catch(() => {});
  });
}

function createDesktopWindow() {
  if (desktopWindow && !desktopWindow.isDestroyed()) {
    desktopWindow.show();
    desktopWindow.focus();
    return;
  }
  desktopWindow = new BrowserWindow({
    width: 1220,
    height: 790,
    minWidth: 760,
    minHeight: 560,
    frame: false,
    backgroundColor: '#fffefa',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'desktop', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  protectNavigation(desktopWindow.webContents, url => shell.openExternal(url));
  desktopWindow.loadFile(path.join(__dirname, 'desktop', 'index.html'));
  desktopWindow.once('ready-to-show', () => desktopWindow?.show());
  desktopWindow.on('closed', () => { desktopWindow = null; });
}

app.setAppUserModelId('com.worldasoyster.via.localmarkdown');
const singleInstance = app.requestSingleInstanceLock();
app.on('will-quit', stopTyporaHotkey);
app.on('will-quit', () => clearInterval(reminderTimer));
if (!singleInstance) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    if (wantsDesktop(argv)) {
      createDesktopWindow();
      return;
    }
    const filePath = argumentPath(argv);
    if (filePath) {
      if (!desktopSettings.read().typoraEnabled) {
        dialog.showMessageBox({ type: 'info', message: 'Typora 接入已在 Via 设置中暂停' });
      } else launchDocument(filePath);
    }
    else {
      createDesktopWindow();
    }
  });

  app.whenReady().then(async () => {
    store = new DocumentStore(path.join(app.getPath('userData'), 'documents'));
    deepSeek = new DeepSeekSettings(app.getPath('userData'), safeStorage);
    openAI = new OpenAISettings(app.getPath('userData'), safeStorage);
    cloudAuth = new CloudAuth(app.getPath('userData'), safeStorage, { changed: notifyDesktop });
    desktopSettings = new DesktopSettings(app.getPath('userData'));
    desktopSettings.read();
    dailyReview = new DailyReview(app.getPath('userData'), {
      sources: localSources, changed: notifyDesktop,
      answer: (payload, options) => desktopSettings.read().aiProvider === 'openai'
        ? answerWithOpenAI(openAI.getKey(), payload, options) : answerWithDeepSeek(deepSeek.getKey(), payload, options)
    });
    installExamples(app.isPackaged ? path.join(process.resourcesPath, 'examples') : path.join(__dirname, '..', 'onboarding'), app.getPath('userData'), store, dailyReview);
    tray = new Tray(app.isPackaged ? path.join(process.resourcesPath, 'via.ico') : path.join(__dirname, '..', 'release', 'via.ico'));
    tray.setToolTip('Via · 本机 Markdown 阅读与复盘');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: '打开 Via', click: createDesktopWindow },
      { label: '打开示例文档文件夹', click: () => shell.openPath(path.join(app.getPath('userData'), '示例文档')) },
      { type: 'separator' },
      { label: '退出 Via', click: async () => { await restoreTypora(); stopTyporaHotkey(); app.quit(); } }
    ]));
    tray.on('double-click', createDesktopWindow);
    let remindedDate = null;
    const remind = () => {
      const now = new Date(), date = dayKey(now), time = now.toTimeString().slice(0, 5);
      if (time < dailyReview.data.reminderTime || remindedDate === date || dailyReview.data.days[date]?.submittedAt) return;
      remindedDate = date;
      const { Notification } = require('electron');
      if (Notification.isSupported()) { const n = new Notification({ title: 'Via · 每日复盘', body: '用几分钟回顾今天的阅读与提问。' }); n.on('click', createDesktopWindow); n.show(); }
    };
    reminderTimer = setInterval(remind, 60000); setTimeout(remind, 2500);
    if (wantsDesktop(process.argv)) {
      createDesktopWindow();
      return;
    }
    const firstPath = argumentPath(process.argv);
    if (firstPath && !desktopSettings.read().typoraEnabled) {
      createDesktopWindow();
      dialog.showMessageBox({ type: 'info', message: 'Typora 接入已在 Via 设置中暂停' });
      return;
    }
    if (firstPath) {
      createWindow();
      launchDocument(firstPath);
    } else createDesktopWindow();
  });
}

ipcMain.handle('document:choose', async () => {
  const result = await dialog.showOpenDialog(window, {
    title: '选择 Typora Markdown 文档',
    properties: ['openFile'],
    filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }]
  });
  if (result.canceled || !result.filePaths[0]) return null;
  const document = store.open(result.filePaths[0]);
  activeDocumentPath = document.documentPath;
  openedDocumentPaths.add(document.documentPath);
  recordsChanged();
  return { ...document, selectedText: '' };
});

ipcMain.handle('document:open', (_event, filePath) => {
  const document = store.open(filePath);
  activeDocumentPath = document.documentPath;
  openedDocumentPaths.add(document.documentPath);
  recordsChanged();
  return { ...document, selectedText: '' };
});

ipcMain.handle('record:save', (_event, payload) => {
  if (!openedDocumentPaths.has(payload?.documentPath)) {
    throw new Error('文档尚未在 Via 中打开，批注未保存');
  }
  const saved = store.save(payload.documentPath, payload.comments, payload.recap);
  recordsChanged();
  return saved;
});

function aiStatus() {
  const provider = desktopSettings.read().aiProvider;
  return { provider, configured: (provider === 'openai' ? openAI : deepSeek).status().configured,
    providers: { deepseek: deepSeek.status(), openai: openAI.status() } };
}

ipcMain.handle('desktop:get-data', async () => ({
  ...deriveDesktopData(allSources()),
  settings: desktopSettings.read(),
  ai: aiStatus(),
  auth: await cloudAuth.status(),
  dailyReview: dailyReview.snapshot(),
  reviewBackend: true,
  release: releaseInfo,
  install: {
    typoraCommand: app.isPackaged
      ? `"${path.join(path.dirname(process.execPath), 'launch-via.cmd')}" "${'${currentPath}'}"`
      : `"${path.join(__dirname, '..', 'launch-via.cmd')}" "${'${currentPath}'}"`
  }
}));
const desktopUrl = pathToFileURL(path.join(__dirname, 'desktop', 'index.html')).href;
for (const [channel, method] of Object.entries({ 'desktop:auth-status': 'status', 'desktop:auth-send-code': 'sendCode',
  'desktop:auth-verify-code': 'verifyCode', 'desktop:auth-sign-in': 'signIn', 'desktop:auth-sign-out': 'signOut' })) {
  ipcMain.handle(channel, async (event, payload) => {
    requireDesktopSender(event, desktopWindow, desktopUrl);
    const result = await cloudAuth[method](payload);
    notifyDesktop();
    return result;
  });
}
ipcMain.handle('desktop:search-status', event => {
  requireDesktopSender(event, desktopWindow, desktopUrl);
  return { deepseek: { available: deepSeek.status().configured, native: true },
    openai: { available: openAI.status().configured, native: true }, defaultEnabled: false };
});
ipcMain.handle('desktop:save-ai-key', (_event, provider, key) => {
  if (!['deepseek', 'openai'].includes(provider)) throw new Error('不支持这家 AI 服务');
  (provider === 'openai' ? openAI : deepSeek).setKey(key);
  const status = aiStatus();
  window?.webContents.send('ai:changed', status);
  return status;
});
ipcMain.handle('desktop:set-ai-provider', (_event, provider) => {
  desktopSettings.setAiProvider(provider);
  const status = aiStatus();
  window?.webContents.send('ai:changed', status);
  return status;
});
ipcMain.on('desktop:show', () => createDesktopWindow());

ipcMain.handle('desktop:open-source', async (_event, sourceId) => {
  const source = allSources().find(item => item.id === sourceId);
  if (!source || !source.exists) throw new Error('原文件已移动或删除');
  const error = await shell.openPath(source.documentPath);
  if (error) throw new Error(`无法打开来源：${error}`);
  await launchDocument(source.documentPath);
  return true;
});

ipcMain.handle('desktop:remove-source', async (_event, sourceId) => {
  const source = allSources().find(item => item.id === sourceId);
  if (!source) throw new Error('资料已不存在');
  {
    openedDocumentPaths.delete(source.documentPath);
    if (activeDocumentPath === source.documentPath) {
      activeDocumentPath = null;
      stopTyporaHotkey();
      if (window && !window.isDestroyed()) window.close();
    }
    store.remove(sourceId);
    dailyReview.removeSource(sourceId);
  }
  recordsChanged();
  return true;
});

ipcMain.handle('desktop:toggle-todo', (_event, sourceId, messageId, resolved) => {
  const source = localSources().find(item => item.id === sourceId);
  if (!source) throw new Error('资料已不存在');
  const message = source.comments.flatMap(comment => comment.messages || [])
    .find(item => item.id === messageId && item.role === 'user');
  if (!message || !mentions(message.text).some(name => name.toLowerCase() !== 'via')) {
    throw new Error('待办已不存在');
  }
  const state = store.setTodoResolved(source.documentPath, messageId, resolved);
  recordsChanged();
  return state;
});

ipcMain.handle('desktop:export-todos', async (_event, sourceId, person) => {
  const source = deriveDesktopData(allSources()).sources.find(item => item.id === sourceId);
  if (!source) throw new Error('资料已不存在');
  const choice = await dialog.showMessageBox(desktopWindow, { type: 'question', message: '导出 @' + person + ' 的内容', buttons: ['批注 Markdown', '原文 + 该人批注 PDF', '取消'], cancelId: 2, defaultId: 0 });
  if (choice.response === 2) return false;
  if (choice.response === 1) {
    const document = store.open(source.documentPath);
    return openPdfPreview(buildPdfHtml(document.name, document.content, document.record.comments, { person }), source.name);
  }
  const comments = require('./shared/export-scope.js').forPerson(source.comments, person);
  const body = ['# ' + source.name + ' · @' + person + ' 批注', '', '来源：' + source.documentPath, '', ...comments.flatMap(c => ['> ' + c.quote, '', ...c.messages.flatMap(m => [(m.role === 'via' ? 'Via：' : '我：') + m.text, ''])])].join('\n');
  const result = await dialog.showSaveDialog(desktopWindow, {
    title: '导出待办',
    defaultPath: `${path.basename(source.name, path.extname(source.name))}-${person.replace(/[\\/:*?"<>|]/g, '')}-待办.md`,
    filters: [{ name: 'Markdown', extensions: ['md'] }]
  });
  if (result.canceled || !result.filePath) return false;
  fs.writeFileSync(result.filePath, body, 'utf8');
  return true;
});

ipcMain.handle('desktop:save-profile', (_event, name, email, signature, avatar) => desktopSettings.saveProfile(name, email, signature, avatar));
ipcMain.handle('desktop:toggle-typora', (_event, enabled) => {
  const settings = desktopSettings.setTyporaEnabled(enabled);
  if (!settings.typoraEnabled) stopTyporaHotkey();
  return settings;
});
ipcMain.handle('desktop:set-typora-shortcut', (_event, shortcut) => {
  const settings = desktopSettings.setTyporaShortcut(shortcut);
  if (settings.typoraEnabled && hotkeyBinding) startTyporaHotkey(hotkeyBinding.handle, hotkeyBinding.documentPath);
  return settings;
});
ipcMain.handle('desktop:open-link', (_event, url) => {
  if (typeof url !== 'string' || !/^https:\/\/[^\s]+$/i.test(url)) throw new Error('仅允许打开 HTTPS 资料链接');
  return shell.openExternal(url);
});
ipcMain.on('desktop:minimize', () => desktopWindow?.minimize());
ipcMain.on('desktop:maximize', () => {
  if (!desktopWindow) return;
  desktopWindow.isMaximized() ? desktopWindow.unmaximize() : desktopWindow.maximize();
});
ipcMain.on('desktop:close', () => desktopWindow?.close());

ipcMain.handle('ai:status', () => aiStatus());
ipcMain.handle('ai:answer', async (_event, payload) => {
  if (!activeDocumentPath || payload?.documentPath !== activeDocumentPath) {
    throw new Error('当前文档已切换，无法回答旧文档的问题');
  }
  return desktopSettings.read().aiProvider === 'openai'
    ? answerWithOpenAI(openAI.getKey(), payload)
    : answerWithDeepSeek(deepSeek.getKey(), payload);
});

ipcMain.handle('export:markdown', async (_event, payload) => {
  if (!activeDocumentPath || payload?.documentPath !== activeDocumentPath || typeof payload.body !== 'string') {
    throw new Error('无法导出：文档不匹配');
  }
  const result = await dialog.showSaveDialog(window, {
    title: '导出 Via 批注',
    defaultPath: `批注-${path.basename(activeDocumentPath, path.extname(activeDocumentPath))}.md`,
    filters: [{ name: 'Markdown', extensions: ['md'] }]
  });
  if (result.canceled || !result.filePath) return false;
  fs.writeFileSync(result.filePath, payload.body, 'utf8');
  return true;
});

async function openPdfPreview(html, name) {
  pdfExportName = name;
  if (pdfWindow && !pdfWindow.isDestroyed()) pdfWindow.close();
  pdfWindow = new BrowserWindow({
    width: 1140,
    height: 820,
    title: `批注-${name} · PDF 预览`,
    webPreferences: {
      preload: path.join(__dirname, 'pdf-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  protectNavigation(pdfWindow.webContents, url => shell.openExternal(url));
  await pdfWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  return true;
}

ipcMain.handle('export:pdf', async (_event, payload) => {
  if (!activeDocumentPath || payload?.documentPath !== activeDocumentPath) {
    throw new Error('无法导出：文档不匹配');
  }
  const document = store.open(activeDocumentPath);
  const html = buildPdfHtml(document.name, document.content, document.record.comments, { person: typeof payload.person === 'string' ? payload.person : null });
  return openPdfPreview(html, document.name);
});

ipcMain.handle('pdf:save', async event => {
  if (!pdfWindow || event.sender !== pdfWindow.webContents || !pdfExportName) {
    throw new Error('PDF 预览已关闭');
  }
  const result = await dialog.showSaveDialog(pdfWindow, {
    title: '保存原文与批注 PDF',
    defaultPath: `批注-${pdfExportName.replace(/[\\/:*?"<>|]/g, '_').slice(0, 80)}.pdf`,
    filters: [{ name: 'PDF', extensions: ['pdf'] }]
  });
  if (result.canceled || !result.filePath) return false;
  const bytes = await pdfWindow.webContents.printToPDF({ pageSize: 'A4', landscape: true, printBackground: true });
  fs.writeFileSync(result.filePath, bytes);
  return true;
});

ipcMain.on('window:close', () => window?.close());
ipcMain.on('window:minimize', () => window?.minimize());

for (const [channel, fn] of Object.entries({
  'desktop:review-generate': date => dailyReview.generate(date),
  'desktop:review-choose': (date, id, option) => dailyReview.choose(date, id, option),
  'desktop:review-submit': date => dailyReview.submit(date),
  'desktop:review-reminder': time => dailyReview.reminder(time),
  'desktop:review-ask': (date, text) => dailyReview.ask(date, text)
})) ipcMain.handle(channel, (event, ...args) => { requireDesktopSender(event, desktopWindow, desktopUrl); return fn(...args); });
