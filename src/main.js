'use strict';

const { app, BrowserWindow, Menu, dialog, ipcMain, shell, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const APP_NAME = 'MarkPDF';
const MD_FILTERS = [
  { name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd', 'txt'] },
  { name: 'All Files', extensions: ['*'] }
];

/* ------------------------------------------------------------------ */
/* Settings (persisted in the user's AppData folder, never in the repo) */
/* ------------------------------------------------------------------ */

const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');

const DEFAULT_SETTINGS = {
  theme: 'system',          // 'system' | 'light' | 'dark'
  layout: 'split',          // 'split' | 'editor' | 'preview'
  fontSize: 15,
  wordWrap: true,
  syncScroll: true,
  showOutline: false,
  spellcheck: true,
  recentFiles: [],
  pdf: {
    pageSize: 'A4',
    landscape: false,
    margin: 'normal',       // 'none' | 'narrow' | 'normal' | 'wide'
    pageNumbers: true,
    openAfterExport: true
  }
};

let settings = loadSettings();

function loadSettings() {
  try {
    const raw = JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
    return { ...DEFAULT_SETTINGS, ...raw, pdf: { ...DEFAULT_SETTINGS.pdf, ...(raw.pdf || {}) } };
  } catch {
    return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  }
}

function saveSettings() {
  try {
    fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
    fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2), 'utf8');
  } catch (err) {
    console.error('Could not save settings:', err);
  }
}

function addRecent(filePath) {
  if (!filePath) return;
  settings.recentFiles = [filePath, ...settings.recentFiles.filter(f => f !== filePath)].slice(0, 10);
  saveSettings();
  app.addRecentDocument(filePath);
  buildMenu();
}

/* ------------------------------------------------------------------ */
/* Windows                                                             */
/* ------------------------------------------------------------------ */

const windowState = new Map(); // webContents.id -> { dirty, filePath, forceClose }

function createWindow(filePath = null) {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 720,
    minHeight: 480,
    title: APP_NAME,
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0d1117' : '#ffffff',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true
    }
  });

  const id = win.webContents.id;
  windowState.set(id, { dirty: false, filePath: null, forceClose: false });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  win.once('ready-to-show', () => win.show());

  win.webContents.on('did-finish-load', () => {
    if (filePath) openFileInWindow(win, filePath);
  });

  // Never let the app window navigate away; open web links in the browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:|^mailto:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    e.preventDefault();
    if (/^https?:|^mailto:/i.test(url)) shell.openExternal(url);
  });

  // Right-click menu with spelling suggestions.
  win.webContents.on('context-menu', (_e, params) => {
    const items = [];
    for (const s of params.dictionarySuggestions || []) {
      items.push({ label: s, click: () => win.webContents.replaceMisspelling(s) });
    }
    if (params.misspelledWord) {
      if (!items.length) items.push({ label: 'No suggestions', enabled: false });
      items.push({
        label: 'Add to dictionary',
        click: () => win.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord)
      });
      items.push({ type: 'separator' });
    }
    if (params.isEditable) {
      items.push({ role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { type: 'separator' });
      items.push({ label: 'Select All', click: () => send(win, 'selectAll') });
    } else if (params.selectionText) {
      items.push({ role: 'copy' });
    }
    if (items.length) Menu.buildFromTemplate(items).popup({ window: win });
  });

  win.on('close', (e) => {
    const state = windowState.get(id);
    if (!state || state.forceClose || !state.dirty) return;
    e.preventDefault();
    const name = state.filePath ? path.basename(state.filePath) : 'Untitled';
    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning',
      buttons: ['Save', "Don't Save", 'Cancel'],
      defaultId: 0,
      cancelId: 2,
      title: APP_NAME,
      message: `Do you want to save the changes to ${name}?`,
      detail: "Your changes will be lost if you don't save them."
    });
    if (choice === 0) {
      send(win, 'saveAndClose');
    } else if (choice === 1) {
      state.forceClose = true;
      win.close();
    }
  });

  win.on('closed', () => windowState.delete(id));
  return win;
}

function send(win, action, payload) {
  if (win && !win.isDestroyed()) win.webContents.send('menu', action, payload);
}

function focused() {
  return BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0] || null;
}

function openFileInWindow(win, filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    send(win, 'loadFile', { filePath, content });
    addRecent(filePath);
  } catch (err) {
    dialog.showErrorBox(APP_NAME, `Could not open file:\n${filePath}\n\n${err.message}`);
    settings.recentFiles = settings.recentFiles.filter(f => f !== filePath);
    saveSettings();
    buildMenu();
  }
}

/** Open in the current window if it is an empty, untouched document; otherwise in a new one. */
function openFile(filePath) {
  const win = focused();
  const state = win && windowState.get(win.webContents.id);
  if (win && state && !state.filePath && !state.dirty) {
    openFileInWindow(win, filePath);
  } else {
    createWindow(filePath);
  }
}

async function showOpenDialog() {
  const win = focused();
  const result = await dialog.showOpenDialog(win, {
    title: 'Open Markdown File',
    properties: ['openFile', 'multiSelections'],
    filters: MD_FILTERS
  });
  if (!result.canceled) result.filePaths.forEach(openFile);
}

/* ------------------------------------------------------------------ */
/* Menu                                                                */
/* ------------------------------------------------------------------ */

function buildMenu() {
  const a = (label, action, accelerator, extra = {}) => ({
    label, accelerator, click: () => send(focused(), action), ...extra
  });

  const recent = settings.recentFiles.length
    ? [
        ...settings.recentFiles.map(f => ({ label: f, click: () => openFile(f) })),
        { type: 'separator' },
        { label: 'Clear Recent', click: () => { settings.recentFiles = []; saveSettings(); app.clearRecentDocuments(); buildMenu(); } }
      ]
    : [{ label: 'No recent files', enabled: false }];

  const template = [
    {
      label: '&File',
      submenu: [
        a('New', 'new', 'CmdOrCtrl+N'),
        { label: 'New Window', accelerator: 'CmdOrCtrl+Shift+N', click: () => createWindow() },
        { type: 'separator' },
        { label: 'Open…', accelerator: 'CmdOrCtrl+O', click: showOpenDialog },
        { label: 'Open Recent', submenu: recent },
        { type: 'separator' },
        a('Save', 'save', 'CmdOrCtrl+S'),
        a('Save As…', 'saveAs', 'CmdOrCtrl+Shift+S'),
        { type: 'separator' },
        a('Export as PDF…', 'exportPdf', 'CmdOrCtrl+E'),
        a('Export as HTML…', 'exportHtml', 'CmdOrCtrl+Shift+E'),
        a('Print…', 'print', 'CmdOrCtrl+P'),
        { type: 'separator' },
        { label: 'Close Window', accelerator: 'CmdOrCtrl+W', click: () => focused()?.close() },
        { label: 'Exit', accelerator: 'Alt+F4', click: () => app.quit() }
      ]
    },
    {
      label: '&Edit',
      submenu: [
        a('Undo', 'undo', 'CmdOrCtrl+Z'),
        a('Redo', 'redo', 'CmdOrCtrl+Y'),
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        a('Select All', 'selectAll', 'CmdOrCtrl+A'),
        { type: 'separator' },
        a('Find…', 'find', 'CmdOrCtrl+F'),
        a('Find Next', 'findNext', 'F3'),
        a('Find Previous', 'findPrev', 'Shift+F3'),
        a('Replace…', 'replace', 'CmdOrCtrl+H'),
        a('Go to Line…', 'gotoLine', 'CmdOrCtrl+G'),
        { type: 'separator' },
        a('Insert Date/Time', 'insertDate', 'F5')
      ]
    },
    {
      label: 'F&ormat',
      submenu: [
        a('Bold', 'bold', 'CmdOrCtrl+B'),
        a('Italic', 'italic', 'CmdOrCtrl+I'),
        a('Strikethrough', 'strike', 'CmdOrCtrl+Shift+X'),
        a('Inline Code', 'code', 'CmdOrCtrl+`'),
        { type: 'separator' },
        a('Heading 1', 'h1', 'CmdOrCtrl+1'),
        a('Heading 2', 'h2', 'CmdOrCtrl+2'),
        a('Heading 3', 'h3', 'CmdOrCtrl+3'),
        { type: 'separator' },
        a('Bulleted List', 'ul', 'CmdOrCtrl+Shift+8'),
        a('Numbered List', 'ol', 'CmdOrCtrl+Shift+7'),
        a('Task List', 'task', 'CmdOrCtrl+Shift+9'),
        a('Quote', 'quote', 'CmdOrCtrl+Shift+.'),
        { type: 'separator' },
        a('Link', 'link', 'CmdOrCtrl+K'),
        a('Image', 'image', 'CmdOrCtrl+Shift+I'),
        a('Code Block', 'codeblock', 'CmdOrCtrl+Shift+C'),
        a('Table', 'table', 'CmdOrCtrl+Shift+T'),
        a('Horizontal Rule', 'hr', 'CmdOrCtrl+Shift+-'),
        a('Page Break (PDF)', 'pagebreak', 'CmdOrCtrl+Enter')
      ]
    },
    {
      label: '&View',
      submenu: [
        a('Editor Only', 'layoutEditor', 'CmdOrCtrl+Alt+1'),
        a('Split View', 'layoutSplit', 'CmdOrCtrl+Alt+2'),
        a('Preview Only', 'layoutPreview', 'CmdOrCtrl+Alt+3'),
        a('Toggle Outline', 'toggleOutline', 'CmdOrCtrl+Shift+O'),
        { type: 'separator' },
        {
          label: 'Theme',
          submenu: ['system', 'light', 'dark'].map(t => ({
            label: t[0].toUpperCase() + t.slice(1),
            type: 'radio',
            checked: settings.theme === t,
            click: () => setSetting('theme', t)
          }))
        },
        { label: 'Word Wrap', type: 'checkbox', checked: settings.wordWrap, accelerator: 'Alt+Z', click: (i) => setSetting('wordWrap', i.checked) },
        { label: 'Sync Scroll', type: 'checkbox', checked: settings.syncScroll, click: (i) => setSetting('syncScroll', i.checked) },
        { label: 'Spell Check', type: 'checkbox', checked: settings.spellcheck, click: (i) => setSetting('spellcheck', i.checked) },
        { type: 'separator' },
        a('Increase Font Size', 'fontUp', 'CmdOrCtrl+='),
        a('Decrease Font Size', 'fontDown', 'CmdOrCtrl+-'),
        a('Reset Font Size', 'fontReset', 'CmdOrCtrl+0'),
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { role: 'toggleDevTools', accelerator: 'CmdOrCtrl+Shift+F12' }
      ]
    },
    {
      label: '&Help',
      submenu: [
        a('Markdown Cheat Sheet', 'cheatsheet', 'F1'),
        { label: 'Markdown Guide (web)', click: () => shell.openExternal('https://www.markdownguide.org/basic-syntax/') },
        { type: 'separator' },
        {
          label: `About ${APP_NAME}`,
          click: () => dialog.showMessageBox(focused(), {
            type: 'info',
            title: `About ${APP_NAME}`,
            message: `${APP_NAME} ${app.getVersion()}`,
            detail: 'A Markdown editor with live preview and PDF export.\n\n' +
              `Electron ${process.versions.electron} · Chromium ${process.versions.chrome} · Node ${process.versions.node}`
          })
        }
      ]
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function setSetting(key, value) {
  settings[key] = value;
  saveSettings();
  buildMenu();
  for (const w of BrowserWindow.getAllWindows()) send(w, 'settings', settings);
}

/* ------------------------------------------------------------------ */
/* Export (PDF / HTML / Print)                                         */
/* ------------------------------------------------------------------ */

const nm = (...p) => path.join(__dirname, '..', 'node_modules', ...p);
const readSafe = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } };

function buildStandaloneHtml(bodyHtml, title) {
  const markdownCss = readSafe(nm('github-markdown-css', 'github-markdown-light.css'));
  const hljsCss = readSafe(nm('@highlightjs', 'cdn-assets', 'styles', 'github.min.css'));
  const printCss = readSafe(path.join(__dirname, 'renderer', 'print.css'));
  const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>${markdownCss}</style>
<style>${hljsCss}</style>
<style>${printCss}</style>
</head>
<body>
<article class="markdown-body">
${bodyHtml}
</article>
</body>
</html>`;
}

const MARGINS = {
  none: { top: 0, bottom: 0, left: 0, right: 0 },
  narrow: { top: 0.5, bottom: 0.5, left: 0.5, right: 0.5 },
  normal: { top: 0.8, bottom: 0.8, left: 0.8, right: 0.8 },
  wide: { top: 1, bottom: 1, left: 1.25, right: 1.25 }
};

/** Render HTML in a hidden window and hand it to a callback (printToPDF / print). */
async function withHiddenPage(html, fn) {
  const tmp = path.join(os.tmpdir(), `markpdf-${process.pid}-${Date.now()}.html`);
  fs.writeFileSync(tmp, html, 'utf8');
  const win = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false }
  });
  try {
    await win.loadFile(tmp);
    return await fn(win);
  } finally {
    if (!win.isDestroyed()) win.destroy();
    fs.rm(tmp, { force: true }, () => {});
  }
}

ipcMain.handle('export-pdf', async (event, { html, title, filePath, options }) => {
  const parent = BrowserWindow.fromWebContents(event.sender);
  const opts = { ...settings.pdf, ...(options || {}) };
  settings.pdf = opts;
  saveSettings();

  const base = filePath ? filePath.replace(/\.(md|markdown|mdown|mkd|txt)$/i, '') : path.join(app.getPath('documents'), title || 'Untitled');
  const { canceled, filePath: out } = await dialog.showSaveDialog(parent, {
    title: 'Export as PDF',
    defaultPath: `${base}.pdf`,
    filters: [{ name: 'PDF', extensions: ['pdf'] }]
  });
  if (canceled || !out) return { ok: false, canceled: true };

  try {
    const pdf = await withHiddenPage(buildStandaloneHtml(html, title), (w) => w.webContents.printToPDF({
      pageSize: opts.pageSize,
      landscape: !!opts.landscape,
      printBackground: true,
      margins: { marginType: 'custom', ...(MARGINS[opts.margin] || MARGINS.normal) },
      displayHeaderFooter: !!opts.pageNumbers,
      headerTemplate: '<span></span>',
      footerTemplate: opts.pageNumbers
        ? '<div style="width:100%;font-size:9px;color:#888;text-align:center;font-family:Segoe UI,Arial,sans-serif;"><span class="pageNumber"></span> / <span class="totalPages"></span></div>'
        : '<span></span>'
    }));
    fs.writeFileSync(out, pdf);
    if (opts.openAfterExport) shell.openPath(out);
    return { ok: true, path: out };
  } catch (err) {
    dialog.showErrorBox(APP_NAME, `PDF export failed:\n${err.message}`);
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('export-html', async (event, { html, title, filePath }) => {
  const parent = BrowserWindow.fromWebContents(event.sender);
  const base = filePath ? filePath.replace(/\.(md|markdown|mdown|mkd|txt)$/i, '') : path.join(app.getPath('documents'), title || 'Untitled');
  const { canceled, filePath: out } = await dialog.showSaveDialog(parent, {
    title: 'Export as HTML',
    defaultPath: `${base}.html`,
    filters: [{ name: 'HTML', extensions: ['html', 'htm'] }]
  });
  if (canceled || !out) return { ok: false, canceled: true };
  try {
    fs.writeFileSync(out, buildStandaloneHtml(html, title), 'utf8');
    return { ok: true, path: out };
  } catch (err) {
    dialog.showErrorBox(APP_NAME, `HTML export failed:\n${err.message}`);
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('print', async (_event, { html, title }) => {
  return withHiddenPage(buildStandaloneHtml(html, title), (w) => new Promise((resolve) => {
    w.webContents.print({ printBackground: true }, (success, reason) => resolve({ ok: success, reason }));
  }));
});

/* ------------------------------------------------------------------ */
/* File IPC                                                            */
/* ------------------------------------------------------------------ */

ipcMain.handle('get-settings', () => settings);
ipcMain.handle('set-setting', (_e, key, value) => {
  if (key in DEFAULT_SETTINGS) {
    settings[key] = value;
    saveSettings();
    if (['theme', 'wordWrap', 'syncScroll', 'spellcheck'].includes(key)) buildMenu();
  }
});

ipcMain.handle('save-file', async (event, { filePath, content, saveAs }) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  let target = filePath;
  if (!target || saveAs) {
    const { canceled, filePath: chosen } = await dialog.showSaveDialog(win, {
      title: saveAs ? 'Save As' : 'Save',
      defaultPath: target || path.join(app.getPath('documents'), 'Untitled.md'),
      filters: MD_FILTERS
    });
    if (canceled || !chosen) return { ok: false, canceled: true };
    target = chosen;
  }
  try {
    fs.writeFileSync(target, content, 'utf8');
    addRecent(target);
    return { ok: true, filePath: target };
  } catch (err) {
    dialog.showErrorBox(APP_NAME, `Could not save file:\n${target}\n\n${err.message}`);
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('open-dialog', () => showOpenDialog());

ipcMain.handle('open-path', (_e, filePath) => {
  if (typeof filePath === 'string' && fs.existsSync(filePath)) openFile(filePath);
});

ipcMain.on('doc-state', (event, { dirty, filePath }) => {
  const state = windowState.get(event.sender.id);
  if (!state) return;
  state.dirty = !!dirty;
  state.filePath = filePath || null;
  const win = BrowserWindow.fromWebContents(event.sender);
  const name = filePath ? path.basename(filePath) : 'Untitled';
  win?.setTitle(`${dirty ? '● ' : ''}${name} — ${APP_NAME}`);
});

ipcMain.handle('confirm-discard', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const state = windowState.get(event.sender.id);
  const name = state?.filePath ? path.basename(state.filePath) : 'Untitled';
  const { response } = await dialog.showMessageBox(win, {
    type: 'warning',
    buttons: ['Save', "Don't Save", 'Cancel'],
    defaultId: 0,
    cancelId: 2,
    title: APP_NAME,
    message: `Do you want to save the changes to ${name}?`
  });
  return ['save', 'discard', 'cancel'][response];
});

ipcMain.on('force-close', (event) => {
  const state = windowState.get(event.sender.id);
  if (state) state.forceClose = true;
  BrowserWindow.fromWebContents(event.sender)?.close();
});

/* ------------------------------------------------------------------ */
/* App lifecycle                                                       */
/* ------------------------------------------------------------------ */

function filesFromArgv(argv) {
  return argv
    .slice(app.isPackaged ? 1 : 2)
    .filter(a => !a.startsWith('-') && /\.(md|markdown|mdown|mkd|txt)$/i.test(a))
    .map(a => path.resolve(a))
    .filter(a => fs.existsSync(a));
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    const files = filesFromArgv(argv);
    if (files.length) files.forEach(f => createWindow(f));
    else {
      const w = focused();
      if (w) { if (w.isMinimized()) w.restore(); w.focus(); } else createWindow();
    }
  });

  app.whenReady().then(() => {
    app.setAppUserModelId('com.markpdf.app');
    buildMenu();
    const files = filesFromArgv(process.argv);
    if (files.length) files.forEach(f => createWindow(f));
    else createWindow();
  });

  app.on('window-all-closed', () => app.quit());
}
