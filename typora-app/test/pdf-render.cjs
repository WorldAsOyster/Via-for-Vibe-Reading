'use strict';

const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { buildPdfHtml } = require('../src/pdf.cjs');

app.whenReady().then(async () => {
  const root = path.resolve(__dirname, '..');
  const sample = fs.readFileSync(path.join(root, 'examples', '2026-Q4-增长方案.md'), 'utf8');
  const quote = '北极星指标';
  const html = buildPdfHtml('2026-Q4-增长方案.md', sample, [{
    quote, anchor: { offset: sample.indexOf(quote) }, saved: true,
    messages: [
      { role: 'user', text: '@Via 这个指标如何定义？' },
      { role: 'via', text: '文档将它定义为注册后 7 天内完成首次有效协作的人数。', source: '依据：当前文档' }
    ]
  }]);
  const window = new BrowserWindow({ width: 1140, height: 820, show: false, webPreferences: { sandbox: true } });
  await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  const output = path.join(root, '.test-data');
  fs.mkdirSync(output, { recursive: true });
  const bytes = await window.webContents.printToPDF({ pageSize: 'A4', landscape: true, printBackground: true });
  if (bytes.subarray(0, 4).toString() !== '%PDF') throw new Error('PDF output is invalid');
  fs.writeFileSync(path.join(output, 'pdf-preview-smoke.pdf'), bytes);
  fs.writeFileSync(path.join(output, 'pdf-preview-smoke.png'), (await window.webContents.capturePage()).toPNG());
  const webHtml = buildPdfHtml('网页文章', '第一段介绍有效协作。\n\n第二段再次提到有效协作，并要求邀请同事。', [{
    quote: '有效协作', contextSnapshot: '第二段再次提到有效协作，并要求邀请同事。',
    messages: [{ role: 'user', text: '@Via 如何执行？' }, { role: 'via', text: '先邀请同事并完成一次协作。' }]
  }], { plainText: true });
  await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(webHtml)}`);
  const webBytes = await window.webContents.printToPDF({ pageSize: 'A4', landscape: true, printBackground: true });
  if (webBytes.subarray(0, 4).toString() !== '%PDF') throw new Error('Web PDF output is invalid');
  fs.writeFileSync(path.join(output, 'browser-pdf-preview-smoke.pdf'), webBytes);
  fs.writeFileSync(path.join(output, 'browser-pdf-preview-smoke.png'), (await window.webContents.capturePage()).toPNG());
  console.log(`PDF render passed (${bytes.length} bytes)`);
  window.destroy();
  app.quit();
}).catch(error => { console.error(error); app.exit(1); });
