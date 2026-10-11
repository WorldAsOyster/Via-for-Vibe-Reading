'use strict';

const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const destination = path.join(__dirname, '..', 'release');
const sizes = [16, 32, 48, 256];

app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
  await window.loadURL('about:blank');
  const encoded = await window.webContents.executeJavaScript(`
    [16, 32, 48, 256].map(size => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#0b8675';
      ctx.beginPath();
      ctx.roundRect(0, 0, size, size, size * .24);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = 'italic bold ' + Math.round(size * .72) + 'px Georgia';
      ctx.fillText('v', size * .48, size * .48);
      return canvas.toDataURL('image/png').split(',')[1];
    })
  `);
  const images = encoded.map(value => Buffer.from(value, 'base64'));
  const header = Buffer.alloc(6 + images.length * 16);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach((png, index) => {
    const entry = 6 + index * 16;
    header.writeUInt8(sizes[index] === 256 ? 0 : sizes[index], entry);
    header.writeUInt8(sizes[index] === 256 ? 0 : sizes[index], entry + 1);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(png.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  });
  fs.mkdirSync(destination, { recursive: true });
  fs.writeFileSync(path.join(destination, 'via.ico'), Buffer.concat([header, ...images]));
  fs.writeFileSync(path.join(destination, 'via.png'), images.at(-1));
  window.destroy();
  app.quit();
}).catch(error => {
  console.error(error);
  app.exit(1);
});
