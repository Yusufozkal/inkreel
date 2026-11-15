'use strict';
const assert = require('node:assert/strict');
const Core = require('../ui/core.js');
const { indexedDB } = require('fake-indexeddb');
const { Image, createCanvas } = require('@napi-rs/canvas');

async function main() {
  const project = Core.createProject();
  assert.equal(project.schema, 'bulten-studio-project');
  assert.equal(project.version, 3);
  assert.equal(Core.projectExtension, 'karevo');
  assert.equal(project.boards.length, 1);
  assert.equal(project.boards[0].state.photo, '');
  assert.equal(project.boards[0].state.brandName, 'MARKANIZ');
  assert.equal(project.boards[0].state.accent, '#a294ff');
  assert.equal(project.boards[0].state.background, '#152136');
  assert.equal(project.boards[0].state.handle, '@hesabiniz');
  assert.deepEqual(project.brands, []);
  assert.deepEqual(project.templates, []);
  assert.equal(project.activeBrandId, null);
  assert.deepEqual(project.boards[0].post, Core.POST_DEFAULTS);
  assert.deepEqual(Core.dimensions('landscape'), { width: 1920, height: 1080 });
  assert.equal(new Set(Array.from({ length: 100 }, () => Core.id('board'))).size, 100);

  const sampleCanvas = createCanvas(6, 4);
  sampleCanvas.getContext('2d').fillRect(0, 0, 6, 4);
  const photo = sampleCanvas.toDataURL('image/png');
  project.boards[0].state.photo = photo;
  const imageLayer = Core.createLayer('image', 'portrait');
  imageLayer.src = photo;
  project.boards[0].layers.push(imageLayer, Core.createLayer('text', 'portrait'));
  project.boards[0].post = {
    caption: 'Bugünün gelişmeleri. #gündem', altText: 'Haber görselinin açıklaması',
    sourceUrl: 'https://example.com/haber?foo=bar', publishAt: '2026-10-20T14:30', status: 'ready'
  };
  const brand = Core.createBrand({ ...project.boards[0].state, brandName: 'ÖRNEK YAYIN', brandMark: 'ÖY', logo: photo }, 'Örnek profil');
  project.brands.push(brand);
  project.activeBrandId = brand.id;
  const template = Core.createTemplate(project.boards[0], 'Gündem şablonu', 'Gündem');
  project.templates.push(template);
  const saved = Core.serialize(project);
  const reopened = Core.parse(saved);
  assert.equal(reopened.boards[0].state.photo, photo);
  assert.equal(reopened.boards[0].layers[0].src, photo);
  assert.equal(reopened.activeId, project.activeId);
  assert.equal(reopened.brands[0].logo, photo);
  assert.equal(reopened.activeBrandId, brand.id);
  assert.equal(reopened.templates[0].board.layers[0].src, photo);
  assert.deepEqual(reopened.boards[0].post, project.boards[0].post);
  assert.deepEqual(Core.parse('\ufeff' + saved), reopened, 'Windows UTF-8 BOM projects preserve all media and Turkish text');
  assert.equal(Core.parse(Core.serialize({ ...project, name: 'Başlık \ufeff içinde' })).name, 'Başlık \ufeff içinde', 'Only the leading BOM is stripped');
  assert.equal(reopened.templates[0].category, 'Gündem');
  const materialized = Core.boardFromTemplate(template);
  assert.notEqual(materialized.id, template.board.id);
  assert.notEqual(materialized.layers[0].id, template.board.layers[0].id);
  assert.equal(materialized.state.photo, photo);
  assert.equal(materialized.layers[0].src, photo);
  materialized.state.headline = 'Başka bir başlık';
  materialized.state.photoX = 123;
  const originalPost = Core.clone(materialized.post);
  const originalLayers = Core.clone(materialized.layers);
  Core.applyBrand(materialized, brand);
  assert.equal(materialized.state.brandName, 'ÖRNEK YAYIN');
  assert.equal(materialized.state.logo, photo);
  assert.equal(materialized.state.headline, 'Başka bir başlık');
  assert.equal(materialized.state.photo, photo);
  assert.equal(materialized.state.photoX, 123);
  assert.deepEqual(materialized.post, originalPost);
  assert.deepEqual(materialized.layers, originalLayers);
  reopened.boards[0].state.headline = 'Changed';
  assert.notEqual(project.boards[0].state.headline, 'Changed');

  const duplicate = Core.clone(project);
  duplicate.boards.push(Core.clone(duplicate.boards[0]));
  duplicate.boards[0].state.photoZoom = Infinity;
  duplicate.boards[0].state.photoX = -1e10;
  duplicate.boards[0].state.fontSize = NaN;
  duplicate.boards[0].layers[0].opacity = 9;
  const repaired = Core.normalizeProject(duplicate);
  const identifiers = repaired.boards.flatMap(board => [board.id, ...board.layers.map(layer => layer.id)])
    .concat(repaired.brands.map(item => item.id), repaired.templates.flatMap(item => [item.id, item.board.id, ...item.board.layers.map(layer => layer.id)]));
  assert.equal(identifiers.length, new Set(identifiers).size);
  assert.equal(repaired.boards[0].state.photoZoom, Core.DEFAULTS.photoZoom);
  assert.equal(repaired.boards[0].state.photoX, -12000);
  assert.equal(repaired.boards[0].state.fontSize, Core.DEFAULTS.fontSize);
  assert.equal(repaired.boards[0].layers[0].opacity, 1);
  assert.throws(() => Core.parse('{broken'), /JSON/);
  assert.throws(() => Core.normalizeProject({ ...project, version: 4 }), /sürüm/);
  assert.throws(() => Core.normalizeProject({ ...project, boards: [] }), /en az/);
  assert.throws(() => Core.normalizeProject({ ...project, boards: Array(21).fill(project.boards[0]) }), /20/);
  assert.throws(() => Core.normalizeProject({ ...project, brands: Array(21).fill(brand) }), /20/);
  assert.throws(() => Core.normalizeProject({ ...project, templates: Array(31).fill(template) }), /30/);
  for (const sourceUrl of ['javascript:alert(1)', 'http://example.com', 'https://user:secret@example.com', 'https://example.com/unsafe path']) {
    assert.throws(() => Core.normalizePost({ sourceUrl }), /https/);
  }
  assert.throws(() => Core.normalizePost({ publishAt: '2026-02-30T14:30' }), /tarih/);
  assert.throws(() => Core.normalizePost({ publishAt: '2026-10-20T24:00' }), /tarih/);
  assert.equal(Core.normalizePost({ publishAt: '2028-02-29T23:59:59' }).publishAt, '2028-02-29T23:59:59');
  assert.equal(Core.normalizePost({ status: 'unknown' }).status, 'draft');
  assert.equal(Core.normalizeState({ brandName: 'x'.repeat(90), brandMark: 'ABCD' }).brandName.length, 60);
  assert.equal(Core.normalizeState({ brandMark: 'ABCD' }).brandMark.length, 3);
  const external = Core.clone(project);
  external.boards[0].state.photo = 'https://example.com/image.jpg';
  assert.throws(() => Core.normalizeProject(external), /güvenli/);
  external.boards[0].state.photo = photo;
  external.boards[0].layers[0].src = 'data:image/svg+xml;base64,PHN2Zz4=';
  assert.throws(() => Core.normalizeProject(external), /güvenli/);

  const legacy = {
    schema: 'netice-studio-project', version: 2, name: 'Eski proje', updated: Date.now(), activeId: 'legacy-board',
    boards: [{ id: 'legacy-board', name: 'Eski haber', state: { photo, headline: 'Eski başlık', handle: '@neticehaber' }, layers: [imageLayer] }]
  };
  const migrated = Core.parse(JSON.stringify(legacy));
  assert.deepEqual(Core.parse('\ufeff' + JSON.stringify(legacy)), migrated, 'Legacy .netice files with UTF-8 BOM migrate normally');
  assert.equal(migrated.schema, 'bulten-studio-project');
  assert.equal(migrated.version, 3);
  assert.equal(migrated.boards[0].state.photo, photo);
  assert.equal(migrated.boards[0].layers[0].src, photo);
  assert.equal(migrated.boards[0].state.brandName, 'netice');
  assert.equal(migrated.boards[0].state.tagline, 'HABERİN NET HALİ.');
  assert.equal(migrated.boards[0].state.accent, '#ff7548');
  assert.equal(migrated.boards[0].state.background, '#111d31');
  assert.equal(migrated.boards[0].state.headline, 'Eski başlık');
  assert.deepEqual(migrated.boards[0].post, Core.POST_DEFAULTS);
  assert.equal(JSON.parse(Core.serialize(migrated)).version, 3);
  const legacyDefault = Core.parse(JSON.stringify({ ...legacy, boards: [{ id: 'legacy-board', state: {}, layers: [] }] }));
  assert.equal(legacyDefault.boards[0].state.photo, Core.LEGACY_PHOTO);
  assert.throws(() => Core.normalizeProject({ ...legacy, version: 1 }), /sürüm/);

  const history = new Core.History(project);
  assert.equal(history.canUndo, false);
  const edited = Core.clone(project);
  history.checkpoint(edited);
  edited.name = 'Edited';
  const undone = history.undo(edited);
  assert.equal(undone.name, project.name);
  assert.equal(history.canRedo, true);
  assert.equal(history.redo(undone).name, 'Edited');
  for (let index = 0; index < 50; index++) history.checkpoint({ index });
  let count = 0;
  while (history.undo({ index: 100 })) count++;
  assert.equal(count, 40);
  history.checkpoint(project);
  assert.equal(history.canRedo, false);

  global.indexedDB = indexedDB;
  const database = await Core.openDatabase();
  assert.equal(database.mode, 'indexedDB');
  assert.deepEqual((await indexedDB.databases()).map(database => database.name), ['bulten-studio-v3']);
  await database.put('autosave', { id: 'autosave', project });
  await database.put('named', { id: 'named', project: reopened });
  assert.equal((await database.get('autosave')).project.boards[0].state.photo, photo);
  assert.equal((await database.all()).length, 2);
  const fetched = await database.get('autosave');
  fetched.project.name = 'Isolated';
  assert.notEqual((await database.get('autosave')).project.name, 'Isolated');
  await database.remove('named');
  assert.equal(await database.get('named'), undefined);
  assert.equal((await database.all()).length, 1);

  delete global.indexedDB;
  const memory = new Map();
  global.localStorage = { getItem: key => memory.get(key) || null, setItem: (key, value) => memory.set(key, value) };
  const fallback = await Core.openDatabase();
  assert.equal(fallback.mode, 'localStorage');
  await fallback.put('autosave', { id: 'autosave', project });
  assert.equal((await fallback.get('autosave')).project.boards[0].layers[0].src, photo);
  assert.equal((await fallback.all()).length, 1);
  await fallback.remove('autosave');
  assert.equal((await fallback.all()).length, 0);
  global.localStorage.setItem = () => { const error = new Error(); error.name = 'QuotaExceededError'; throw error; };
  await assert.rejects(() => fallback.put('test', project), /depolaması dolu/);

  global.Image = Image;
  const media = await Core.loadMedia(project.boards[0]);
  assert.equal(media.photo.width, 6);
  assert.equal(media.layers[imageLayer.id].height, 4);
  assert.equal(media.errors.length, 0);
  assert.equal(media.cropRef, false);
  const blankMedia = await Core.loadMedia(Core.createBoard());
  assert.equal(blankMedia.cropRef, false);
  assert.equal(blankMedia.photo, null);
  class LocalImage extends Image {
    set src(value) { super.src = value === Core.LEGACY_PHOTO ? require('node:path').join(__dirname, '../ui/', value) : value; }
    get src() { return super.src; }
  }
  global.Image = LocalImage;
  const legacyMedia = await Core.loadMedia(legacyDefault.boards[0]);
  assert.equal(legacyMedia.cropRef, true);
  assert.ok(legacyMedia.photo.width > 100);
  assert.equal(legacyMedia.errors.length, 0);
  global.Image = Image;
  const invalidImage = Core.clone(project.boards[0]);
  invalidImage.state.second = 'data:image/png;base64,YQ==';
  const partial = await Core.loadMedia(invalidImage);
  assert.equal(partial.photo.width, 6);
  assert.equal(partial.second, null);
  assert.equal(partial.errors.length, 1);

  const originalCreate = URL.createObjectURL, originalRevoke = URL.revokeObjectURL;
  let revoked = 0;
  URL.createObjectURL = () => photo;
  URL.revokeObjectURL = () => revoked++;
  global.document = { createElement: tag => { assert.equal(tag, 'canvas'); return createCanvas(1, 1); } };
  const imported = await Core.importImage({ name: 'image.png', type: 'image/png', size: 100 }, { transparent: true });
  assert.match(imported, /^data:image\/png;base64,/);
  assert.equal(revoked, 1);
  await assert.rejects(() => Core.importImage({ name: 'image.svg', type: 'image/svg+xml', size: 100 }), /JPG/);
  await assert.rejects(() => Core.importImage({ name: 'image.png', type: 'image/png', size: 21 * 1024 * 1024 }), /20 MB/);
  URL.createObjectURL = originalCreate;
  URL.revokeObjectURL = originalRevoke;
  delete global.document;

  console.log('Core checks passed: v3 project/brand/template/post round-trip, v2 migration preserving identity and media, safe URLs and dates, limits/IDs/history, isolated IndexedDB/fallback, image load/import and legacy crop.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
