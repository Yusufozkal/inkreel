/* Offline regression attacks. No oversized raster is ever decoded by these tests. */
'use strict';
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const { createCanvas, Image } = require('@napi-rs/canvas');
const Core = require('../ui/core.js');

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let n = 0; n < 8; n++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, payload) {
  const tag = Buffer.from(type), body = Buffer.concat([tag, payload]);
  const header = Buffer.alloc(4), sum = Buffer.alloc(4);
  header.writeUInt32BE(payload.length); sum.writeUInt32BE(crc32(body));
  return Buffer.concat([header, body, sum]);
}
function png(width, height, note = '') {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width); header.writeUInt32BE(height, 4);
  header[8] = 1; // One-bit grayscale: a valid, very small compressed flat image.
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('tEXt', Buffer.from('note\0' + note)), chunk('IDAT', zlib.deflateSync(Buffer.alloc((Math.ceil(width / 8) + 1) * height))), chunk('IEND', Buffer.alloc(0))]);
}
const dataUrl = bytes => 'data:image/png;base64,' + bytes.toString('base64');
const withPhoto = photo => { const project = Core.createProject(); project.boards[0].state.photo = photo; return project; };
function webpChunk(type, payload) {
  const bytes = Buffer.alloc(8 + payload.length + payload.length % 2);
  bytes.write(type); bytes.writeUInt32LE(payload.length, 4); payload.copy(bytes, 8); return bytes;
}
function vp8x(width, height) {
  const payload = Buffer.alloc(10);
  payload.writeUIntLE(width - 1, 4, 3); payload.writeUIntLE(height - 1, 7, 3); return webpChunk('VP8X', payload);
}
function webp(...chunks) {
  const bytes = Buffer.concat([Buffer.from('RIFF0000WEBP'), ...chunks]);
  bytes.writeUInt32LE(bytes.length - 8, 4); return bytes;
}

async function coreAttacks() {
  const bomb = png(16384, 16384);
  assert(bomb.length < 40000, 'The complete valid PNG is small enough to arrive in an ordinary project attachment');
  const project = withPhoto(dataUrl(bomb));
  for (const schema of ['bulten-studio-project', 'netice-studio-project']) {
    const fixture = { ...project, schema, version: schema === Core.SCHEMA ? Core.VERSION : 2 };
    assert.throws(() => Core.parse(JSON.stringify(fixture)), /çözünürlüğü çok büyük/);
  }
  const small = createCanvas(6, 4);
  global.Image = Image;
  for (const type of ['image/png', 'image/jpeg', 'image/webp']) {
    const valid = withPhoto(small.toDataURL(type));
    const reopened = Core.parse(Core.serialize(valid));
    assert.equal(reopened.boards[0].state.photo, valid.boards[0].state.photo);
    const media = await Core.loadMedia(reopened.boards[0]);
    assert.equal(media.photo.width, 6); assert.equal(media.photo.height, 4);
    assert.deepEqual(media.errors, []);
  }
  const svg = 'data:image/png;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="999999" height="999999"><script>alert(1)</script></svg>').toString('base64');
  assert.throws(() => Core.normalizeProject(withPhoto(svg)), /JPG, PNG veya WebP/);
  const mislabeled = bytes => withPhoto('data:image/webp;base64,' + bytes.toString('base64'));
  const largeCanvas = webp(vp8x(16384, 16384));
  assert.throws(() => Core.normalizeProject(mislabeled(Buffer.concat([largeCanvas, vp8x(1, 1)]))), /WebP|çözünürlüğü/);
  assert.throws(() => Core.normalizeProject(mislabeled(webp(vp8x(100, 100), vp8x(1, 1)))), /WebP/);
  const mismatched = Buffer.alloc(5); mismatched[0] = 47;
  mismatched.writeUInt32LE((16383 | (16383 << 14)) >>> 0, 1);
  assert.throws(() => Core.normalizeProject(mislabeled(webp(vp8x(1, 1), webpChunk('VP8L', mismatched)))), /WebP/);
  const threeImages = Core.createProject();
  threeImages.boards[0].state.photo = dataUrl(png(5000, 4000, 'one'));
  threeImages.boards[0].state.second = dataUrl(png(5000, 4000, 'two'));
  threeImages.boards[0].state.logo = dataUrl(png(5000, 4000, 'three'));
  assert.throws(() => Core.normalizeProject(threeImages), /çok fazla yüksek çözünürlüklü/);
  const amplified = Core.createProject();
  const shared = png(4500, 6000);
  amplified.boards = Array.from({ length: 20 }, (_, index) => {
    const board = Core.createBoard();
    // Distinct, valid ancillary chunks prevent image-cache deduplication.
    const bytes = Buffer.concat([shared.subarray(0, shared.length - 12), chunk('tEXt', Buffer.from('variant\0' + index)), shared.subarray(shared.length - 12)]);
    board.state.photo = dataUrl(bytes); return board;
  });
  assert.throws(() => Core.normalizeProject(amplified), /çok fazla yüksek çözünürlüklü/);
  amplified.boards.forEach(board => { board.state.photo = amplified.boards[0].state.photo; });
  assert.equal(Core.normalizeProject(amplified).boards.length, 20, 'Shared images count once toward the project budget');

  let assigned = 0;
  const previousDocument = global.document, previousImage = global.Image;
  global.document = { createElement() { throw Error('Must reject before canvas allocation'); } };
  global.Image = class { set src(value) { if (value) assigned++; } };
  const file = { name: 'tiny.png', type: 'image/png', size: bomb.length, arrayBuffer: async () => bomb.buffer.slice(bomb.byteOffset, bomb.byteOffset + bomb.byteLength) };
  await assert.rejects(() => Core.importImage(file), /çözünürlüğü çok büyük/);
  assert.equal(assigned, 0, 'Bomb file is rejected before browser decode');
  await assert.rejects(() => Core.loadMedia(project.boards[0]), /çözünürlüğü çok büyük/);
  assert.equal(assigned, 0, 'Bomb project is rejected before browser decode');
  global.document = previousDocument;

  let concurrent = 0, maximum = 0, decodes = 0;
  global.Image = class {
    set src(value) {
      if (!value) return;
      decodes++; concurrent++; maximum = Math.max(maximum, concurrent);
      this.width = this.naturalWidth = 6000; this.height = this.naturalHeight = 4000;
      setTimeout(() => { concurrent--; this.onload(); }, 5);
    }
  };
  const boards = ['queue-one', 'queue-two', 'queue-three'].map(note => withPhoto(dataUrl(png(6000, 4000, note))).boards[0]);
  await Promise.all(boards.map(board => Core.loadMedia(board)));
  assert.equal(maximum, 1, 'Overlapping board/thumbnail requests share a serialized decoder');
  assert.equal(decodes, 3);
  await Core.loadMedia(boards[0]);
  assert.equal(decodes, 4, '24MP images exceed cache pixel budget before the 12-entry count cap');
  global.Image = previousImage;
  console.log('PASS: Compressed-image bombs, raster signatures, per-board/project/cache pixel budgets, serialized decode and valid raster compatibility');
  return project;
}

async function uiAttacks(bombProject) {
  const { boot, until } = require('./dom-check.cjs');
  const app = boot();
  await app.w.StudioApp.ready;
  const malicious = app.w.StudioCore.createProject(), payload = '<img id="security-owned" src=x onerror="window.securityOwned=1">';
  malicious.name = payload; malicious.boards[0].name = payload;
  malicious.boards[0].id = '"><img id="security-owned" src=x>';
  malicious.boards[0].state.headline = payload;
  malicious.boards[0].state.category = payload;
  malicious.boards[0].layers.push({ ...app.w.StudioCore.createLayer('text'), name: payload });
  app.setOpenJson(JSON.stringify(malicious)); app.click('openProjectButton');
  await until(() => app.$('boardList').textContent.includes(payload), 'escaped hostile project names');
  assert.equal(app.w.document.getElementById('security-owned'), null);
  assert.equal(app.w.securityOwned, undefined);
  assert(app.w.StudioApp.getProject().boards[0].layers[0].name.includes('<img'));
  const before = JSON.stringify(app.w.StudioApp.getProject());
  app.setOpenJson(JSON.stringify(bombProject)); app.click('openProjectButton');
  await until(() => /çözünürlüğü çok büyük/.test(app.$('toast').textContent), 'malicious import rejected');
  assert.equal(JSON.stringify(app.w.StudioApp.getProject()), before, 'Rejected project never replaces the open work');
  const db = await app.w.StudioCore.openDatabase();
  await db.put('autosave', { id: 'autosave', project: bombProject });
  await app.close();

  let bombDecodes = 0;
  const recovery = boot({ setupWindow(w) {
    const OriginalImage = w.Image;
    w.Image = class extends OriginalImage { set src(value) { if (value === bombProject.boards[0].state.photo) bombDecodes++; super.src = value; } get src() { return super.src; } };
  } });
  await recovery.w.StudioApp.ready;
  assert.equal(recovery.w.StudioApp.getProject().boards[0].state.photo, '');
  assert.equal(bombDecodes, 0, 'A previously stored malicious autosave cannot cause a decoder restart loop');
  await recovery.close();

  let currentCore, imported = 0;
  const guarded = boot({ setupWindow(w) {
    Object.defineProperty(w, 'StudioCore', { configurable: true, get: () => currentCore, set(value) {
      currentCore = Object.freeze({ ...value, importImage: async () => dataUrl(png(3500, 3500, 'import-' + (++imported))), loadMedia: async () => ({ photo: null, second: null, logo: null, cropRef: false, layers: {}, errors: [] }) });
    } });
  } });
  await guarded.w.StudioApp.ready;
  guarded.click('newProjectButton');
  for (let index = 1; index <= 3; index++) {
    guarded.upload('layerImageInput', Buffer.from('mock file'), 'ordinary.png');
    await until(() => guarded.w.StudioApp.getProject().boards[0].layers.length === index && !guarded.$('busyDialog').open, 'media import within board budget');
  }
  guarded.upload('layerImageInput', Buffer.from('mock file'), 'one-too-many.png');
  await until(() => imported === 4 && !guarded.$('busyDialog').open, 'media import beyond board budget');
  assert.equal(guarded.w.StudioApp.getProject().boards[0].layers.length, 3);
  assert.match(guarded.$('toast').textContent, /çok fazla yüksek çözünürlüklü/);
  assert.doesNotThrow(() => guarded.w.StudioCore.serialize(guarded.w.StudioApp.getProject()));
  await guarded.close();

  let failWrites = false;
  const acknowledgements = [];
  const failure = boot({ setupWindow(w) {
    w.StudioDesktop.finishClose = saved => acknowledgements.push(saved);
    const originalOpen = w.indexedDB.open.bind(w.indexedDB);
    w.indexedDB.open = (...args) => {
      const request = originalOpen(...args);
      request.addEventListener('success', () => {
        const db = request.result, transaction = db.transaction.bind(db);
        db.transaction = (names, mode, ...options) => {
          if (failWrites && mode === 'readwrite') { const error = Error('Full device storage'); error.name = 'QuotaExceededError'; throw error; }
          return transaction(names, mode, ...options);
        };
      });
      return request;
    };
  } });
  await failure.w.StudioApp.ready;
  failWrites = true;
  failure.input('headline', 'Unsaved latest edit');
  failure.w.dispatchEvent(new failure.w.Event('studio-before-close'));
  await until(() => acknowledgements.length === 1, 'failed close save acknowledgement');
  assert.equal(acknowledgements[0], false);
  assert.match(failure.$('toast').textContent, /Otomatik kayıt yapılamadı/);
  await assert.rejects(() => failure.w.StudioApp.prepareUpdate(), /otomatik kaydedilemedi/);
  assert.equal(failure.$('app').dataset.busy, 'false');
  assert.equal(failure.$('busyDialog').open, false);
  assert.equal(failure.w.StudioApp.getProject().boards[0].state.headline, 'Unsaved latest edit');
  failWrites = false;
  failure.w.dispatchEvent(new failure.w.Event('studio-before-close'));
  await until(() => acknowledgements.length === 2, 'save retry close acknowledgement');
  assert.equal(acknowledgements[1], true);
  await failure.close();
  console.log('PASS: Escaped project text/IDs, atomic rejected import, malicious-autosave recovery, failed-save close/update cancellation and successful retry');
}

coreAttacks().then(project => process.argv.includes('--core-only') ? undefined : uiAttacks(project)).catch(error => { console.error(error); process.exitCode = 1; setTimeout(() => process.exit(1), 100).unref(); });
