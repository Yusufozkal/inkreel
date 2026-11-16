'use strict';

const { app, BrowserWindow, Menu, clipboard, dialog, ipcMain, nativeImage, protocol, screen, session } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { TextDecoder } = require('node:util');
const { MAX_PROJECT, validateProject, safeName, prepareImages, decodeVideo, prepareText, validateClipboard, assetPath } = require('./validators.cjs');
const { UpdateManager } = require('./update-manager.cjs');
const UPDATE_PUBLIC_KEY = require('./update-public-key.json');

const ENTRY = 'bulten://app/index.html';
const UI_ROOT = path.join(__dirname, '..', 'ui');
const CSP = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src blob:; font-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; worker-src 'none'";
let mainWindow;
let fileOperation = false;
let pendingClose = false;
let closeApproved = false;
let closeTimer;
let updateManager;
let updateReady = false;
let installPending = false;
let autoUpdateTimer;
let lastAutoUpdateAttempt = 0;
const UPDATE_INTERVAL = 24 * 60 * 60 * 1000;

// Keep the original Electron user-data location across the visible rename.
// This preserves local projects, settings and the trusted update sequence.
app.setPath('userData', path.join(app.getPath('appData'), 'Bülten Studio'));
app.enableSandbox();
app.setAppUserModelId('com.bultenstudio.app');
protocol.registerSchemesAsPrivileged([{ scheme: 'bulten', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);

function sendCommand(command) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('studio:command', command);
}

function trustedSender(event) {
  return mainWindow && !mainWindow.isDestroyed() && event.sender === mainWindow.webContents && event.senderFrame === mainWindow.webContents.mainFrame && isEntryUrl(event.senderFrame.url);
}

function isEntryUrl(url) {
  return typeof url === 'string' && (url === ENTRY || url.startsWith(ENTRY + '#'));
}

function installHandler(channel, handler, usesDialog = true) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (!trustedSender(event)) return { ok: false, error: 'Bu işlem yalnızca Inkreel içinden kullanılabilir.' };
    if (usesDialog && (pendingClose || installPending)) return { ok: false, error: 'Uygulama kapanıyor. Dosya işlemi başlatılamadı.' };
    if (usesDialog && fileOperation) return { ok: false, error: 'Açık dosya işlemini tamamlayın.' };
    if (usesDialog) fileOperation = true;
    try { return await handler(...args); }
    catch (error) {
      const message = error && typeof error.message === 'string' ? error.message : 'Dosya işlemi tamamlanamadı.';
      return { ok: false, error: message.replace(/(?:[A-Za-z]:\\|\/)(?:[^\s:]+[\\/])+[^\s:]*/g, '[dosya]') };
    } finally { if (usesDialog) fileOperation = false; }
  });
}

function updateState() {
  if (!updateReady || !updateManager) return {
    status: 'disabled', currentVersion: app.getVersion(), configured: false,
    autoCheck: false, feedUrl: '', progress: 0, canDownload: false, canInstall: false,
    error: 'Güncelleme sistemi şu anda kullanılamıyor. Editöre devam edebilirsiniz.'
  };
  return updateManager.getState();
}

function requireUpdates(allowFileOperation = false) {
  if (!updateReady || !updateManager) throw new Error('Güncelleme sistemi henüz hazır değil.');
  if (pendingClose || installPending) throw new Error('Uygulama kapanıyor. Güncelleme işlemi başlatılamadı.');
  if (!allowFileOperation && fileOperation) throw new Error('Açık dosya işlemini tamamlayın.');
  return updateManager;
}

function sendUpdateState(state) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('studio:update-state', state);
}

async function initializeUpdates() {
  try {
    updateManager = new UpdateManager({
      appVersion: app.getVersion(), userDataDir: app.getPath('userData'), publicKey: UPDATE_PUBLIC_KEY,
      platform: process.platform, arch: process.arch, onState: sendUpdateState
    });
    await updateManager.init();
    updateReady = true;
  } catch (_) {
    // A broken update cache/config must never prevent the offline editor opening.
    updateReady = false;
  }
}

function scheduleAutoUpdateCheck(minimumDelay = 5000) {
  clearTimeout(autoUpdateTimer);
  const state = updateState();
  if (!updateReady || !state.configured || !state.autoCheck || state.status === 'disabled') return;
  const rawLast = state.lastCheckedAt;
  const lastTrustedCheck = typeof rawLast === 'number' ? rawLast : Date.parse(rawLast || '') || 0;
  const last = Math.max(lastTrustedCheck, lastAutoUpdateAttempt);
  const delay = Math.max(minimumDelay, Math.min(UPDATE_INTERVAL, last + UPDATE_INTERVAL - Date.now()));
  autoUpdateTimer = setTimeout(async () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const current = updateState();
    if (fileOperation || pendingClose || installPending || ['checking', 'downloading'].includes(current.status)) {
      scheduleAutoUpdateCheck(60 * 1000);
      return;
    }
    lastAutoUpdateAttempt = Date.now();
    try { await updateManager.check(); } catch (_) { /* Status is available in Updates; keep the editor quiet. */ }
    scheduleAutoUpdateCheck(60 * 60 * 1000);
  }, delay);
  if (typeof autoUpdateTimer.unref === 'function') autoUpdateTimer.unref();
}

async function backupBeforeUpdate(json) {
  validateProject(json);
  const directory = path.join(app.getPath('userData'), 'update-backups');
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const name = 'project-before-update-' + new Date().toISOString().replace(/[:.]/g, '-') + '-' + crypto.randomUUID() + '.inkreel';
  await atomicWrite(path.join(directory, name), json);
  const pattern = /^project-before-update-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[0-9a-f-]{36}\.(?:inkreel|karevo|bulten)$/;
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const older = entries.filter(entry => entry.isFile() && entry.name !== name && pattern.test(entry.name))
    .map(entry => entry.name).sort().reverse();
  for (const filename of older.slice(2)) await fs.rm(path.join(directory, filename), { force: true }).catch(() => {});
  return name;
}

async function installDownloadedUpdate(json) {
  const manager = requireUpdates(true);
  const state = manager.getState();
  if (!state.canInstall || !['downloaded', 'error'].includes(state.status)) throw new Error('Önce güncellemenin indirilmesini tamamlayın.');
  validateProject(json);
  installPending = true;
  let launched = false;
  try {
    await manager.getVerifiedInstaller();
    const backupName = await backupBeforeUpdate(json);
    // launchInstaller verifies the signed metadata and cached bytes again,
    // then starts only the pinned installer. It waits for our PID to exit.
    await manager.launchInstaller({ parentPid: process.pid });
    launched = true;
    clearTimeout(autoUpdateTimer);
    setTimeout(() => {
      if (!mainWindow || mainWindow.isDestroyed()) { app.quit(); return; }
      clearTimeout(closeTimer);
      pendingClose = false;
      closeApproved = true;
      mainWindow.close();
    }, 250);
    return { ok: true, installing: true, backupName };
  } finally {
    if (!launched) installPending = false;
  }
}

async function atomicWrite(filename, bytes) {
  const temporary = path.join(path.dirname(filename), '.studio-' + crypto.randomUUID() + '.tmp');
  try {
    await fs.writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 });
    await fs.rename(temporary, filename);
  } finally { await fs.rm(temporary, { force: true }).catch(() => {}); }
}

function forceExtension(filename, extension) {
  return filename.toLowerCase().endsWith(extension) ? filename : filename + extension;
}

async function chooseFinalPath(filename, extension) {
  const finalPath = forceExtension(filename, extension);
  if (finalPath !== filename) {
    let exists = false;
    try { await fs.access(finalPath); exists = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (exists) {
      const result = await dialog.showMessageBox(mainWindow, {
        type: 'question', title: 'Dosyanın üzerine yazılsın mı?',
        message: path.basename(finalPath) + ' zaten var.',
        detail: 'Seçilen dosya adı uzantıyla tamamlandığında mevcut bir dosyayla aynı oluyor.',
        buttons: ['Vazgeç', 'Üzerine yaz'], defaultId: 0, cancelId: 0, noLink: true
      });
      if (result.response !== 1) return null;
    }
  }
  return finalPath;
}

function checkDecodedImage(item) {
  const image = nativeImage.createFromBuffer(item.bytes);
  if (image.isEmpty()) throw new Error('Görsel çözümlenemedi.');
  const size = image.getSize();
  if (size.width !== item.width || size.height !== item.height) throw new Error('Görsel boyutu geçersiz.');
}

async function saveSingle(item) {
  checkDecodedImage(item);
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Görseli kaydet',
    defaultPath: path.join(app.getPath('pictures'), item.name),
    filters: [{ name: item.ext === '.png' ? 'PNG görseli' : 'JPEG görseli', extensions: [item.ext.slice(1)] }],
    properties: ['createDirectory', 'showOverwriteConfirmation']
  });
  if (result.canceled || !result.filePath) return { ok: false, canceled: true };
  const filename = await chooseFinalPath(result.filePath, item.ext);
  if (!filename) return { ok: false, canceled: true };
  await atomicWrite(filename, item.bytes);
  return { ok: true, count: 1, name: path.basename(filename), folder: path.dirname(filename) };
}

async function saveImages(items) {
  const images = prepareImages(items);
  if (images.length === 1) return saveSingle(images[0]);
  images.forEach(checkDecodedImage);
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Görsellerin kaydedileceği klasörü seçin',
    defaultPath: app.getPath('pictures'),
    properties: ['openDirectory', 'createDirectory']
  });
  if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true };
  const folder = result.filePaths[0];
  let count = 0;
  for (const image of images) {
    const stem = image.name.slice(0, -image.ext.length);
    let written = false;
    for (let suffix = 0; suffix < 10000; suffix++) {
      const candidate = stem + (suffix ? '-' + (suffix + 1) : '') + image.ext;
      try {
        await fs.writeFile(path.join(folder, candidate), image.bytes, { flag: 'wx', mode: 0o600 });
        written = true;
        break;
      } catch (error) { if (error.code !== 'EEXIST') throw new Error(`${count} görsel kaydedildi. Kalan görseller yazılamadı: ${error.message}`); }
    }
    if (!written) throw new Error(`${count} görsel kaydedildi. Aynı adlı dosya sınırına ulaşıldı.`);
    count++;
  }
  return { ok: true, count, folder };
}

async function saveDocument(item, title, directory, filterName) {
  const result = await dialog.showSaveDialog(mainWindow, {
    title, defaultPath: path.join(app.getPath(directory), item.name),
    filters: [{ name: filterName, extensions: [item.ext.slice(1)] }],
    properties: ['createDirectory', 'showOverwriteConfirmation']
  });
  if (result.canceled || !result.filePath) return { ok: false, canceled: true };
  const filename = await chooseFinalPath(result.filePath, item.ext);
  if (!filename) return { ok: false, canceled: true };
  await atomicWrite(filename, item.bytes);
  return { ok: true, count: 1, name: path.basename(filename), folder: path.dirname(filename) };
}

function installIpc() {
  ipcMain.on('studio:finish-close', (event, saved = true) => {
    if (trustedSender(event) && pendingClose) finishClose(saved);
  });
  installHandler('studio:info', async () => ({ platform: process.platform, version: app.getVersion(), updateCapable: updateReady && updateState().status !== 'disabled' }), false);
  installHandler('studio:update-state', async () => ({ ok: true, state: updateState() }), false);
  installHandler('studio:update-configure', async options => {
    const state = await requireUpdates().configure(options);
    scheduleAutoUpdateCheck();
    return { ok: true, state };
  }, false);
  installHandler('studio:update-check', async () => {
    const state = await requireUpdates().check();
    scheduleAutoUpdateCheck();
    return { ok: true, state };
  }, false);
  installHandler('studio:update-download', async () => ({ ok: true, state: await requireUpdates().download() }), false);
  installHandler('studio:update-install', installDownloadedUpdate);
  installHandler('studio:save-project', async (json, suggestedName) => {
    validateProject(json);
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Inkreel projesini kaydet',
      defaultPath: path.join(app.getPath('documents'), safeName(suggestedName, 'Inkreel-Projem', '.inkreel')),
      filters: [{ name: 'Inkreel projesi', extensions: ['inkreel'] }],
      properties: ['createDirectory', 'showOverwriteConfirmation']
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    const filename = await chooseFinalPath(result.filePath, '.inkreel');
    if (!filename) return { ok: false, canceled: true };
    await atomicWrite(filename, json);
    return { ok: true, name: path.basename(filename) };
  });
  installHandler('studio:open-project', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Inkreel projesi aç',
      defaultPath: app.getPath('documents'),
      filters: [{ name: 'Desteklenen proje dosyaları', extensions: ['inkreel', 'karevo', 'bulten', 'netice', 'json'] }],
      properties: ['openFile']
    });
    if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true };
    const filename = result.filePaths[0];
    const file = await fs.open(filename, 'r');
    let json;
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > MAX_PROJECT) throw new Error('Proje en fazla 100 MB olabilir.');
      const bytes = Buffer.alloc(stat.size + 1);
      let offset = 0;
      while (offset < bytes.length) {
        const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset);
        if (!bytesRead) break;
        offset += bytesRead;
      }
      if (offset > MAX_PROJECT || offset > stat.size) throw new Error('Proje okuma sırasında değişti. Yeniden deneyin.');
      // Windows text editors may prepend a UTF-8 BOM. Strip that marker while
      // retaining fatal decoding so malformed text is never silently repaired.
      try { json = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, offset)); }
      catch { throw new Error('Proje dosyası geçerli UTF-8 metni içermiyor.'); }
    } finally { await file.close(); }
    validateProject(json);
    return { ok: true, json, name: path.basename(filename) };
  });
  installHandler('studio:export-images', saveImages);
  installHandler('studio:save-image', (dataUrl, name) => saveImages([{ dataUrl, name }]));
  installHandler('studio:save-video', (dataUrl, name) => {
    const item = decodeVideo(dataUrl);
    item.name = safeName(name, 'Inkreel-Video', item.ext);
    return saveDocument(item, 'Videoyu kaydet', 'videos', item.ext === '.mp4' ? 'MP4 videosu' : 'WebM videosu');
  });
  installHandler('studio:save-text', (text, name) => {
    const item = prepareText(text, name);
    return saveDocument(item, 'Metin dosyasını kaydet', 'documents', item.ext.slice(1).toUpperCase() + ' dosyası');
  });
  installHandler('studio:copy-text', async text => {
    clipboard.writeText(validateClipboard(text));
    return { ok: true };
  }, false);
}

function cancelClose() {
  clearTimeout(closeTimer);
  closeTimer = null;
  pendingClose = false;
}

function finishClose(saved = true) {
  if (!pendingClose || !mainWindow || mainWindow.isDestroyed()) return;
  if (saved !== true) { cancelClose(); return; }
  cancelClose();
  closeApproved = true;
  mainWindow.close();
}

async function confirmCloseWithoutSave() {
  const window = mainWindow;
  if (!pendingClose || !window || window.isDestroyed()) return;
  closeTimer = null;
  try {
    const result = await dialog.showMessageBox(window, {
      type: 'warning', title: 'Proje henüz kaydedilemedi',
      message: 'Son değişikliklerin kaydedildiği doğrulanamadı.',
      detail: 'Editöre dönerek projenizi dosyaya kaydedebilirsiniz. Kaydetmeden kapatırsanız son değişiklikler kaybolabilir.',
      buttons: ['Editöre dön', 'Kaydetmeden kapat'], defaultId: 0, cancelId: 0, noLink: true
    });
    if (!pendingClose || mainWindow !== window || window.isDestroyed()) return;
    if (result.response === 1) finishClose(); else cancelClose();
  } catch { if (mainWindow === window) cancelClose(); }
}

async function installProtocol() {
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/ttf', '.woff': 'font/woff', '.ttf': 'font/ttf', '.ico': 'image/vnd.microsoft.icon', '.txt': 'text/plain; charset=utf-8' };
  protocol.handle('bulten', async request => {
    const filename = assetPath(UI_ROOT, request.url);
    const type = filename && types[path.extname(filename).toLowerCase()];
    if (request.method !== 'GET' || !filename || !type) return new Response('Not found', { status: 404 });
    try {
      const stat = await fs.stat(filename);
      if (!stat.isFile() || stat.size > MAX_PROJECT) return new Response('Not found', { status: 404 });
      const body = await fs.readFile(filename);
      return new Response(body, { headers: { 'Content-Type': type, 'Content-Security-Policy': CSP, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache' } });
    } catch { return new Response('Not found', { status: 404 }); }
  });
}

function installMenu() {
  const command = (label, accelerator, cmd) => ({ label, accelerator, click: () => sendCommand(cmd) });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Dosya', submenu: [command('Yeni proje', 'CmdOrCtrl+N', 'new'), command('Proje aç…', 'CmdOrCtrl+O', 'open'), command('Projeyi kaydet…', 'CmdOrCtrl+S', 'save'), { type: 'separator' }, command('Dışa aktar…', 'CmdOrCtrl+E', 'export'), { type: 'separator' }, { label: 'Çıkış', role: 'quit' }] },
    { label: 'Düzenle', submenu: [command('Geri al', 'CmdOrCtrl+Z', 'undo'), command('Yinele', 'CmdOrCtrl+Shift+Z', 'redo'), { type: 'separator' }, { label: 'Kes', role: 'cut' }, { label: 'Kopyala', role: 'copy' }, { label: 'Yapıştır', role: 'paste' }, { label: 'Tümünü seç', role: 'selectAll' }] },
    { label: 'Görünüm', submenu: [{ label: 'Tam ekran', role: 'togglefullscreen' }, { label: 'Yakınlaştır', role: 'zoomIn' }, { label: 'Uzaklaştır', role: 'zoomOut' }, { label: 'Özgün boyut', role: 'resetZoom' }] },
    { label: 'Yardım', submenu: [command('Kullanım kılavuzu', 'F1', 'help'), command('Güncellemeleri denetle…', undefined, 'updates'), { label: 'Inkreel hakkında', click: () => dialog.showMessageBox(mainWindow, { type: 'info', title: 'Inkreel', message: 'Inkreel ' + app.getVersion(), detail: 'İnternetsiz çalışan içerik, görsel ve video stüdyosu.\nProjeler ve görseller bilgisayarınızda saklanır.', buttons: ['Tamam'] }) }] }
  ]));
}

function createWindow() {
  pendingClose = false;
  closeApproved = false;
  const available = screen.getPrimaryDisplay().workAreaSize;
  const width = Math.min(1500, available.width);
  const height = Math.min(980, available.height);
  mainWindow = new BrowserWindow({
    width, height, minWidth: Math.min(1120, width), minHeight: Math.min(720, height),
    title: 'Inkreel', backgroundColor: '#10151e',
    icon: path.join(__dirname, 'icon.png'), show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true, sandbox: true, nodeIntegration: false,
      webSecurity: true, allowRunningInsecureContent: false,
      navigateOnDragDrop: false, devTools: false, spellcheck: false
    }
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => { if (!isEntryUrl(url)) event.preventDefault(); });
  mainWindow.webContents.on('will-redirect', event => event.preventDefault());
  mainWindow.webContents.on('will-attach-webview', event => event.preventDefault());
  mainWindow.webContents.on('did-fail-load', (_event, code) => {
    if (code !== -3) dialog.showErrorBox('Inkreel açılamadı', 'Uygulama dosyaları okunamadı. Kurulumu yeniden çalıştırın veya taşınabilir paketi tamamen yeni bir klasöre çıkarın.');
  });
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('close', event => {
    if (closeApproved) return;
    event.preventDefault();
    if (fileOperation || pendingClose || installPending) return;
    pendingClose = true;
    closeTimer = setTimeout(confirmCloseWithoutSave, 5000);
    try { mainWindow.webContents.send('studio:before-close'); }
    catch { clearTimeout(closeTimer); void confirmCloseWithoutSave(); }
  });
  mainWindow.on('closed', () => {
    clearTimeout(autoUpdateTimer);
    clearTimeout(closeTimer);
    closeTimer = null;
    pendingClose = false;
    mainWindow = null;
  });
  mainWindow.loadURL(ENTRY);
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.show(); mainWindow.focus(); } });
  app.whenReady().then(async () => {
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    session.defaultSession.on('will-download', event => event.preventDefault());
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
      const allowed = !!assetPath(UI_ROOT, details.url) || details.url.startsWith('data:') || details.url.startsWith('blob:bulten://app/');
      callback({ cancel: !allowed });
    });
    await installProtocol();
    await initializeUpdates();
    installIpc();
    installMenu();
    createWindow();
    scheduleAutoUpdateCheck();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) { createWindow(); scheduleAutoUpdateCheck(); } });
  }).catch(() => { dialog.showErrorBox('Inkreel', 'Uygulama başlatılamadı. Dosyaların tamamını çıkardığınızdan emin olun.'); app.quit(); });
  app.on('window-all-closed', () => { clearTimeout(autoUpdateTimer); if (process.platform !== 'darwin') app.quit(); });
}
