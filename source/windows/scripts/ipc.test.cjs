'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { createRequire } = require('node:module');

async function boot() {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-native-'));
  const handlers = new Map();
  const listeners = new Map();
  const windows = [];
  const responses = [];
  const messages = [];
  const clipboardWrites = [];
  const timers = [];
  const messageBoxes = [];
  const saveDialogs = [], openDialogs = [];
  let protocolHandler;
  const electron = {
    app: {
      enableSandbox() {}, setAppUserModelId() {}, requestSingleInstanceLock: () => true,
      on() {}, whenReady: () => Promise.resolve(), quit() {}, getVersion: () => '3.0.0',
      getPath: () => temp, setPath: (key, value) => { assert.equal(key, 'userData'); assert.equal(value, path.join(temp, 'Bülten Studio')); }
    },
    BrowserWindow: class {
      constructor(options) {
        this.options = options;
        this.events = new Map();
        this.destroyed = false;
        this.webContents = { mainFrame: { url: 'bulten://app/index.html' }, send: (...args) => messages.push(args), setWindowOpenHandler() {}, on() {} };
        windows.push(this);
      }
      static getAllWindows() { return windows; }
      isDestroyed() { return this.destroyed; }
      close() {
        let prevented = false;
        this.events.get('close')?.({ preventDefault() { prevented = true; } });
        if (!prevented) { this.destroyed = true; this.events.get('closed')?.(); }
      }
      once() {} on(name, handler) { this.events.set(name, handler); } loadURL() {} show() {}
    },
    Menu: { setApplicationMenu() {}, buildFromTemplate: value => value },
    dialog: { showSaveDialog: async (_window, options) => { saveDialogs.push(options); return responses.shift(); }, showOpenDialog: async (_window, options) => { openDialogs.push(options); return responses.shift(); }, showErrorBox() {}, showMessageBox: async (_window, options) => { messageBoxes.push(options); return responses.shift(); } },
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler), on: (channel, listener) => listeners.set(channel, listener) },
    clipboard: { writeText: text => clipboardWrites.push(text) },
    nativeImage: { createFromBuffer: () => ({ isEmpty: () => false, getSize: () => ({ width: 512, height: 512 }) }) },
    protocol: { registerSchemesAsPrivileged() {}, handle: (_scheme, handler) => { protocolHandler = handler; } },
    screen: { getPrimaryDisplay: () => ({ workAreaSize: { width: 1366, height: 728 } }) },
    session: { defaultSession: { setPermissionRequestHandler() {}, setPermissionCheckHandler() {}, on() {}, webRequest: { onBeforeRequest() {} } } }
  };
  const mainPath = path.join(__dirname, '..', 'native', 'main.cjs');
  const nativeRequire = createRequire(mainPath);
  const updates = { UpdateManager: class {
    async init() {}
    getState() { return { status: 'disabled', configured: false, autoCheck: false }; }
  } };
  vm.runInNewContext(await fs.readFile(mainPath, 'utf8'), {
    require: value => value === 'electron' ? electron : value === './update-manager.cjs' ? updates : nativeRequire(value),
    __dirname: path.dirname(mainPath), process, Buffer, Response, URL, console,
    setTimeout: (fn, delay) => { const timer = { fn, delay, unref() {} }; timers.push(timer); return timer; },
    clearTimeout: timer => { if (timer) timer.canceled = true; }
  }, { filename: mainPath });
  for (let i = 0; i < 10 && !windows.length; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(windows.length, 1);
  assert.equal(windows[0].options.width, 1366);
  assert.equal(windows[0].options.height, 728);
  assert.equal(windows[0].options.minWidth, 1120);
  assert.equal(windows[0].options.minHeight, 720);
  const webContents = windows[0].webContents;
  const event = { sender: webContents, senderFrame: webContents.mainFrame };
  const invoke = (channel, ...args) => handlers.get(channel)(event, ...args);
  return { temp, handlers, listeners, windows, responses, messages, clipboardWrites, protocolHandler, webContents, event, invoke, timers, messageBoxes, saveDialogs, openDialogs };
}

test('native IPC confines callers, opens/saves projects, and exports without overwriting', async () => {
  const { temp, handlers, listeners, windows, responses, messages, clipboardWrites, protocolHandler, webContents, event, invoke, saveDialogs, openDialogs } = await boot();
  try {
    const untrusted = await handlers.get('studio:save-project')({ sender: {}, senderFrame: { url: 'https://evil.example' } }, '{}');
    assert.equal(untrusted.ok, false);
    const wrongFrame = await handlers.get('studio:save-project')({ sender: webContents, senderFrame: { url: 'bulten://app/index.html' } }, '{}');
    assert.equal(wrongFrame.ok, false);
    const info = await invoke('studio:info');
    assert.equal(info.version, '3.0.0');
    webContents.mainFrame.url += '#';
    assert.equal((await invoke('studio:info')).version, '3.0.0');
    webContents.mainFrame.url = 'bulten://app/index.html';
    responses.push({ canceled: true });
    assert.equal((await invoke('studio:save-project', '{}', 'demo')).canceled, true);
    assert.deepEqual(Array.from(saveDialogs[0].filters[0].extensions), ['inkreel']);
    assert.equal(path.extname(saveDialogs[0].defaultPath), '.inkreel');
    const project = path.join(temp, 'demo.inkreel');
    const json = '{"schema":3,"slides":[{"title":"Haber"}]}';
    responses.push({ canceled: false, filePath: project });
    assert.equal((await invoke('studio:save-project', json, '../../demo')).ok, true);
    assert.equal(await fs.readFile(project, 'utf8'), json);
    const protectedProject = path.join(temp, 'protected.json.inkreel');
    await fs.writeFile(protectedProject, 'existing project');
    responses.push({ canceled: false, filePath: path.join(temp, 'protected.json') }, { response: 0 });
    assert.equal((await invoke('studio:save-project', json, 'protected')).canceled, true);
    assert.equal(await fs.readFile(protectedProject, 'utf8'), 'existing project');
    responses.push({ canceled: false, filePaths: [project] });
    assert.equal((await invoke('studio:open-project')).json, json);
    assert.deepEqual(Array.from(openDialogs[0].filters[0].extensions), ['inkreel', 'karevo', 'bulten', 'netice', 'json']);
    const png = 'data:image/png;base64,' + (await fs.readFile(path.join(__dirname, '..', 'native', 'icon.png'))).toString('base64');
    await fs.writeFile(path.join(temp, 'news.png'), 'existing');
    responses.push({ canceled: false, filePaths: [temp] });
    const exported = await invoke('studio:export-images', [{ name: '../../news.png', dataUrl: png }, { name: 'news.png', dataUrl: png }]);
    assert.equal(exported.ok, true); assert.equal(exported.count, 2);
    assert.equal(await fs.readFile(path.join(temp, 'news.png'), 'utf8'), 'existing');
    assert((await fs.stat(path.join(temp, 'news-2.png'))).size > 100);
    assert((await fs.stat(path.join(temp, 'news-2-2.png'))).size > 100);
    const savedImage = path.join(temp, 'one.png');
    responses.push({ canceled: false, filePath: savedImage });
    assert.equal((await invoke('studio:save-image', png, 'one')).ok, true);
    assert((await fs.stat(savedImage)).size > 100);
    const invalid = await invoke('studio:save-image', 'data:image/svg+xml;base64,PHN2Zz4=', 'x');
    assert.equal(invalid.ok, false);
    const legacy = path.join(temp, 'legacy.netice');
    await fs.writeFile(legacy, '{"schema":2,"slides":[]}');
    responses.push({ canceled: false, filePaths: [legacy] });
    assert.equal((await invoke('studio:open-project')).json, '{"schema":2,"slides":[]}');
    const bomProject = path.join(temp, 'utf8-bom.bulten');
    const bomJson = '{"schema":3,"title":"Türkçe çalışma: ğüşiöç İĞÜŞÖÇ","slides":[]}';
    await fs.writeFile(bomProject, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(bomJson, 'utf8')]));
    responses.push({ canceled: false, filePaths: [bomProject] });
    const openedBom = await invoke('studio:open-project');
    assert.equal(openedBom.ok, true, 'A valid Windows UTF-8 BOM project opens like the browser file picker');
    assert.equal(openedBom.json, bomJson, 'Strip only the leading BOM and preserve Turkish project content');
    const invalidUtf8 = path.join(temp, 'invalid-utf8.bulten');
    await fs.writeFile(invalidUtf8, Buffer.concat([Buffer.from('{"title":"'), Buffer.from([0x80]), Buffer.from('"}') ]));
    responses.push({ canceled: false, filePaths: [invalidUtf8] });
    const invalidProject = await invoke('studio:open-project');
    assert.equal(invalidProject.ok, false, 'Malformed project text must not be silently replaced and imported');
    assert.match(invalidProject.error, /UTF-8/);
    const videoBytes = await fs.readFile(path.join(__dirname, 'fixtures', 'video.mp4'));
    const videoPath = path.join(temp, 'clip.mp4');
    responses.push({ canceled: false, filePath: videoPath });
    assert.equal((await invoke('studio:save-video', 'data:video/mp4;base64,' + videoBytes.toString('base64'), '../../clip.mp4')).ok, true);
    assert((await fs.readFile(videoPath)).equals(videoBytes));
    assert.equal((await invoke('studio:save-video', 'data:video/mp4;base64,AAAA', 'bad.mp4')).ok, false);
    const textPath = path.join(temp, 'plan.csv');
    responses.push({ canceled: false, filePath: textPath });
    assert.equal((await invoke('studio:save-text', 'Başlık;Tarih\nHaber;2026-10-19', '../../plan.csv')).ok, true);
    assert.equal(await fs.readFile(textPath, 'utf8'), 'Başlık;Tarih\nHaber;2026-10-19');
    assert.equal((await invoke('studio:save-text', '<script>bad</script>', 'bad.html')).ok, false);
    assert.equal((await invoke('studio:copy-text', 'Paylaşım açıklaması')).ok, true);
    assert.deepEqual(clipboardWrites, ['Paylaşım açıklaması']);
    assert.equal((await invoke('studio:copy-text', 'a'.repeat(10001))).ok, false);
    assert.equal((await handlers.get('studio:copy-text')({ sender: {}, senderFrame: {} }, 'untrusted')).ok, false);
    assert.equal(clipboardWrites.length, 1);
    const response = await protocolHandler({ method: 'GET', url: 'bulten://app/fonts.css' });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-security-policy'), /connect-src 'none'/);
    const denied = await protocolHandler({ method: 'GET', url: 'bulten://app/%2e%2e%2fnative/main.cjs' });
    assert.equal(denied.status, 404);
    const finishClose = listeners.get('studio:finish-close');
    finishClose(event);
    assert.equal(windows[0].isDestroyed(), false, 'unsolicited close acknowledgments do not close the app');
    windows[0].close();
    windows[0].close();
    assert.equal(windows[0].isDestroyed(), false);
    assert.equal(messages.filter(message => message[0] === 'studio:before-close').length, 1, 'repeated closes request only one final save');
    finishClose({ sender: {}, senderFrame: {} });
    assert.equal(windows[0].isDestroyed(), false, 'untrusted acknowledgments cannot close the app');
    assert.equal((await invoke('studio:open-project')).ok, false, 'no new native file dialogs during close');
    finishClose(event);
    assert.equal(windows[0].isDestroyed(), true, 'trusted pending close acknowledgment completes close');
  } finally { await fs.rm(temp, { recursive: true, force: true }); }
});

test('native close cancels on failed final save and accepts successful or legacy acknowledgments', async () => {
  for (const saved of [true, undefined]) {
    const b = await boot();
    try {
      const win = b.windows[0], finishClose = b.listeners.get('studio:finish-close');
      win.close();
      finishClose(b.event, false);
      assert.equal(win.isDestroyed(), false, 'A failed save keeps the editor open');
      assert(b.timers.find(timer => timer.delay === 5000).canceled);
      b.responses.push({ canceled: true });
      assert.equal((await b.invoke('studio:save-project', '{}', 'recovery')).canceled, true, 'Save failure unlocks the file picker for recovery');
      finishClose(b.event, true);
      assert.equal(win.isDestroyed(), false, 'A late acknowledgment cannot close a canceled request');
      win.close();
      finishClose({ sender: {}, senderFrame: {} }, true);
      assert.equal(win.isDestroyed(), false);
      finishClose(b.event, saved);
      assert.equal(win.isDestroyed(), true);
    } finally { await fs.rm(b.temp, { recursive: true, force: true }); }
  }
});

test('native close timeout requires explicit confirmation before discarding an unacknowledged save', async () => {
  for (const response of [0, 1]) {
    const b = await boot();
    try {
      const win = b.windows[0];
      win.close();
      const timer = b.timers.find(timer => timer.delay === 5000 && !timer.canceled);
      assert(timer);
      assert.equal(win.isDestroyed(), false);
      b.responses.push({ response });
      await timer.fn();
      assert.equal(b.messageBoxes.length, 1);
      assert.equal(b.messageBoxes[0].defaultId, 0);
      assert.equal(b.messageBoxes[0].cancelId, 0);
      assert.equal(win.isDestroyed(), response === 1, 'Only the explicit discard choice closes the editor');
      if (response === 0) {
        b.responses.push({ canceled: true });
        assert.equal((await b.invoke('studio:open-project')).canceled, true, 'Returning to the editor cancels the close lock');
      }
    } finally { await fs.rm(b.temp, { recursive: true, force: true }); }
  }
});
