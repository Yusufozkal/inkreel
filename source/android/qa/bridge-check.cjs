'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../www/android-bridge.js'), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));

function harness(options = {}) {
  const timers = new Map(), events = new Map(), requests = [];
  let timerSequence = 0, closeCount = 0; const closeCalls=[];
  const host = {
    request(action, payload, id) {
      if (options.throwRequest) throw Error('private file payload');
      requests.push({ action, payload: JSON.parse(payload), id });
      if (options.immediate) window.StudioAndroidResult({ id, ok: true });
    },
    finishClose(saved,requestId) { closeCalls.push({saved,requestId}); closeCount++; if (options.throwClose) throw Error('private path'); }
  };
  const window = {
    setTimeout(callback, delay) { const id = ++timerSequence; timers.set(id, { callback, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    addEventListener(type, callback) { events.set(type, callback); }
  };
  if (!options.noBridge) window.KarevoAndroid = options.badBridge ? {} : host;
  vm.runInNewContext(source, { window }, { filename: 'android-bridge.js' });
  return {
    window, api: window.StudioDesktop, timers, events, requests,
    reply(value) { window.StudioAndroidResult(value); },
    event(type, detail = {}) { events.get(type)?.(detail); },
    timeout(id = timers.keys().next().value) { const timer = timers.get(id); assert.ok(timer); timers.delete(id); timer.callback(); },
    closes() { return closeCount; }, closeCalls
  };
}

(async () => {
  for (const options of [{ noBridge: true }, { badBridge: true }]) {
    const h = harness(options);
    assert.equal(h.api, undefined);
    assert.equal(h.window.StudioAndroidResult, undefined);
  }

  const h = harness();
  assert.equal(h.api.isAndroid, true);
  assert.ok(Object.isFrozen(h.api));
  assert.equal(Object.getOwnPropertyDescriptor(h.window, 'StudioDesktop').writable, false);
  assert.equal(Object.getOwnPropertyDescriptor(h.window, 'StudioDesktop').configurable, false);
  assert.equal(Object.keys(h.api).length, 11, 'no private pending state is exposed');

  const cases = [
    ['getInfo', [], 'info', {}],
    ['saveProject', ['{"schema":"bulten-studio-project"}', 'proje.inkreel'], 'save-project', { json: '{"schema":"bulten-studio-project"}', name: 'proje.inkreel' }],
    ['openProject', [], 'open-project', {}],
    ['saveImage', ['data:image/png;base64,AA==', 'görsel.png'], 'save-image', { dataUrl: 'data:image/png;base64,AA==', name: 'görsel.png' }],
    ['exportImages', [[{ name: '1.png', dataUrl: 'data:image/png;base64,AA==' }]], 'export-images', { items: [{ name: '1.png', dataUrl: 'data:image/png;base64,AA==' }] }],
    ['saveVideo', ['data:video/webm;base64,AA==', 'animasyon.webm'], 'save-video', { dataUrl: 'data:video/webm;base64,AA==', name: 'animasyon.webm' }],
    ['saveText', ['Başlık;Tarih\nÖrnek;2026', 'plan.csv'], 'save-text', { text: 'Başlık;Tarih\nÖrnek;2026', name: 'plan.csv' }],
    ['copyText', ['Türkçe açıklama'], 'copy-text', { text: 'Türkçe açıklama' }],
    ['shareImage', ['data:image/jpeg;base64,AA==', 'paylas.jpg'], 'share-image', { dataUrl: 'data:image/jpeg;base64,AA==', name: 'paylas.jpg' }]
  ];
  const ids = new Set();
  for (const [method, args, action, payload] of cases) {
    const promise = h.api[method](...args), call = h.requests.at(-1);
    assert.equal(call.action, action);
    assert.deepEqual(call.payload, payload);
    assert.ok(!ids.has(call.id)); ids.add(call.id);
    assert.equal(h.timers.size, 1);
    assert.equal([...h.timers.values()][0].delay, action === 'info' || action === 'copy-text' ? 90000 : 600000);
    const result = { id: call.id, ok: true, name: 'çıktı', count: 2, folder: 'Pictures/Inkreel', json: '{"boards":[]}', ignored: 'private' };
    h.reply(method === 'openProject' ? JSON.stringify(result) : result);
    const actual = plain(await promise);
    assert.deepEqual(actual, { ok: true, name: 'çıktı', count: 2, folder: 'Pictures/Inkreel', json: '{"boards":[]}', ...(method === 'getInfo' ? { platform: 'android', version: '3.3.0' } : {}) });
    assert.equal(h.timers.size, 0);
    h.reply({ id: call.id, ok: false, error: 'duplicate' });
  }

  let promise = h.api.openProject(), id = h.requests.at(-1).id;
  h.reply('not json'); h.reply(null); h.reply([]); h.reply({ id: 'unknown', ok: true });
  h.reply({ id: 1, ok: true });
  assert.equal(h.timers.size, 1, 'malformed and unknown callbacks leave the live request alone');
  h.reply({ id, ok: false, canceled: true });
  assert.deepEqual(plain(await promise), { ok: false, canceled: true });

  promise = h.api.saveText('test', 'test.txt'); id = h.requests.at(-1).id;
  h.reply({ id, ok: false, error: 'Yazma izni verilmedi.' });
  assert.deepEqual(plain(await promise), { ok: false, error: 'Yazma izni verilmedi.' });
  promise = h.api.getInfo(); id = h.requests.at(-1).id;
  h.reply({ id, ok: 'true' });
  assert.match((await promise).error, /yanıtı okunamadı/);

  promise = h.api.openProject(); id = h.requests.at(-1).id;
  h.event('visibilitychange', { hidden: true });
  h.event('pagehide', { persisted: true });
  assert.equal(h.timers.size, 1, 'picker visibility and BFCache do not cancel requests');
  h.timeout();
  assert.match((await promise).error, /zaman aşımına/);
  h.reply({ id, ok: true, json: '{}' });
  assert.equal(h.timers.size, 0, 'late callbacks cannot recreate finished requests');

  const circular = []; circular.push(circular);
  const requestsBefore = h.requests.length;
  assert.match((await h.api.exportImages(circular)).error, /hazırlanamadı/);
  assert.equal(h.requests.length, requestsBefore);
  assert.equal(h.timers.size, 0);

  const bad = harness({ throwRequest: true });
  assert.deepEqual(plain(await bad.api.openProject()), { ok: false, error: 'Android işlemi başlatılamadı.' });
  assert.equal(bad.timers.size, 0);
  const synchronous = harness({ immediate: true });
  assert.equal((await synchronous.api.copyText('metin')).ok, true);
  assert.equal(synchronous.timers.size, 0, 'synchronous callbacks settle safely');

  h.api.finishClose(); assert.equal(h.closes(), 1); assert.deepEqual(h.closeCalls.at(-1),{saved:true,requestId:0});
  h.api.finishClose(false,17); assert.deepEqual(h.closeCalls.at(-1),{saved:false,requestId:17});
  h.api.finishClose(true,18); assert.deepEqual(h.closeCalls.at(-1),{saved:true,requestId:18});
  const badClose = harness({ throwClose: true });
  assert.doesNotThrow(() => badClose.api.finishClose());
  delete badClose.window.KarevoAndroid.finishClose;
  assert.doesNotThrow(() => badClose.api.finishClose());

  const one = h.api.openProject(), two = h.api.copyText('metin');
  assert.equal(h.timers.size, 2);
  h.event('pagehide', { persisted: false });
  assert.deepEqual(plain(await one), { ok: false, canceled: true });
  assert.deepEqual(plain(await two), { ok: false, canceled: true });
  assert.equal(h.timers.size, 0);
  const countBeforeDispose = h.requests.length;
  assert.deepEqual(plain(await h.api.openProject()), { ok: false, canceled: true });
  assert.equal(h.requests.length, countBeforeDispose);

  console.log('Android Promise bridge checks passed (mock host; no Android device execution).');
})().catch(error => { console.error(error); process.exitCode = 1; });
