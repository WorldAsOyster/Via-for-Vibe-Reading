'use strict';
// Loads the actual main process and real IPC handlers. No replacement backend or demo adapter.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { app, BrowserWindow } = require('electron');
const root = path.resolve(__dirname, '..');
const output = path.join(root, '.test-data', 'native-app');
fs.mkdirSync(output, { recursive: true });
process.env.VIA_TEST_USER_DATA = process.env.VIA_NATIVE_TEST_DATA || path.join(output, 'user-data');
process.argv.push('--via-desktop');
const packagedRoot = process.env.VIA_NATIVE_APP_ROOT;
if (packagedRoot) {
  Object.defineProperty(app, 'isPackaged', { value: true });
  Object.defineProperty(process, 'resourcesPath', { value: path.dirname(packagedRoot) });
  require(path.join(packagedRoot, 'src/main.cjs'));
} else require('../src/main.cjs');
const pause = ms => new Promise(r => setTimeout(r, ms));
app.whenReady().then(async () => {
  try {
    let desktop;
    for (let i = 0; i < 80; i++) {
      desktop = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('/desktop/index.html'));
      if (desktop && await desktop.webContents.executeJavaScript('!!document.getElementById("brandName") && !!document.querySelector(".daily-layout")').catch(() => false)) break;
      await pause(100);
    }
    assert.ok(desktop, 'Actual desktop created');
    const invoke = async code => { try { return await desktop.webContents.executeJavaScript(code); } catch (error) { throw new Error(code + " : " + error.message); } };
    desktop.webContents.on("console-message", (_event, ...args) => console.log("RENDERER", ...args));
    const data = await invoke('window.viaDesktop.getData()');
    assert.equal(data.sources.length, 2); assert.equal(data.metrics.comments, 20);
    assert.ok(data.reviewBackend); assert.equal(data.browser, undefined); assert.equal(data.sync, undefined);
    assert.ok(data.sources.every(s => fs.existsSync(s.documentPath)));
    assert.equal(data.release.version, require('../package.json').version);
    await invoke('document.querySelector("[data-auth-skip]")?.click(); document.querySelector("[data-setup-later]")?.click()');
    await pause(200);
    const body = await invoke('document.body.innerText');
    assert.ok(!body.includes('回到阅读现场')); assert.ok(!body.includes('打开工作台'));
    const date = new Date().toLocaleDateString('sv-SE'), p = data.dailyReview.days[date];
    await invoke(`window.viaDesktop.chooseReviewAnswer(${JSON.stringify(date)},${JSON.stringify(p.questions[0].id)},1)`);
    await invoke('window.viaDesktop.saveReviewReminder("19:45")');
    const saved = JSON.parse(fs.readFileSync(path.join(process.env.VIA_TEST_USER_DATA, 'daily-review.json'), 'utf8'));
    assert.equal(saved.reminderTime, '19:45'); assert.equal(saved.days[date].choices[p.questions[0].id], 1);
    await pause(200);
    fs.writeFileSync(path.join(output, 'desktop.png'), (await desktop.webContents.capturePage()).toPNG());
    await invoke('document.querySelector("[data-page=settings]").click()'); await pause(200);
    assert.match(await invoke('document.body.innerText'), /注册/);
    await invoke('document.querySelector("[data-settings-tab=help]").click()'); await pause(100);
    const help = await invoke('document.body.innerText');
    assert.ok(!help.includes('打开工作台') && !help.includes('预设演示回答'));
    await invoke('document.querySelector("[data-settings-tab=profile]").click()'); await pause(100);
    fs.writeFileSync(path.join(output, 'settings.png'), (await desktop.webContents.capturePage()).toPNG());
    app.emit('second-instance', {}, ['--via-document=' + data.sources[0].documentPath]);
    let sidecar;
    for (let i = 0; i < 100; i++) {
      sidecar = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('/renderer/index.html'));
      if (sidecar && await sidecar.webContents.executeJavaScript('document.querySelectorAll(".note-card").length').catch(() => 0) === 10) break;
      await pause(100);
    }
    assert.ok(sidecar, 'Actual sidecar created');
    assert.equal(await sidecar.webContents.executeJavaScript('document.querySelectorAll(".note-card").length'), 10);
    // Add a real annotation through the real preload/IPC and ensure Markdown is unchanged.
    const original = fs.readFileSync(data.sources[0].documentPath);
    sidecar.webContents.send('document:launched', { ...require('../src/store.cjs').DocumentStore.prototype.open.call(new (require('../src/store.cjs').DocumentStore)(path.join(process.env.VIA_TEST_USER_DATA, 'documents')), data.sources[0].documentPath), selectedText: data.sources[0].comments[0].quote });
    await pause(200);
    await sidecar.webContents.executeJavaScript('document.getElementById("messageInput").value="真实应用持久化检查"; document.querySelector("[data-action=submit]").click()');
    await pause(300);
    assert.equal((await invoke('window.viaDesktop.getData()')).metrics.comments, 21);
    assert.deepEqual(fs.readFileSync(data.sources[0].documentPath), original);
    fs.writeFileSync(path.join(output, 'sidecar.png'), (await sidecar.webContents.capturePage()).toPNG());
    const reloaded = new (require('../src/store.cjs').DocumentStore)(path.join(process.env.VIA_TEST_USER_DATA, 'documents'));
    assert.equal(reloaded.readRecord(data.sources[0].documentPath).comments.length, 11);
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ main: packagedRoot ? 'actual packaged resources/app/src/main.cjs' : 'actual src/main.cjs', preload: 'actual desktop/renderer preload', version: data.release.version, sources: 2, annotationsBefore: 20, annotationsAfter: 21, originalUnchanged: true, reviewPersisted: true, authUi: true, realAI: false, emailDelivery: false }, null, 2));
    const closing = new Promise(resolve => sidecar.once('closed', resolve)); sidecar.close(); await closing;
    console.log('NATIVE_APP_SMOKE_OK ' + output); app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
});
