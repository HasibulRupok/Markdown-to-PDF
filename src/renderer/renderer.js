/* global CodeMirror, marked, DOMPurify, hljs */
'use strict';

(async function main() {
  const api = window.api;
  const $ = (sel) => document.querySelector(sel);

  const els = {
    root: document.documentElement,
    workspace: $('#workspace'),
    editorPane: $('#editorPane'),
    previewPane: $('#previewPane'),
    preview: $('#preview'),
    divider: $('#divider'),
    outline: $('#outline'),
    outlineList: $('#outlineList'),
    pdfDialog: $('#pdfDialog'),
    cheatDialog: $('#cheatDialog'),
    dropOverlay: $('#dropOverlay'),
    toast: $('#toast'),
    stFile: $('#stFile'),
    stSaved: $('#stSaved'),
    stPos: $('#stPos'),
    stWords: $('#stWords'),
    stChars: $('#stChars'),
    stRead: $('#stRead')
  };

  let settings = await api.getSettings();
  const doc = { filePath: null, cleanGen: 0 };

  /* ---------------------------------------------------------------- */
  /* Editor                                                            */
  /* ---------------------------------------------------------------- */

  const cm = CodeMirror.fromTextArea(document.getElementById('editor'), {
    mode: { name: 'gfm', highlightFormatting: true, fencedCodeBlockHighlighting: true },
    lineNumbers: true,
    lineWrapping: settings.wordWrap,
    styleActiveLine: true,
    autoCloseBrackets: '()[]{}``',
    indentUnit: 2,
    tabSize: 4,
    inputStyle: 'contenteditable',
    spellcheck: settings.spellcheck,
    autofocus: true,
    placeholder: 'Start writing Markdown…',
    extraKeys: {
      Enter: 'newlineAndIndentContinueMarkdownList',
      Tab: (c) => (c.somethingSelected() || isListLine(c) ? c.execCommand('indentMore') : c.replaceSelection('  ')),
      'Shift-Tab': 'indentLess',
      'Ctrl-H': 'replace',
      'Ctrl-G': 'jumpToLine',
      F3: 'findNext',
      'Shift-F3': 'findPrev'
    }
  });
  doc.cleanGen = cm.changeGeneration(true);

  function isListLine(c) {
    const line = c.getLine(c.getCursor().line);
    return /^\s*([-*+]|\d+[.)])\s/.test(line);
  }

  /* ---------------------------------------------------------------- */
  /* Markdown rendering                                                */
  /* ---------------------------------------------------------------- */

  marked.use({ gfm: true, breaks: false });

  const dirOf = (p) => (p ? p.replace(/[\\/][^\\/]*$/, '') : null);
  const baseName = (p) => (p ? p.split(/[\\/]/).pop() : 'Untitled');
  const stripExt = (n) => n.replace(/\.(md|markdown|mdown|mkd|txt)$/i, '');
  const toFileUrl = (p) => 'file:///' + encodeURI(p.replace(/\\/g, '/')).replace(/#/g, '%23').replace(/\?/g, '%3F');
  const isAbsoluteUrl = (u) => /^([a-z][a-z0-9+.-]*:|\/\/|#)/i.test(u);

  function preprocess(md) {
    // Hide YAML front matter, and turn page-break markers into page-break elements.
    return md
      .replace(/^---\r?\n[\s\S]*?\r?\n(---|\.\.\.)\s*(\r?\n|$)/, '')
      .replace(/^[ \t]*(<!--\s*pagebreak\s*-->|\\pagebreak|\\newpage)[ \t]*$/gim, '\n<div class="page-break"></div>\n');
  }

  function slugify(text, used) {
    let slug = text.toLowerCase().trim()
      .replace(/<[^>]*>/g, '')
      .replace(/[^\p{L}\p{N}\s_-]/gu, '')
      .replace(/\s+/g, '-') || 'section';
    const base = slug;
    let i = 1;
    while (used.has(slug)) slug = `${base}-${i++}`;
    used.add(slug);
    return slug;
  }

  function render() {
    const html = DOMPurify.sanitize(marked.parse(preprocess(cm.getValue())), {
      ADD_ATTR: ['target', 'align'],
      ADD_TAGS: ['details', 'summary', 'kbd', 'sup', 'sub', 'mark']
    });
    const container = els.preview;
    container.innerHTML = html;

    // Resolve relative image / media paths against the folder of the .md file.
    const baseDir = dirOf(doc.filePath);
    if (baseDir) {
      const baseUrl = toFileUrl(baseDir) + '/';
      container.querySelectorAll('img[src], video[src], audio[src], source[src]').forEach((el) => {
        const src = el.getAttribute('src');
        if (src && !isAbsoluteUrl(src) && !src.startsWith('data:')) {
          try { el.setAttribute('src', new URL(src, baseUrl).href); } catch { /* ignore */ }
        }
      });
    }

    // Syntax highlight fenced code blocks.
    container.querySelectorAll('pre code').forEach((block) => {
      try { hljs.highlightElement(block); } catch { /* unknown language */ }
    });

    // Heading anchors + outline.
    const used = new Set();
    const headings = [...container.querySelectorAll('h1, h2, h3, h4, h5, h6')];
    headings.forEach((h) => { if (!h.id) h.id = slugify(h.textContent, used); });
    buildOutline(headings);
  }

  let renderTimer = null;
  function scheduleRender() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(render, 120);
  }
  function flushRender() {
    clearTimeout(renderTimer);
    render();
  }

  /* ---------------------------------------------------------------- */
  /* Outline                                                           */
  /* ---------------------------------------------------------------- */

  function sourceHeadingLines() {
    const lines = [];
    let fence = null;
    const count = cm.lineCount();
    for (let i = 0; i < count; i++) {
      const text = cm.getLine(i);
      const f = text.match(/^\s*(```|~~~)/);
      if (f) { fence = fence ? (fence === f[1] ? null : fence) : f[1]; continue; }
      if (fence) continue;
      if (/^ {0,3}#{1,6}(\s|$)/.test(text)) lines.push(i);
      else if (i + 1 < count && text.trim() && /^ {0,3}(=+|-+)\s*$/.test(cm.getLine(i + 1)) &&
               !/^\s*([-*+>]|\d+[.)])\s/.test(text)) lines.push(i);
    }
    return lines;
  }

  function buildOutline(headings) {
    if (els.outline.hidden) return;
    els.outlineList.innerHTML = '';
    if (!headings.length) {
      els.outlineList.innerHTML = '<div class="empty">No headings yet</div>';
      return;
    }
    headings.forEach((h, idx) => {
      const a = document.createElement('a');
      a.textContent = h.textContent;
      a.className = 'l' + h.tagName[1];
      a.title = h.textContent;
      a.addEventListener('click', () => {
        if (els.workspace.classList.contains('layout-preview') === false) {
          const line = sourceHeadingLines()[idx];
          if (line != null) {
            cm.setCursor({ line, ch: 0 });
            cm.scrollIntoView({ line, ch: 0 }, 80);
            cm.focus();
          }
        }
        if (!els.workspace.classList.contains('layout-editor')) {
          ignorePreviewScroll = true;
          els.previewPane.scrollTop = h.offsetTop - 16;
        }
      });
      els.outlineList.appendChild(a);
    });
  }

  /* ---------------------------------------------------------------- */
  /* Document state                                                    */
  /* ---------------------------------------------------------------- */

  const isDirty = () => !cm.isClean(doc.cleanGen);

  function updateDocState() {
    const dirty = isDirty();
    api.docState({ dirty, filePath: doc.filePath });
    els.stFile.textContent = doc.filePath || 'Untitled';
    els.stFile.title = doc.filePath || '';
    els.stSaved.textContent = dirty ? '● Unsaved changes' : (doc.filePath ? 'Saved' : '');
  }

  function updateStats() {
    const text = cm.getValue();
    const words = (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu) || []).length;
    els.stWords.textContent = `${words.toLocaleString()} word${words === 1 ? '' : 's'}`;
    els.stChars.textContent = `${text.length.toLocaleString()} chars`;
    els.stRead.textContent = `${Math.max(words ? 1 : 0, Math.round(words / 230))} min read`;
  }

  function updateCursor() {
    const c = cm.getCursor();
    const sel = cm.getSelection();
    els.stPos.textContent = `Ln ${c.line + 1}, Col ${c.ch + 1}` + (sel ? ` (${sel.length} selected)` : '');
  }

  function setDocument(content, filePath) {
    doc.filePath = filePath || null;
    cm.setValue(content || '');
    cm.clearHistory();
    doc.cleanGen = cm.changeGeneration(true);
    cm.setCursor({ line: 0, ch: 0 });
    cm.focus();
    flushRender();
    els.previewPane.scrollTop = 0;
    updateDocState();
    updateStats();
  }

  cm.on('changes', () => { scheduleRender(); updateDocState(); updateStats(); });
  cm.on('cursorActivity', updateCursor);

  /* ---------------------------------------------------------------- */
  /* File operations                                                   */
  /* ---------------------------------------------------------------- */

  async function confirmIfDirty() {
    if (!isDirty()) return true;
    const answer = await api.confirmDiscard();
    if (answer === 'cancel') return false;
    if (answer === 'save') return save(false);
    return true;
  }

  async function save(saveAs) {
    const res = await api.saveFile({ filePath: doc.filePath, content: cm.getValue(), saveAs });
    if (!res.ok) return false;
    const pathChanged = res.filePath !== doc.filePath;
    doc.filePath = res.filePath;
    doc.cleanGen = cm.changeGeneration(true);
    updateDocState();
    if (pathChanged) flushRender(); // relative image paths may now resolve
    toast(`Saved ${baseName(doc.filePath)}`);
    return true;
  }

  async function newDocument() {
    if (await confirmIfDirty()) setDocument('', null);
  }

  function docTitle() {
    if (doc.filePath) return stripExt(baseName(doc.filePath));
    const h1 = els.preview.querySelector('h1');
    return (h1 && h1.textContent.trim()) || 'Untitled';
  }

  function exportPayload() {
    flushRender();
    const clone = els.preview.cloneNode(true);
    return { html: clone.innerHTML, title: docTitle(), filePath: doc.filePath };
  }

  function exportPdf() {
    const form = els.pdfDialog.querySelector('form');
    const p = settings.pdf;
    form.pageSize.value = p.pageSize;
    form.landscape.value = String(!!p.landscape);
    form.margin.value = p.margin;
    form.pageNumbers.checked = !!p.pageNumbers;
    form.openAfterExport.checked = !!p.openAfterExport;
    els.pdfDialog.returnValue = '';
    els.pdfDialog.showModal();
  }

  els.pdfDialog.addEventListener('close', async () => {
    if (els.pdfDialog.returnValue !== 'ok') return;
    const form = els.pdfDialog.querySelector('form');
    const options = {
      pageSize: form.pageSize.value,
      landscape: form.landscape.value === 'true',
      margin: form.margin.value,
      pageNumbers: form.pageNumbers.checked,
      openAfterExport: form.openAfterExport.checked
    };
    settings.pdf = options;
    toast('Exporting PDF…');
    const res = await api.exportPdf({ ...exportPayload(), options });
    if (res.ok) toast(`PDF saved: ${baseName(res.path)}`);
  });

  async function exportHtml() {
    const res = await api.exportHtml(exportPayload());
    if (res.ok) toast(`HTML saved: ${baseName(res.path)}`);
  }

  async function print() {
    await api.print(exportPayload());
  }

  /* ---------------------------------------------------------------- */
  /* Formatting helpers                                                */
  /* ---------------------------------------------------------------- */

  function wrap(before, after = before, placeholder = 'text') {
    const sels = cm.listSelections();
    cm.operation(() => {
      const newSels = [];
      for (let i = sels.length - 1; i >= 0; i--) {
        const r = sels[i];
        const from = CodeMirror.cmpPos(r.anchor, r.head) <= 0 ? r.anchor : r.head;
        const to = from === r.anchor ? r.head : r.anchor;
        const text = cm.getRange(from, to);

        // Toggle off if already wrapped (inside or outside the selection).
        if (text.startsWith(before) && text.endsWith(after) && text.length >= before.length + after.length) {
          const inner = text.slice(before.length, text.length - after.length);
          cm.replaceRange(inner, from, to);
          newSels.push({ anchor: from, head: { line: from.line, ch: from.ch + inner.length } });
          continue;
        }
        const outerFrom = { line: from.line, ch: from.ch - before.length };
        const outerTo = { line: to.line, ch: to.ch + after.length };
        if (from.ch >= before.length && cm.getRange(outerFrom, from) === before && cm.getRange(to, outerTo) === after) {
          cm.replaceRange(text, outerFrom, outerTo);
          newSels.push({ anchor: outerFrom, head: { line: to.line, ch: to.ch - (from.line === to.line ? before.length : 0) } });
          continue;
        }

        const inner = text || placeholder;
        cm.replaceRange(before + inner + after, from, to);
        const start = { line: from.line, ch: from.ch + before.length };
        const lines = inner.split('\n');
        const end = lines.length === 1
          ? { line: start.line, ch: start.ch + inner.length }
          : { line: start.line + lines.length - 1, ch: lines[lines.length - 1].length };
        newSels.push({ anchor: start, head: end });
      }
      cm.setSelections(newSels.reverse());
    });
    cm.focus();
  }

  function selectedLineRange() {
    const from = cm.getCursor('from');
    const to = cm.getCursor('to');
    const last = to.ch === 0 && to.line > from.line ? to.line - 1 : to.line;
    return [from.line, last];
  }

  /** Toggle a per-line prefix. `make(i)` returns the prefix for the i-th line, `match` detects an existing one. */
  function prefixLines(make, match) {
    const [a, b] = selectedLineRange();
    cm.operation(() => {
      let all = true;
      for (let l = a; l <= b; l++) if (!match.test(cm.getLine(l))) { all = false; break; }
      for (let l = a, i = 0; l <= b; l++, i++) {
        const line = cm.getLine(l);
        const m = line.match(match);
        if (all) {
          cm.replaceRange(line.replace(match, '$1'), { line: l, ch: 0 }, { line: l, ch: line.length });
        } else {
          const indent = line.match(/^\s*/)[0];
          const rest = line.slice(indent.length).replace(/^(#{1,6}\s+|>\s?|[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+)/, '');
          cm.replaceRange(indent + make(i) + rest, { line: l, ch: 0 }, { line: l, ch: line.length });
          void m;
        }
      }
    });
    cm.focus();
  }

  function heading(level) {
    const prefix = '#'.repeat(level) + ' ';
    const [a, b] = selectedLineRange();
    cm.operation(() => {
      for (let l = a; l <= b; l++) {
        const line = cm.getLine(l);
        const m = line.match(/^(\s*)(#{1,6})\s+/);
        let next;
        if (m && m[2].length === level) next = line.slice(m[0].length);            // toggle off
        else if (m) next = m[1] + prefix + line.slice(m[0].length);                 // change level
        else next = prefix + line.trimStart();
        cm.replaceRange(next, { line: l, ch: 0 }, { line: l, ch: line.length });
      }
    });
    cm.focus();
  }

  function insertBlock(text, selectStart, selectLen) {
    const cur = cm.getCursor('from');
    const lineText = cm.getLine(cur.line);
    const needsLeadingNl = cur.ch > 0 || (lineText.trim() !== '' && !cm.somethingSelected());
    const prefix = needsLeadingNl ? '\n\n' : (cur.line > 0 && cm.getLine(cur.line - 1).trim() !== '' ? '\n' : '');
    const full = prefix + text + '\n';
    cm.replaceSelection(full, 'start');
    const startIdx = cm.indexFromPos(cur) + prefix.length + (selectStart ?? text.length);
    const from = cm.posFromIndex(startIdx);
    const to = cm.posFromIndex(startIdx + (selectLen || 0));
    cm.setSelection(from, to);
    cm.focus();
  }

  function insertLink(image) {
    const sel = cm.getSelection();
    const isUrl = /^(https?:\/\/|www\.)\S+$/i.test(sel.trim());
    if (isUrl) {
      const text = `${image ? '!' : ''}[](${sel.trim()})`;
      const from = cm.getCursor('from');
      cm.replaceSelection(text);
      cm.setCursor({ line: from.line, ch: from.ch + (image ? 2 : 1) });
    } else {
      const label = sel || (image ? 'alt text' : 'link text');
      const url = image ? 'image.png' : 'https://';
      const text = `${image ? '!' : ''}[${label}](${url})`;
      const from = cm.getCursor('from');
      cm.replaceSelection(text);
      const urlStart = from.ch + (image ? 2 : 1) + label.length + 2;
      cm.setSelection({ line: from.line, ch: urlStart }, { line: from.line, ch: urlStart + url.length });
    }
    cm.focus();
  }

  const TABLE = '| Column 1 | Column 2 | Column 3 |\n| -------- | -------- | -------- |\n| Cell     | Cell     | Cell     |\n| Cell     | Cell     | Cell     |';

  /* ---------------------------------------------------------------- */
  /* Layout, theme, settings                                           */
  /* ---------------------------------------------------------------- */

  const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

  function effectiveTheme() {
    return settings.theme === 'system' ? (darkQuery.matches ? 'dark' : 'light') : settings.theme;
  }

  function applyTheme() {
    const dark = effectiveTheme() === 'dark';
    els.root.dataset.theme = dark ? 'dark' : 'light';
    $('#md-light').disabled = dark;
    $('#md-dark').disabled = !dark;
    $('#hl-light').disabled = dark;
    $('#hl-dark').disabled = !dark;
  }
  darkQuery.addEventListener('change', applyTheme);

  function setLayout(layout, persist = true) {
    els.workspace.classList.remove('layout-split', 'layout-editor', 'layout-preview');
    els.workspace.classList.add('layout-' + layout);
    document.querySelectorAll('[data-layout]').forEach((b) => b.classList.toggle('active', b.dataset.layout === layout));
    settings.layout = layout;
    if (persist) api.setSetting('layout', layout);
    if (layout !== 'preview') setTimeout(() => cm.refresh(), 0);
  }

  function setOutline(show, persist = true) {
    els.outline.hidden = !show;
    $('#outlineBtn').classList.toggle('active', show);
    settings.showOutline = show;
    if (persist) api.setSetting('showOutline', show);
    if (show) render();
    setTimeout(() => cm.refresh(), 0);
  }

  function setFontSize(size) {
    settings.fontSize = Math.min(32, Math.max(10, size));
    els.root.style.setProperty('--editor-font-size', settings.fontSize + 'px');
    els.preview.style.fontSize = Math.round(settings.fontSize * 16 / 15) + 'px';
    api.setSetting('fontSize', settings.fontSize);
    cm.refresh();
  }

  function applySettings(s) {
    settings = s;
    applyTheme();
    cm.setOption('lineWrapping', !!s.wordWrap);
    cm.setOption('spellcheck', !!s.spellcheck);
    els.root.style.setProperty('--editor-font-size', s.fontSize + 'px');
    els.preview.style.fontSize = Math.round(s.fontSize * 16 / 15) + 'px';
    cm.refresh();
  }

  /* ---------------------------------------------------------------- */
  /* Resizable divider                                                 */
  /* ---------------------------------------------------------------- */

  (function setupDivider() {
    let dragging = false;
    els.divider.addEventListener('mousedown', (e) => {
      dragging = true;
      els.divider.classList.add('dragging');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      e.preventDefault();
    });
    window.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const rect = els.workspace.getBoundingClientRect();
      const outlineW = els.outline.hidden ? 0 : els.outline.offsetWidth;
      const usable = rect.width - outlineW;
      const pct = Math.min(85, Math.max(15, ((e.clientX - rect.left - outlineW) / usable) * 100));
      els.editorPane.style.flexBasis = pct + '%';
      els.previewPane.style.flexBasis = (100 - pct) + '%';
    });
    window.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      els.divider.classList.remove('dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      cm.refresh();
    });
    els.divider.addEventListener('dblclick', () => {
      els.editorPane.style.flexBasis = '50%';
      els.previewPane.style.flexBasis = '50%';
      cm.refresh();
    });
  })();

  /* ---------------------------------------------------------------- */
  /* Scroll sync                                                       */
  /* ---------------------------------------------------------------- */

  let ignoreEditorScroll = false;
  let ignorePreviewScroll = false;

  cm.on('scroll', () => {
    if (!settings.syncScroll || !els.workspace.classList.contains('layout-split')) return;
    if (ignoreEditorScroll) { ignoreEditorScroll = false; return; }
    const info = cm.getScrollInfo();
    const max = info.height - info.clientHeight;
    const ratio = max > 0 ? info.top / max : 0;
    const pMax = els.previewPane.scrollHeight - els.previewPane.clientHeight;
    ignorePreviewScroll = true;
    els.previewPane.scrollTop = ratio * pMax;
  });

  els.previewPane.addEventListener('scroll', () => {
    if (!settings.syncScroll || !els.workspace.classList.contains('layout-split')) return;
    if (ignorePreviewScroll) { ignorePreviewScroll = false; return; }
    const pMax = els.previewPane.scrollHeight - els.previewPane.clientHeight;
    const ratio = pMax > 0 ? els.previewPane.scrollTop / pMax : 0;
    const info = cm.getScrollInfo();
    ignoreEditorScroll = true;
    cm.scrollTo(null, ratio * (info.height - info.clientHeight));
  });

  /* ---------------------------------------------------------------- */
  /* Links inside the preview                                          */
  /* ---------------------------------------------------------------- */

  els.preview.addEventListener('click', (e) => {
    const a = e.target.closest('a[href]');
    if (!a) return;
    e.preventDefault();
    const href = a.getAttribute('href');
    if (href.startsWith('#')) {
      const target = document.getElementById(decodeURIComponent(href.slice(1)));
      if (target) els.previewPane.scrollTop = target.offsetTop - 16;
    } else if (/^(https?:|mailto:)/i.test(href)) {
      window.open(href); // main process opens it in the default browser
    } else if (doc.filePath && /\.(md|markdown)(#.*)?$/i.test(href)) {
      const rel = decodeURIComponent(href.replace(/#.*$/, ''));
      const abs = /^[a-z]:[\\/]|^[\\/]/i.test(rel) ? rel : dirOf(doc.filePath) + '\\' + rel.replace(/\//g, '\\');
      api.openPath(abs);
    }
  });

  /* ---------------------------------------------------------------- */
  /* Drag & drop                                                       */
  /* ---------------------------------------------------------------- */

  const hasFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
  let dragDepth = 0;

  window.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    dragDepth++;
    els.dropOverlay.hidden = false;
  }, true);
  window.addEventListener('dragleave', (e) => {
    if (!hasFiles(e)) return;
    if (--dragDepth <= 0) { dragDepth = 0; els.dropOverlay.hidden = true; }
  }, true);
  window.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
  }, true);
  window.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();
    dragDepth = 0;
    els.dropOverlay.hidden = true;

    const images = [];
    for (const file of e.dataTransfer.files) {
      const p = api.pathForFile(file);
      if (!p) continue;
      if (/\.(png|jpe?g|gif|svg|webp|bmp|avif)$/i.test(p)) images.push(p);
      else api.openPath(p);
    }
    if (images.length) {
      const pos = cm.coordsChar({ left: e.clientX, top: e.clientY }, 'window');
      if (e.target.closest && e.target.closest('.CodeMirror')) cm.setCursor(pos);
      const md = images.map((p) => `![${stripExt(baseName(p)).replace(/\.[^.]+$/, '')}](${relativeImagePath(p)})`).join('\n');
      cm.replaceSelection(md);
      cm.focus();
    }
  }, true);

  function relativeImagePath(p) {
    const base = dirOf(doc.filePath);
    let out;
    if (base && p.toLowerCase().startsWith(base.toLowerCase() + '\\')) {
      out = p.slice(base.length + 1).replace(/\\/g, '/');
    } else {
      out = p.replace(/\\/g, '/');
    }
    return /[\s()]/.test(out) ? `<${out}>` : out;
  }

  /* ---------------------------------------------------------------- */
  /* Toast                                                             */
  /* ---------------------------------------------------------------- */

  let toastTimer = null;
  function toast(msg) {
    els.toast.textContent = msg;
    els.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.remove('show'), 2200);
  }

  /* ---------------------------------------------------------------- */
  /* Actions (menu + toolbar)                                          */
  /* ---------------------------------------------------------------- */

  const actions = {
    new: newDocument,
    open: () => api.openDialog(),
    save: () => save(false),
    saveAs: () => save(true),
    exportPdf,
    exportHtml,
    print,
    saveAndClose: async () => { if (await save(false)) api.forceClose(); },

    undo: () => { cm.undo(); cm.focus(); },
    redo: () => { cm.redo(); cm.focus(); },
    selectAll: () => {
      if (document.activeElement && cm.getWrapperElement().contains(document.activeElement)) cm.execCommand('selectAll');
      else if (els.preview.contains(document.activeElement) || document.activeElement === document.body) {
        const range = document.createRange();
        range.selectNodeContents(els.preview);
        const s = window.getSelection(); s.removeAllRanges(); s.addRange(range);
      } else document.execCommand('selectAll');
    },
    find: () => { cm.focus(); cm.execCommand('find'); },
    findNext: () => cm.execCommand('findNext'),
    findPrev: () => cm.execCommand('findPrev'),
    replace: () => { cm.focus(); cm.execCommand('replace'); },
    gotoLine: () => { cm.focus(); cm.execCommand('jumpToLine'); },
    insertDate: () => { cm.replaceSelection(new Date().toLocaleString()); cm.focus(); },

    bold: () => wrap('**', '**', 'bold text'),
    italic: () => wrap('*', '*', 'italic text'),
    strike: () => wrap('~~', '~~', 'strikethrough'),
    code: () => wrap('`', '`', 'code'),
    h1: () => heading(1),
    h2: () => heading(2),
    h3: () => heading(3),
    ul: () => prefixLines(() => '- ', /^(\s*)[-*+]\s+(?!\[[ xX]\])/),
    ol: () => prefixLines((i) => `${i + 1}. `, /^(\s*)\d+[.)]\s+/),
    task: () => prefixLines(() => '- [ ] ', /^(\s*)[-*+]\s+\[[ xX]\]\s+/),
    quote: () => prefixLines(() => '> ', /^(\s*)>\s?/),
    link: () => insertLink(false),
    image: () => insertLink(true),
    codeblock: () => {
      const sel = cm.getSelection();
      if (sel) { cm.replaceSelection('```\n' + sel + '\n```'); cm.focus(); }
      else insertBlock('```language\n\n```', 3, 8);
    },
    table: () => insertBlock(TABLE, 2, 8),
    hr: () => insertBlock('---'),
    pagebreak: () => insertBlock('<!-- pagebreak -->'),

    layoutEditor: () => setLayout('editor'),
    layoutSplit: () => setLayout('split'),
    layoutPreview: () => setLayout('preview'),
    toggleOutline: () => setOutline(els.outline.hidden),
    toggleTheme: () => {
      const next = effectiveTheme() === 'dark' ? 'light' : 'dark';
      settings.theme = next;
      applyTheme();
      api.setSetting('theme', next);
    },
    fontUp: () => setFontSize(settings.fontSize + 1),
    fontDown: () => setFontSize(settings.fontSize - 1),
    fontReset: () => setFontSize(15),
    cheatsheet: () => els.cheatDialog.showModal()
  };

  document.querySelectorAll('.toolbar [data-action]').forEach((btn) => {
    btn.addEventListener('mousedown', (e) => e.preventDefault()); // keep editor selection
    btn.addEventListener('click', () => actions[btn.dataset.action]?.());
  });

  api.onMenu((action, payload) => {
    if (action === 'loadFile') {
      setDocument(payload.content, payload.filePath);
      toast(`Opened ${baseName(payload.filePath)}`);
    } else if (action === 'settings') {
      applySettings(payload);
    } else if (actions[action]) {
      if (document.querySelector('dialog[open]') && !['saveAndClose'].includes(action)) return;
      actions[action]();
    }
  });

  /* ---------------------------------------------------------------- */
  /* Init                                                              */
  /* ---------------------------------------------------------------- */

  applySettings(settings);
  setLayout(settings.layout || 'split', false);
  setOutline(!!settings.showOutline, false);
  render();
  updateDocState();
  updateStats();
  updateCursor();
})();
