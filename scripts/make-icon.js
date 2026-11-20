// Renders build/icon.svg to build/icon.png (512x512) using Electron itself.
// Usage: npm run icon
'use strict';

const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const SIZE = 512;
const svgPath = path.join(__dirname, '..', 'build', 'icon.svg');
const outPath = path.join(__dirname, '..', 'build', 'icon.png');

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const svg = fs.readFileSync(svgPath, 'utf8');
  const html = `<!doctype html><html><head><style>html,body{margin:0;overflow:hidden;background:transparent}img{display:block}</style></head><body>
    <img src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}" width="${SIZE}" height="${SIZE}">
  </body></html>`;
  const win = new BrowserWindow({
    width: SIZE, height: SIZE, show: false, frame: false, transparent: true, backgroundColor: '#00000000',
    useContentSize: true, webPreferences: { offscreen: true }
  });
  await win.loadURL('data:text/html;base64,' + Buffer.from(html).toString('base64'));
  await new Promise((r) => setTimeout(r, 500));
  const image = await win.webContents.capturePage({ x: 0, y: 0, width: SIZE, height: SIZE });
  fs.writeFileSync(outPath, image.resize({ width: SIZE, height: SIZE }).toPNG());
  console.log('Wrote', outPath);
  app.quit();
});
