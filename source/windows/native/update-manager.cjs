'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const https = require('node:https');
const { spawn } = require('node:child_process');
const { constants: fsConstants } = require('node:fs');
const contract = require('./update-contract.cjs');

const MAX_META = contract.MAX_ENVELOPE_BYTES;
const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);
class UpdateError extends Error {}
const message = text => new UpdateError(text);
const clone = value => JSON.parse(JSON.stringify(value));

function abortable(promise, signal) {
  if (signal.aborted) return Promise.reject(signal.reason || message('İstek zaman aşımına uğradı.'));
  return new Promise((resolve, reject) => {
    const abort = () => { cleanup(); reject(signal.reason || message('İstek zaman aşımına uğradı.')); };
    const cleanup = () => signal.removeEventListener('abort', abort);
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(promise).then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
  });
}

/** Headers are intentionally fixed: no credentials can leak across redirects. */
function openHttps(url, options) {
  return new Promise((resolve, reject) => {
    let response;
    const request = https.get(url, {
      signal: options.signal,
      headers: { 'User-Agent': 'Bulten-Studio-Updater', Accept: '*/*', 'Accept-Encoding': 'identity' },
      rejectUnauthorized: true
    }, result => {
      response = result;
      clearTimeout(headerTimer);
      result.setTimeout(options.idleTimeoutMs, () => result.destroy(message('İndirme zaman aşımına uğradı.')));
      resolve({ statusCode: result.statusCode, headers: result.headers, body: result,
        close() { result.destroy(); request.destroy(); } });
    });
    const headerTimer = setTimeout(() => request.destroy(message('Sunucu yanıtı zaman aşımına uğradı.')), 30000);
    request.once('error', error => {
      clearTimeout(headerTimer);
      if (response) response.destroy(error); else reject(error);
    });
  });
}

function iteratorFor(body) {
  if (Buffer.isBuffer(body) || body instanceof Uint8Array) {
    return (async function* () { yield body; })()[Symbol.asyncIterator]();
  }
  if (body && typeof body[Symbol.asyncIterator] === 'function') return body[Symbol.asyncIterator]();
  if (body && typeof body[Symbol.iterator] === 'function') return (async function* () { yield* body; })()[Symbol.asyncIterator]();
  throw message('Sunucu yanıtı okunamadı.');
}
function header(headers, name) {
  const key = Object.keys(headers || {}).find(value => value.toLowerCase() === name);
  const value = key === undefined ? undefined : headers[key];
  if (Array.isArray(value)) throw message('Sunucu yanıt başlığı geçersiz.');
  return value === undefined ? undefined : String(value);
}
function contentLength(response, maximum, expected) {
  const encoding = header(response.headers, 'content-encoding');
  if (encoding && encoding.toLowerCase() !== 'identity') throw message('Sıkıştırılmış güncelleme yanıtı desteklenmiyor.');
  const raw = header(response.headers, 'content-length');
  if (raw === undefined) return null;
  if (!/^(0|[1-9][0-9]*)$/.test(raw)) throw message('Sunucunun dosya boyutu bilgisi geçersiz.');
  const length = Number(raw);
  if (!Number.isSafeInteger(length) || length > maximum || (expected !== undefined && length !== expected)) {
    throw message('İndirilecek dosyanın boyutu doğrulanamadı.');
  }
  return length;
}

function closeResponse(response) {
  if (typeof response.close === 'function') response.close();
  else if (response.body && typeof response.body.destroy === 'function') response.body.destroy();
}

class UpdateManager {
  constructor(options = {}) {
    if (typeof options.userDataDir !== 'string' || !path.isAbsolute(options.userDataDir)) throw new Error('userDataDir must be an absolute path.');
    contract.compareVersions(options.appVersion, options.appVersion);
    this._version = options.appVersion;
    this._userDir = options.userDataDir;
    this._cacheDir = path.join(this._userDir, 'update-cache');
    this._settingsPath = path.join(this._userDir, 'update-settings.json');
    this._latestPath = path.join(this._cacheDir, 'latest.json');
    this._publicKey = options.publicKey;
    this._supported = (options.platform || 'win32') === 'win32' && (options.arch || 'x64') === 'x64';
    this._transport = options.transport || openHttps;
    this._spawn = options.spawnInstaller || spawn;
    this._onState = typeof options.onState === 'function' ? options.onState : () => {};
    this._settings = { schema: 'bulten-update-settings', version: 1, feedUrl: '', autoCheck: true, highestSequence: 0, lastCheckedAt: '' };
    this._candidate = null;
    this._downloadedSha = null;
    this._busy = null;
    this._initPromise = null;
    this._state = { status: this._supported ? 'idle' : 'disabled', currentVersion: this._version,
      latestVersion: '', notes: '', progress: 0, feedUrl: '', autoCheck: true, configured: false,
      lastCheckedAt: '', error: '', downloadBytes: 0, totalBytes: 0, canDownload: false, canInstall: false };
  }
  getState() { return clone(this._state); }
  _emit(patch = {}) {
    // A failed network operation must not hide recovery actions for an already
    // verified release. Recheck the saved candidate against the current replay
    // floor; the last request's error is independent of those capabilities.
    let candidate = null;
    if (this._supported && this._settings.feedUrl && this._candidate) {
      try {
        const checked = this._verify(this._candidate.raw);
        if (checked.isNewer) candidate = checked.payload;
      } catch { /* Invalid or superseded metadata cannot enable an action. */ }
    }
    Object.assign(this._state, patch, {
      feedUrl: this._settings.feedUrl, configured: !!this._settings.feedUrl,
      autoCheck: this._settings.autoCheck, lastCheckedAt: this._settings.lastCheckedAt,
      canDownload: !!candidate,
      canInstall: !!candidate && this._downloadedSha === candidate.installer.sha256
    });
    try { this._onState(this.getState()); } catch (_) { /* UI listeners cannot break verification. */ }
    return this.getState();
  }
  async _ensureDirectory(directory) {
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    const stat = await fs.lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw message('Güncelleme klasörü güvenli biçimde açılamadı.');
  }
  async _atomicWrite(filename, data) {
    const temporary = path.join(path.dirname(filename), '.update-' + crypto.randomUUID() + '.tmp');
    try {
      await fs.writeFile(temporary, data, { flag: 'wx', mode: 0o600 });
      await fs.rename(temporary, filename);
    } finally { await fs.rm(temporary, { force: true }).catch(() => {}); }
  }
  async _readBoundedFile(filename, maxBytes) {
    const handle = await fs.open(filename, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0));
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > maxBytes) throw message('Kaydedilen güncelleme bilgisi geçersiz.');
      const bytes = Buffer.alloc(stat.size + 1);
      let count = 0;
      while (count < bytes.length) {
        const read = await handle.read(bytes, count, bytes.length - count, count);
        if (!read.bytesRead) break;
        count += read.bytesRead;
      }
      if (count !== stat.size) throw message('Kaydedilen güncelleme bilgisi okuma sırasında değişti.');
      return bytes.subarray(0, count);
    } finally { await handle.close(); }
  }
  _verify(raw) {
    try { return contract.verifyEnvelope(raw, { publicKey: this._publicKey, appVersion: this._version, highestSequence: this._settings.highestSequence }); }
    catch (error) { throw message(error && error.message ? error.message : 'Güncellemenin imzası doğrulanamadı.'); }
  }
  async init() {
    if (this._initPromise) return this._initPromise;
    this._initPromise = this._initialize();
    return this._initPromise;
  }
  async _initialize() {
    await this._ensureDirectory(this._userDir);
    await this._ensureDirectory(this._cacheDir);
    await this._cleanInterruptedFiles();
    try {
      const raw = JSON.parse((await this._readBoundedFile(this._settingsPath, 8192)).toString('utf8'));
      const fields = ['schema', 'version', 'feedUrl', 'autoCheck', 'highestSequence', 'lastCheckedAt'];
      if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).some(key => !fields.includes(key)) || raw.schema !== 'bulten-update-settings' || raw.version !== 1 || typeof raw.feedUrl !== 'string' || typeof raw.autoCheck !== 'boolean' || !Number.isSafeInteger(raw.highestSequence) || raw.highestSequence < 0 || typeof raw.lastCheckedAt !== 'string' || (raw.lastCheckedAt && !Number.isFinite(Date.parse(raw.lastCheckedAt)))) throw new Error('Invalid settings');
      this._settings = { ...raw, feedUrl: raw.feedUrl ? contract.validateFeedUrl(raw.feedUrl) : '' };
    } catch (error) {
      if (error.code !== 'ENOENT') this._emit({ status: this._supported ? 'error' : 'disabled', error: 'Güncelleme ayarları okunamadı. Güncelleme adresini yeniden kaydedin.' });
    }
    if (this._supported && this._settings.feedUrl) {
      try {
        const raw = await this._readBoundedFile(this._latestPath, MAX_META);
        const checked = this._verify(raw);
        // The metadata rename may have completed before a settings write was
        // interrupted. Recover its signed sequence before accepting any feed.
        if (checked.payload.sequence > this._settings.highestSequence) {
          this._settings = { ...this._settings, highestSequence: checked.payload.sequence };
          await this._saveSettings();
        }
        if (checked.isNewer) {
          this._candidate = { raw, payload: checked.payload };
          const cached = await this._cacheMatches(checked.payload).catch(() => false);
          this._downloadedSha = cached ? checked.payload.installer.sha256 : null;
          this._emit({ status: cached ? 'downloaded' : 'available', latestVersion: checked.payload.version,
            notes: checked.payload.notes, progress: cached ? 1 : 0, totalBytes: checked.payload.installer.size,
            downloadBytes: cached ? checked.payload.installer.size : 0, error: '' });
        }
      } catch (error) {
        if (error.code !== 'ENOENT') this._emit({ status: 'error', error: 'Kaydedilen güncelleme doğrulanamadı. Yeniden kontrol edin.' });
      }
    }
    return this._emit();
  }
  async _cleanInterruptedFiles() {
    // Only names created by this updater are removed; never follow links.
    const clean = async (directory, partials) => {
      for (const item of await fs.readdir(directory, { withFileTypes: true })) {
        if (item.isFile() && (/^\.update-[0-9a-f-]{36}\.tmp$/.test(item.name) || (partials && /^\.partial-[0-9a-f-]{36}$/.test(item.name)))) {
          await fs.rm(path.join(directory, item.name), { force: true });
        }
      }
    };
    await clean(this._userDir, false);
    await clean(this._cacheDir, false);
    for (const item of await fs.readdir(this._cacheDir, { withFileTypes: true })) {
      if (/^[a-f0-9]{64}$/.test(item.name) && item.isDirectory() && !item.isSymbolicLink()) {
        await clean(path.join(this._cacheDir, item.name), true);
      }
    }
  }
  async _saveSettings() { await this._atomicWrite(this._settingsPath, JSON.stringify(this._settings, null, 2) + '\n'); }
  async _run(name, action) {
    await this.init();
    if (this._busy) throw message('Önce devam eden güncelleme işlemini tamamlayın.');
    this._busy = name;
    try { return await action(); }
    catch (error) {
      const safe = error instanceof UpdateError ? error : message('Güncelleme işlemi tamamlanamadı. Bağlantıyı ve kullanılabilir disk alanını kontrol edin.');
      this._emit({ status: this._supported ? 'error' : 'disabled', error: safe.message });
      throw safe;
    } finally { this._busy = null; }
  }
  _requireReady() {
    if (!this._supported) throw message('Otomatik güncelleme bu platformda desteklenmiyor.');
    if (!this._settings.feedUrl) throw message('Önce güncelleme adresini kaydedin.');
  }
  async configure(options) {
    return this._run('configure', async () => {
      if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some(key => !['feedUrl', 'autoCheck'].includes(key)) || typeof options.feedUrl !== 'string' || typeof options.autoCheck !== 'boolean') throw message('Güncelleme ayarları geçersiz.');
      let url;
      try { url = options.feedUrl.trim() ? contract.validateFeedUrl(options.feedUrl.trim()) : ''; }
      catch (error) { throw message(error.message); }
      const changed = url !== this._settings.feedUrl;
      const previous = this._settings;
      this._settings = { ...previous, feedUrl: url, autoCheck: options.autoCheck, lastCheckedAt: changed ? '' : previous.lastCheckedAt };
      try { await this._saveSettings(); } catch (error) { this._settings = previous; throw error; }
      if (changed) {
        this._candidate = null; this._downloadedSha = null;
        await fs.rm(this._latestPath, { force: true });
      }
      return this._emit({ status: this._supported ? (this._downloadedSha ? 'downloaded' : this._candidate ? 'available' : 'idle') : 'disabled',
        error: '', ...(changed ? { latestVersion: '', notes: '', progress: 0, totalBytes: 0, downloadBytes: 0 } : {}) });
    });
  }
  _network(totalMs, idleTimeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(message('Güncelleme isteği zaman aşımına uğradı.')), totalMs);
    return { signal: controller.signal, idleTimeoutMs, finish() { clearTimeout(timer); } };
  }
  async _response(url, network) {
    let current = url;
    for (let redirects = 0; ; redirects++) {
      try { current = contract.validateFeedUrl(current); } catch (error) { throw message('Güncelleme bağlantısı güvenli değil.'); }
      const response = await abortable(Promise.resolve().then(() => this._transport(current, { signal: network.signal, idleTimeoutMs: network.idleTimeoutMs })), network.signal);
      if (!response || !Number.isInteger(response.statusCode)) throw message('Sunucu yanıtı geçersiz.');
      if (REDIRECT_CODES.has(response.statusCode)) {
        let target;
        try {
          const location = header(response.headers, 'location');
          if (!location || redirects >= 5) throw message('Güncelleme bağlantısında çok fazla veya geçersiz yönlendirme var.');
          target = contract.validateFeedUrl(new URL(location, current).href);
        } catch (error) { throw message('Güncelleme yönlendirmesi güvenli değil.'); }
        finally { if (typeof response.close === 'function') response.close(); else if (response.body && typeof response.body.destroy === 'function') response.body.destroy(); }
        current = target;
        continue;
      }
      if (response.statusCode !== 200) {
        if (typeof response.close === 'function') response.close(); else if (response.body && typeof response.body.destroy === 'function') response.body.destroy();
        throw message(response.statusCode === 404 ? 'Güncelleme dosyası bulunamadı. Yayın adresini kontrol edin.' : 'Güncelleme sunucusu isteği tamamlayamadı.');
      }
      return response;
    }
  }
  async _readBody(response, network, onChunk) {
    let iterator;
    const abort = () => closeResponse(response);
    network.signal.addEventListener('abort', abort, { once: true });
    try {
      iterator = iteratorFor(response.body);
      while (true) {
        const entry = await abortable(iterator.next(), network.signal);
        if (entry.done) break;
        if (!(Buffer.isBuffer(entry.value) || entry.value instanceof Uint8Array)) throw message('Sunucu beklenmeyen dosya verisi döndürdü.');
        await onChunk(Buffer.from(entry.value));
      }
    } finally {
      network.signal.removeEventListener('abort', abort);
      abort();
      if (iterator && typeof iterator.return === 'function') Promise.resolve(iterator.return()).catch(() => {});
    }
  }
  async check() {
    return this._run('check', async () => {
      this._requireReady();
      this._emit({ status: 'checking', error: '', progress: 0 });
      const network = this._network(30000, 15000);
      let raw;
      try {
        const response = await this._response(this._settings.feedUrl, network);
        let length;
        try { length = contentLength(response, MAX_META); }
        catch (error) { if (typeof response.close === 'function') response.close(); throw error; }
        const parts = []; let received = 0;
        await this._readBody(response, network, chunk => { received += chunk.length; if (received > MAX_META) throw message('Güncelleme bilgisi izin verilen boyutu aşıyor.'); parts.push(chunk); });
        if (length !== null && length !== received) throw message('Güncelleme bilgisi eksik indirildi.');
        raw = Buffer.concat(parts, received);
      } finally { network.finish(); }
      const checked = this._verify(raw);
      const previous = this._settings;
      this._settings = { ...previous, highestSequence: Math.max(previous.highestSequence, checked.payload.sequence), lastCheckedAt: new Date().toISOString() };
      try { await this._atomicWrite(this._latestPath, raw); await this._saveSettings(); }
      catch (error) {
        // A failed write must not make an already verified newer release
        // replayable in this process. The signed cache recovers this floor on
        // restart if its write succeeded before the settings write failed.
        this._settings = { ...previous, highestSequence: this._settings.highestSequence };
        if (this._candidate && this._candidate.payload.sequence < this._settings.highestSequence) {
          this._candidate = null; this._downloadedSha = null;
        }
        throw error;
      }
      this._candidate = checked.isNewer ? { raw, payload: checked.payload } : null;
      const cached = checked.isNewer ? await this._cacheMatches(checked.payload).catch(() => false) : false;
      this._downloadedSha = cached ? checked.payload.installer.sha256 : null;
      return this._emit({ status: checked.isNewer ? (cached ? 'downloaded' : 'available') : 'idle', error: '',
        latestVersion: checked.payload.version, notes: checked.payload.notes, totalBytes: checked.isNewer ? checked.payload.installer.size : 0,
        downloadBytes: cached ? checked.payload.installer.size : 0, progress: cached ? 1 : 0 });
    });
  }
  _installerPath(payload) { return path.join(this._cacheDir, payload.installer.sha256, 'installer.exe'); }
  async _cacheMatches(payload) {
    const filename = this._installerPath(payload);
    const directory = await fs.lstat(path.dirname(filename));
    if (!directory.isDirectory() || directory.isSymbolicLink()) return false;
    const stat = await fs.lstat(filename);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== payload.installer.size) return false;
    const handle = await fs.open(filename, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0));
    try {
      const before = await handle.stat();
      if (!before.isFile() || before.size !== payload.installer.size) return false;
      const hash = crypto.createHash('sha256');
      let size = 0;
      for await (const chunk of handle.createReadStream({ autoClose: false })) { hash.update(chunk); size += chunk.length; if (size > payload.installer.size) return false; }
      const after = await handle.stat();
      return size === payload.installer.size && before.size === after.size && before.mtimeMs === after.mtimeMs && hash.digest('hex') === payload.installer.sha256;
    } finally { await handle.close(); }
  }
  async download() {
    return this._run('download', async () => {
      this._requireReady();
      if (!this._candidate) throw message('İndirilecek yeni bir sürüm bulunamadı. Önce güncellemeleri kontrol edin.');
      const checked = this._verify(this._candidate.raw);
      if (!checked.isNewer) throw message('Bu sürüm yüklü uygulamadan yeni değil.');
      const payload = checked.payload;
      if (await this._cacheMatches(payload).catch(() => false)) {
        this._downloadedSha = payload.installer.sha256;
        return this._emit({ status: 'downloaded', error: '', progress: 1, downloadBytes: payload.installer.size, totalBytes: payload.installer.size });
      }
      this._downloadedSha = null;
      this._emit({ status: 'downloading', error: '', progress: 0, downloadBytes: 0, totalBytes: payload.installer.size });
      const target = this._installerPath(payload), directory = path.dirname(target);
      await this._ensureDirectory(directory);
      const temporary = path.join(directory, '.partial-' + crypto.randomUUID());
      const network = this._network(10 * 60 * 1000, 120000);
      let file, response;
      try {
        response = await this._response(payload.installer.url, network);
        contentLength(response, payload.installer.size, payload.installer.size);
        file = await fs.open(temporary, 'wx', 0o600);
        const hash = crypto.createHash('sha256'); let received = 0, lastNotice = 0;
        // Transfer response ownership only once the disk file is ready. A disk
        // error before this point must also close the live HTTP response.
        const bodyResponse = response; response = null;
        await this._readBody(bodyResponse, network, async chunk => {
          received += chunk.length;
          if (received > payload.installer.size) throw message('İndirilen dosya beklenen boyutu aşıyor.');
          hash.update(chunk);
          let offset = 0;
          while (offset < chunk.length) { const result = await file.write(chunk, offset, chunk.length - offset); if (!result.bytesWritten) throw message('Güncelleme dosyası diske yazılamadı.'); offset += result.bytesWritten; }
          if (received === payload.installer.size || Date.now() - lastNotice > 100) { lastNotice = Date.now(); this._emit({ progress: received / payload.installer.size, downloadBytes: received }); }
        });
        if (received !== payload.installer.size) throw message('Güncelleme dosyası eksik indirildi. Yeniden deneyin.');
        if (hash.digest('hex') !== payload.installer.sha256) throw message('Güncelleme dosyasının bütünlüğü doğrulanamadı. Dosya kullanılmayacak.');
        await file.sync(); await file.close(); file = null;
        const existing = await fs.lstat(target).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
        if (existing && (!existing.isFile() || existing.isSymbolicLink())) throw message('Güncelleme önbelleği güvenli biçimde açılamadı.');
        await fs.rename(temporary, target);
        if (!await this._cacheMatches(payload)) throw message('Kaydedilen güncelleme yeniden doğrulanamadı.');
        this._downloadedSha = payload.installer.sha256;
        await this._pruneCache(payload.installer.sha256).catch(() => {});
        return this._emit({ status: 'downloaded', error: '', progress: 1, downloadBytes: payload.installer.size, totalBytes: payload.installer.size });
      } finally {
        network.finish(); if (response) closeResponse(response);
        if (file) await file.close().catch(() => {}); await fs.rm(temporary, { force: true }).catch(() => {});
      }
    });
  }
  async _pruneCache(currentSha) {
    const candidates = [];
    for (const item of await fs.readdir(this._cacheDir, { withFileTypes: true })) {
      if (/^[a-f0-9]{64}$/.test(item.name) && item.isDirectory() && item.name !== currentSha) {
        const directory = path.join(this._cacheDir, item.name), stat = await fs.lstat(directory);
        if (!stat.isSymbolicLink()) candidates.push({ directory, time: stat.mtimeMs });
      }
    }
    candidates.sort((a, b) => b.time - a.time);
    for (const item of candidates.slice(1)) {
      await fs.rm(path.join(item.directory, 'installer.exe'), { force: true });
      for (const name of await fs.readdir(item.directory)) if (/^\.partial-[0-9a-f-]{36}$/.test(name)) await fs.rm(path.join(item.directory, name), { force: true });
      await fs.rmdir(item.directory).catch(() => {});
    }
  }
  async _verifiedInstaller() {
    this._requireReady();
    if (!this._candidate) throw message('Kurulacak doğrulanmış bir güncelleme bulunamadı.');
    const checked = this._verify(this._candidate.raw);
    if (!checked.isNewer || !await this._cacheMatches(checked.payload).catch(() => false)) {
      this._downloadedSha = null;
      throw message('Kurulum dosyası yeniden doğrulanamadı. Güncellemeyi yeniden indirin.');
    }
    this._downloadedSha = checked.payload.installer.sha256;
    return this._installerPath(checked.payload);
  }
  async getVerifiedInstaller() { return this._run('verify', () => this._verifiedInstaller()); }
  async launchInstaller(options = {}) {
    return this._run('install', async () => {
      if (!Number.isSafeInteger(options.parentPid) || options.parentPid < 1 || options.parentPid > 2147483647) throw message('Uygulama işlem bilgisi geçersiz.');
      const filename = await this._verifiedInstaller();
      const child = this._spawn(filename, ['/S', '/UPDATEPID=' + options.parentPid, '/RESTARTAPP'], {
        detached: true, stdio: 'ignore', shell: false, windowsHide: true
      });
      if (!child || typeof child.once !== 'function') throw message('Güncelleme kurucusu başlatılamadı.');
      await new Promise((resolve, reject) => {
        const error = () => { cleanup(); reject(message('Güncelleme kurucusu başlatılamadı.')); };
        const started = () => { cleanup(); resolve(); };
        const cleanup = () => { child.removeListener('error', error); child.removeListener('spawn', started); };
        child.once('error', error); child.once('spawn', started);
      });
      // Ignore post-spawn process errors; do not leave an unhandled error event.
      child.on('error', () => {});
      if (typeof child.unref === 'function') child.unref();
      return { path: filename, version: this._candidate.payload.version, pid: child.pid };
    });
  }
}

module.exports = { UpdateManager };
