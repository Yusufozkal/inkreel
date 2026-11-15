'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { EventEmitter } = require('node:events');
const { UpdateManager } = require('../native/update-manager.cjs');
const C = require('../native/update-contract.cjs');

const keys = crypto.generateKeyPairSync('ed25519');
const privatePem = keys.privateKey.export({ format: 'pem', type: 'pkcs8' });
const pin = C.normalizePublicKey(keys.publicKey.export({ format: 'pem', type: 'spki' }).toString());
const FEED = 'https://publisher.test/updates/latest.json';
const URL = 'https://downloads.test/Bulten-Studio-3.2.0-Setup.exe';
const bytes = Buffer.from('MZ signed installer fixture with exact immutable bytes');
const sha = crypto.createHash('sha256').update(bytes).digest('hex');
function payload(overrides = {}) {
  return { schema: 'bulten-studio-update', schemaVersion: 1, appId: C.APP_ID,
    platform: 'win32', arch: 'x64', channel: 'stable', version: '3.2.0', sequence: 30200,
    publishedAt: '2026-10-20T12:34:56.000Z', notes: 'Yeni özellikler.\nProjeler korunur.',
    installer: { fileName: 'Bulten-Studio-3.2.0-Setup.exe', url: URL, sha256: sha, size: bytes.length }, ...overrides };
}
function envelope(value = payload()) { return Buffer.from(JSON.stringify(C.createEnvelope(value, privatePem))); }
function response(body, headers = {}, statusCode = 200) {
  return { statusCode, headers, body, closed: false, close() { this.closed = true; } };
}
async function fixture(t, extra = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bulten-updater-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const calls = [];
  let currentEnvelope = envelope();
  let installerResponse = () => response([bytes.subarray(0, 7), bytes.subarray(7)], { 'content-length': String(bytes.length) });
  const transport = async (url, options) => {
    calls.push({ url, options });
    return url === FEED ? response(currentEnvelope, { 'content-length': String(currentEnvelope.length) }) : installerResponse(url, options);
  };
  const options = { appVersion: '3.1.0', userDataDir: directory, publicKey: pin, transport, ...extra };
  const manager = new UpdateManager(options);
  await manager.init();
  return { manager, directory, options, calls, setEnvelope(value) { currentEnvelope = value; }, setInstaller(value) { installerResponse = value; },
    async ready() { await manager.configure({ feedUrl: FEED, autoCheck: true }); await manager.check(); } };
}
async function partials(directory) {
  const names = [];
  for (const item of await fs.readdir(directory, { withFileTypes: true })) {
    if (item.isDirectory()) names.push(...await partials(path.join(directory, item.name)));
    else if (item.name.startsWith('.partial-')) names.push(item.name);
  }
  return names;
}

test('default offline editor, HTTPS settings, clone isolation, persistence and platform gate', async t => {
  const f = await fixture(t);
  assert.equal(f.manager.getState().status, 'idle'); assert.equal(f.manager.getState().configured, false);
  const copy = f.manager.getState(); copy.autoCheck = false; assert.equal(f.manager.getState().autoCheck, true);
  for (const url of ['http://example.test/a', 'https://user:secret@example.test/a', 'https://example.test/a\nfile', 'file:///a']) {
    await assert.rejects(f.manager.configure({ feedUrl: url, autoCheck: true }));
  }
  await f.manager.configure({ feedUrl: FEED, autoCheck: false });
  const next = new UpdateManager(f.options); await next.init();
  assert.equal(next.getState().feedUrl, FEED); assert.equal(next.getState().autoCheck, false);
  const unsupported = new UpdateManager({ ...f.options, platform: 'linux' }); await unsupported.init();
  assert.equal(unsupported.getState().status, 'disabled'); await assert.rejects(unsupported.check(), /platform/);
  assert.equal(f.calls.length, 0);
});

test('Ed25519 check, streamed hashed download, private cache, exact spawn and restart recovery', async t => {
  const spawned = [];
  const f = await fixture(t, { onState(state) { state.feedUrl = 'tampered'; }, spawnInstaller(file, args, options) {
    const child = new EventEmitter(); child.pid = 1234; child.unref = () => { child.unreferenced = true; };
    spawned.push({ file, args, options, child }); queueMicrotask(() => child.emit('spawn')); return child;
  } });
  await f.ready(); assert.equal(f.manager.getState().status, 'available');
  await f.manager.download(); assert.equal(f.manager.getState().status, 'downloaded');
  assert.equal(f.manager.getState().progress, 1); assert.equal(f.manager.getState().downloadBytes, bytes.length);
  const filename = await f.manager.getVerifiedInstaller();
  assert.equal(filename, path.join(f.directory, 'update-cache', sha, 'installer.exe'));
  assert.deepEqual(await fs.readFile(filename), bytes); assert.equal((await fs.stat(filename)).mode & 0o777, 0o600);
  const restarted = new UpdateManager(f.options); await restarted.init();
  assert.equal(restarted.getState().status, 'downloaded'); assert.equal(restarted.getState().canInstall, true);
  const result = await restarted.launchInstaller({ parentPid: 5678 });
  assert.equal(result.pid, 1234); assert.equal(spawned.length, 1);
  assert.deepEqual(spawned[0].args, ['/S', '/UPDATEPID=5678', '/RESTARTAPP']);
  assert.deepEqual(spawned[0].options, { detached: true, stdio: 'ignore', shell: false, windowsHide: true });
  assert.equal(spawned[0].child.unreferenced, true);
  assert.equal(f.calls.filter(call => call.url === URL).length, 1);
  await restarted.download(); assert.equal(f.calls.filter(call => call.url === URL).length, 1);
  const settings = await fs.readFile(path.join(f.directory, 'update-settings.json'), 'utf8');
  assert(!settings.includes('PRIVATE KEY')); assert.equal(JSON.parse(settings).highestSequence, 30200);
});

test('invalid signatures and rollback are rejected before installer network or execution', async t => {
  const f = await fixture(t); await f.ready();
  const changed = JSON.parse(envelope()); changed.signature = crypto.randomBytes(64).toString('base64');
  f.setEnvelope(Buffer.from(JSON.stringify(changed))); await assert.rejects(f.manager.check(), /imza/);
  assert.equal(f.manager.getState().status, 'error'); assert.equal(f.calls.filter(call => call.url === URL).length, 0);
  f.setEnvelope(envelope(payload({ sequence: 30199 })));
  const restarted = new UpdateManager(f.options); await restarted.init();
  await assert.rejects(restarted.check(), /eski/);
  f.setEnvelope(envelope()); await restarted.check(); assert.equal(restarted.getState().status, 'available');
});

test('failed checks and downloads retain only verified recovery actions without another feed check', async t => {
  const f = await fixture(t); await f.ready();
  assert.equal(f.manager.getState().canDownload, true);
  assert.equal(f.manager.getState().canInstall, false);
  const transport = f.manager._transport;
  f.manager._transport = async (url, options) => {
    if (url === FEED) throw new Error('offline');
    return transport(url, options);
  };
  await assert.rejects(f.manager.check());
  assert.equal(f.manager.getState().status, 'error');
  assert.equal(f.manager.getState().canDownload, true, 'Keep the last signed newer release available');
  f.setInstaller(() => response(bytes.subarray(0, bytes.length - 1)));
  await assert.rejects(f.manager.download());
  assert.equal(f.manager.getState().canDownload, true, 'An interrupted transfer can retry without a successful feed check');
  assert.equal(f.manager.getState().canInstall, false);
  f.setInstaller(() => response(bytes)); await f.manager.download();
  assert.equal(f.manager.getState().canInstall, true);
  await assert.rejects(f.manager.check());
  assert.equal(f.manager.getState().status, 'error');
  assert.equal(f.manager.getState().canInstall, true, 'A cached verified installer survives an offline check');
  const filename = await f.manager.getVerifiedInstaller();
  await fs.writeFile(filename, Buffer.alloc(bytes.length, 0));
  await assert.rejects(f.manager.getVerifiedInstaller(), /doğrulanamadı/);
  assert.equal(f.manager.getState().canInstall, false, 'A damaged cache cannot enable installation');
  assert.equal(f.manager.getState().canDownload, true, 'The signed release can still be downloaded again');
  await f.manager.download(); assert.equal(f.manager.getState().canInstall, true);
  await f.manager.configure({ feedUrl: '', autoCheck: false });
  assert.equal(f.manager.getState().canDownload, false); assert.equal(f.manager.getState().canInstall, false);
});

test('unverified feed metadata cannot enable download or install recovery actions', async t => {
  const f = await fixture(t);
  await f.manager.configure({ feedUrl: FEED, autoCheck: false });
  const changed = JSON.parse(envelope()); changed.signature = crypto.randomBytes(64).toString('base64');
  f.setEnvelope(Buffer.from(JSON.stringify(changed)));
  await assert.rejects(f.manager.check(), /imza/);
  assert.equal(f.manager.getState().canDownload, false); assert.equal(f.manager.getState().canInstall, false);
  await assert.rejects(f.manager.download(), /yeni bir sürüm/);
  assert.equal(f.calls.filter(call => call.url === URL).length, 0);
});

test('failed metadata or settings writes retain the learned replay floor and invalidate an older cached installer', async t => {
  for (const failure of ['metadata', 'settings']) {
    await t.test(failure, async t => {
      let spawns = 0;
      const f = await fixture(t, { spawnInstaller() { spawns++; throw new Error('must not run'); } });
      await f.ready(); await f.manager.download();
      assert.equal(f.manager.getState().canInstall, true);
      const write = f.manager._atomicWrite.bind(f.manager);
      f.manager._atomicWrite = async (filename, data) => {
        if (filename === path.join(f.directory, failure === 'metadata' ? 'update-cache/latest.json' : 'update-settings.json')) throw new Error('simulated interrupted persistence');
        return write(filename, data);
      };
      f.setEnvelope(envelope(payload({ version: '3.3.0', sequence: 30300 })));
      await assert.rejects(f.manager.check());
      assert.equal(f.manager.getState().canDownload, false);
      assert.equal(f.manager.getState().canInstall, false);
      f.setEnvelope(envelope());
      await assert.rejects(f.manager.check(), /eski/);
      await assert.rejects(f.manager.download(), /yeni bir sürüm/);
      await assert.rejects(f.manager.launchInstaller({ parentPid: 123 }));
      assert.equal(spawns, 0);
      assert.equal(f.calls.filter(call => call.url === URL).length, 1);
    });
  }
});

test('startup recovers a signed cache sequence after interrupted settings persistence, including an installed release', async t => {
  for (const appVersion of ['3.1.0', '3.3.0']) {
    await t.test(appVersion, async t => {
      const f = await fixture(t); await f.ready();
      f.setEnvelope(envelope(payload({ version: '3.3.0', sequence: 30300 })));
      f.manager._saveSettings = async () => { throw new Error('simulated interrupted settings write'); };
      await assert.rejects(f.manager.check());
      const settingsFile = path.join(f.directory, 'update-settings.json');
      assert.equal(JSON.parse(await fs.readFile(settingsFile, 'utf8')).highestSequence, 30200);
      const restarted = new UpdateManager({ ...f.options, appVersion });
      await restarted.init();
      assert.equal(restarted.getState().status, appVersion === '3.1.0' ? 'available' : 'idle');
      assert.equal(JSON.parse(await fs.readFile(settingsFile, 'utf8')).highestSequence, 30300);
      f.setEnvelope(envelope());
      await assert.rejects(restarted.check(), /eski/);
      assert.equal(f.calls.filter(call => call.url === URL).length, 0);
    });
  }
});

test('matching installed release is idle with a trusted last check timestamp', async t => {
  const f = await fixture(t, { appVersion: '3.2.0' }); await f.ready();
  assert.equal(f.manager.getState().status, 'idle'); assert.equal(f.manager.getState().latestVersion, '3.2.0');
  assert(Number.isFinite(Date.parse(f.manager.getState().lastCheckedAt)));
  await assert.rejects(f.manager.download(), /yeni bir sürüm/);
});

test('partial, oversized, tampered and wrong-length bodies are discarded; installed files stay intact', async t => {
  const f = await fixture(t); await f.ready();
  const working = path.join(f.directory, 'working-app.exe'); await fs.writeFile(working, 'existing application');
  for (const makeResponse of [
    () => response(bytes.subarray(0, bytes.length - 1)),
    () => response(Buffer.concat([bytes, Buffer.from('extra')])),
    () => response(Buffer.alloc(bytes.length, 7)),
    () => response(bytes, { 'content-length': String(bytes.length - 1) }),
    () => response((async function* () { yield bytes.subarray(0, 5); throw new Error('offline'); })())
  ]) {
    f.setInstaller(makeResponse); await assert.rejects(f.manager.download());
    assert.equal(f.manager.getState().canInstall, false); assert.deepEqual(await partials(f.directory), []);
    assert.equal(await fs.readFile(working, 'utf8'), 'existing application');
  }
  f.setInstaller(() => response(bytes)); await f.manager.download(); assert.equal(f.manager.getState().status, 'downloaded');
});

test('redirects remain HTTPS and bounded; status, metadata size and length are checked', async t => {
  let mode = 'redirect', calls = 0, closed = 0;
  const raw = envelope();
  const f = await fixture(t, { transport: async url => {
    calls++;
    if (mode === 'redirect' && url === FEED) return { ...response('', { location: '/actual.json' }, 302), close() { closed++; } };
    if (mode === 'http') return response('', { location: 'http://unsafe.test/latest.json' }, 302);
    if (mode === 'loop') return response('', { location: FEED }, 302);
    if (mode === '404') return response('missing', {}, 404);
    if (mode === 'oversize') return response(Buffer.alloc(C.MAX_ENVELOPE_BYTES + 1));
    if (mode === 'length') return response(raw, { 'content-length': String(raw.length + 1) });
    if (mode === 'encoded') return response(raw, { 'content-encoding': 'gzip' });
    return response(raw);
  } });
  await f.manager.configure({ feedUrl: FEED, autoCheck: true }); await f.manager.check(); assert.equal(closed, 1);
  for (const value of ['http', 'loop', '404', 'oversize', 'length', 'encoded']) {
    mode = value; calls = 0; await assert.rejects(f.manager.check()); if (mode === 'loop') assert.equal(calls, 6);
  }
});

test('cache tampering is detected after restart and again immediately before launch', async t => {
  let spawns = 0;
  const f = await fixture(t, { spawnInstaller() { spawns++; throw new Error('must not run'); } });
  await f.ready(); await f.manager.download(); const filename = await f.manager.getVerifiedInstaller();
  await fs.writeFile(filename, Buffer.alloc(bytes.length, 0));
  await assert.rejects(f.manager.launchInstaller({ parentPid: 123 }), /doğrulanamadı/); assert.equal(spawns, 0);
  const next = new UpdateManager(f.options); await next.init();
  assert.equal(next.getState().status, 'available'); assert.equal(next.getState().canInstall, false);
  await next.download(); assert.deepEqual(await fs.readFile(filename), bytes);
  const external = path.join(f.directory, 'external.exe'); await fs.writeFile(external, bytes);
  await fs.rm(filename); await fs.symlink(external, filename);
  await assert.rejects(next.getVerifiedInstaller()); await assert.rejects(next.download());
  assert.deepEqual(await fs.readFile(external), bytes); assert.equal(spawns, 0);
});

test('serialized operations reject overlap without clobbering live state, then recover after offline check', async t => {
  let resolveResponse;
  const f = await fixture(t, { transport: () => new Promise(resolve => { resolveResponse = resolve; }) });
  await f.manager.configure({ feedUrl: FEED, autoCheck: true });
  const check = f.manager.check(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.manager.getState().status, 'checking');
  await assert.rejects(f.manager.check(), /devam eden/); await assert.rejects(f.manager.configure({ feedUrl: '', autoCheck: false }), /devam eden/);
  assert.equal(f.manager.getState().status, 'checking'); resolveResponse(response(envelope())); await check;
  assert.equal(f.manager.getState().status, 'available');
  f.manager._transport = async () => { throw new Error('offline with sensitive local path'); };
  await assert.rejects(f.manager.check()); assert(!f.manager.getState().error.includes('sensitive'));
  assert.equal(f.manager.getState().latestVersion, '3.2.0');
});

test('network deadlines abort stalled metadata and downloads and remove temporary files', async t => {
  const f = await fixture(t); await f.ready();
  const limits = [], original = f.manager._network.bind(f.manager);
  f.manager._network = (total, idle) => { limits.push([total, idle]); return original(15, idle); };
  f.setInstaller(() => response((async function* () { yield bytes.subarray(0, 4); await new Promise(() => {}); })()));
  await assert.rejects(f.manager.download(), /zaman aşımı/); assert.deepEqual(await partials(f.directory), []);
  f.manager._transport = () => new Promise(() => {});
  await assert.rejects(f.manager.check(), /zaman aşımı/);
  assert.deepEqual(limits, [[600000, 120000], [30000, 15000]]);
});

test('disk-open failure closes the response immediately and still allows a clean download retry', async t => {
  const f = await fixture(t); await f.ready();
  const downloadResponse = response(bytes);
  f.setInstaller(() => downloadResponse);
  const open = fs.open;
  fs.open = async (filename, ...args) => {
    if (typeof filename === 'string' && path.basename(filename).startsWith('.partial-')) {
      const error = new Error('simulated disk full'); error.code = 'ENOSPC'; throw error;
    }
    return open(filename, ...args);
  };
  try { await assert.rejects(f.manager.download()); }
  finally { fs.open = open; }
  assert.equal(downloadResponse.closed, true, 'No unread HTTP connection waits for its idle timeout');
  assert.deepEqual(await partials(f.directory), []);
  assert.equal(f.manager.getState().canDownload, true); assert.equal(f.manager.getState().canInstall, false);
  f.setInstaller(() => response(bytes)); await f.manager.download();
  assert.equal(f.manager.getState().canInstall, true);
});

test('startup removes only own interrupted temporary files and reports spawn errors safely', async t => {
  const f = await fixture(t, { spawnInstaller() {
    const child = new EventEmitter(); queueMicrotask(() => child.emit('error', new Error('ENOENT sensitive path'))); return child;
  } });
  await f.ready(); await f.manager.download();
  const dir = path.join(f.directory, 'update-cache', sha), temporary = '.partial-' + crypto.randomUUID();
  await fs.writeFile(path.join(dir, temporary), 'partial'); await fs.writeFile(path.join(dir, 'user-note.txt'), 'keep');
  await fs.writeFile(path.join(f.directory, '.update-' + crypto.randomUUID() + '.tmp'), 'partial settings');
  const next = new UpdateManager(f.options); await next.init();
  assert.deepEqual(await partials(f.directory), []); assert.equal(await fs.readFile(path.join(dir, 'user-note.txt'), 'utf8'), 'keep');
  await assert.rejects(next.launchInstaller({ parentPid: 0 }), /işlem/);
  await assert.rejects(next.launchInstaller({ parentPid: 123 }), /başlatılamadı/);
  assert(!next.getState().error.includes('sensitive')); assert.equal(next.getState().canInstall, true);
});
