/* Karevo: Promise adapter for the Android WebView host. */
(function (root) {
  'use strict';

  const native = root.KarevoAndroid;
  // A normal browser preview keeps using the browser download/file inputs.
  if (!native || typeof native.request !== 'function') return;

  const pending = new Map();
  const FILE_TIMEOUT = 10 * 60 * 1000;
  const SMALL_TIMEOUT = 90 * 1000;
  const prefix = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
  let sequence = 0;
  let disposed = false;

  function settle(id, result) {
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);
    root.clearTimeout(entry.timer);
    entry.resolve(result);
  }

  function request(action, payload) {
    return new Promise(function (resolve) {
      if (disposed) {
        resolve({ ok: false, canceled: true });
        return;
      }
      let json;
      try {
        json = JSON.stringify(payload);
      } catch (_) {
        resolve({ ok: false, error: 'İşlem verileri hazırlanamadı.' });
        return;
      }

      const id = prefix + '-' + (++sequence).toString(36);
      const delay = action === 'info' || action === 'copy-text' ? SMALL_TIMEOUT : FILE_TIMEOUT;
      const timer = root.setTimeout(function () {
        settle(id, { ok: false, error: 'Android işlemi zaman aşımına uğradı. Yeniden deneyin.' });
      }, delay);
      pending.set(id, { resolve: resolve, timer: timer, action: action });
      try {
        native.request(action, json, id);
      } catch (_) {
        // Do not include bridge exceptions: they can contain private file data.
        settle(id, { ok: false, error: 'Android işlemi başlatılamadı.' });
      }
    });
  }

  function receive(raw) {
    let message;
    try {
      message = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (!message || typeof message !== 'object' || Array.isArray(message)) return;
      if (typeof message.id !== 'string') return;
      const entry = pending.get(message.id);
      // Duplicate replies, old page replies and unsolicited IDs are ignored.
      if (!entry) return;
      if (typeof message.ok !== 'boolean') {
        settle(message.id, { ok: false, error: 'Android yanıtı okunamadı.' });
        return;
      }
      const result = { ok: message.ok };
      if (typeof message.canceled === 'boolean') result.canceled = message.canceled;
      for (const key of ['error', 'json', 'name', 'folder']) {
        if (typeof message[key] === 'string') result[key] = message[key];
      }
      if (Number.isSafeInteger(message.count) && message.count >= 0) result.count = message.count;
      if (entry.action === 'info') {
        result.platform = 'android';
        result.version = '3.1.3';
      }
      settle(message.id, result);
    } catch (_) {
      // Malformed JSON or an untrusted object cannot reject unrelated requests.
    }
  }

  const api = Object.freeze({
    isAndroid: true,
    getInfo: function () { return request('info', {}); },
    saveProject: function (json, name) { return request('save-project', { json: json, name: name }); },
    openProject: function () { return request('open-project', {}); },
    saveImage: function (dataUrl, name) { return request('save-image', { dataUrl: dataUrl, name: name }); },
    exportImages: function (items) { return request('export-images', { items: items }); },
    saveVideo: function (dataUrl, name) { return request('save-video', { dataUrl: dataUrl, name: name }); },
    saveText: function (text, name) { return request('save-text', { text: text, name: name }); },
    copyText: function (text) { return request('copy-text', { text: text }); },
    shareImage: function (dataUrl, name) { return request('share-image', { dataUrl: dataUrl, name: name }); },
    finishClose: function (saved, requestId) {
      try {
        if (typeof native.finishClose === 'function') native.finishClose(saved !== false, Number.isSafeInteger(requestId) && requestId > 0 ? requestId : 0);
      } catch (_) {}
    }
  });

  Object.defineProperty(root, 'StudioAndroidResult', { value: receive, writable: false, configurable: false });
  Object.defineProperty(root, 'StudioDesktop', { value: api, writable: false, configurable: false });
  root.addEventListener('pagehide', function (event) {
    // A SAF file picker changes visibility, not page lifetime. Never cancel on
    // visibilitychange; retain requests when this document enters the BFCache.
    if (event.persisted) return;
    disposed = true;
    for (const id of Array.from(pending.keys())) settle(id, { ok: false, canceled: true });
  });
})(window);
