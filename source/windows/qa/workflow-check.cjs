'use strict';
const assert = require('node:assert/strict');
const C = require('../ui/core.js');
const W = require('../ui/workflow.js');
const image = 'data:image/png;base64,iVBORw0KGgo=';
const base = C.createBoard('story', 'serit');
base.state.brandName = 'Özgür Marka';
base.state.logo = image;
base.state.photo = image;
base.state.photoZoom = 2;
base.state.photoX = 40;
base.layers.push(C.createLayer('text', base.state.format));
base.post = { caption: 'Eski yazının açıklaması', altText: '', sourceUrl: '', publishAt: '', status: 'published' };

let result = W.parseCsv('\ufeffbaşlık;kategori;açıklama;durum;yayın_tarihi\r\n"Virgül, ve \"\"tırnak\"\"";GÜNDEM;"Birinci satır\r\nİkinci satır";hazır;2026-10-20 14:30\r\n\r\n');
assert.equal(result.delimiter, ';');
assert.equal(result.records.length, 1);
assert.equal(result.records[0].headline, 'Virgül, ve "tırnak"');
assert.equal(result.records[0].caption, 'Birinci satır\nİkinci satır');
assert.equal(result.records[0].status, 'ready');
assert.equal(result.records[0].publishAt, '2026-10-20T14:30');
assert.equal(result.records[0].$row, 2);
assert.equal(W.parseCsv('headline\taltText\nMerhaba\tBetimleme').delimiter, '\t');
assert.equal(W.parseCsv('headline\n"İki\nsatır"').records[0].headline, 'İki\nsatır');
assert.equal(W.parseCsv('headline,unknown\nBaşlık,"sayı; virgül, metin"').records[0].unknown, 'sayı; virgül, metin');
assert.equal(W.parseCsv('headline\rBirinci\rİkinci\r').records.length, 2);
for (const bad of [
  'headline\n"kapanmamış', 'headline\n"kapalı"bozuk', 'headline\nmetin"bozuk',
  'category\nGÜNDEM', 'headline,başlık\nBir,İki', 'headline,category\n,Kategori',
  'headline\n' + 'a'.repeat(501), 'headline,status\nBaşlık,constructor',
  'headline,status\nBaşlık,yanlış', 'headline,publishAt\nBaşlık,2026-02-30T12:00',
  'headline,publishAt\nBaşlık,2026-10-20T25:00', 'headline,publishAt\nBaşlık,2026-10-20T14:30Z',
  'headline,sourceUrl\nBaşlık,http://example.com', 'headline,sourceUrl\nBaşlık,javascript:alert(1)',
  'headline,sourceUrl\nBaşlık,https://user:secret@example.com', 'headline,sourceUrl\nBaşlık,https://example.com\\file',
  'headline,photo\nBaşlık,https://example.com/photo.jpg', 'headline,photo\nBaşlık,../photo.jpg',
  'headline,photo\nBaşlık,data:image/png;base64AQ==', 'headline\nBir,İki', 'headline\n\u0000',
  'headline\n' + Array.from({ length: 101 }, (_, i) => 'Başlık ' + i).join('\n'),
  'headline\n' + 'ş'.repeat(1024 * 1024)
]) assert.throws(() => W.parseCsv(bad), Error, 'Expected rejected CSV: ' + bad.slice(0, 80));

const csv = 'başlık,fotoğraf,kaynak_bağlantısı,yayın_tarihi,durum,çalışma_adı\n"Bir, haber",İÇERİK.JPG,https://example.com/haber,2026-10-20T14:30,hazır,Özel tasarım\nİkinci haber,eksik.jpg,,,taslak,\n';
result = W.prepareCsv(csv, base, { maxCount: 4, photos: { 'içerik.jpg': image } });
assert.equal(result.boards.length, 2);
assert.equal(result.boards[0].state.photo, image);
assert.equal(result.boards[0].state.photoZoom, 1);
assert.equal(result.boards[0].state.photoX, 0);
assert.equal(result.boards[1].state.photo, '');
assert.equal(result.warnings.length, 1);
assert.match(result.warnings[0], /Satır 3/);
assert.equal(result.boards[0].name, 'Özel tasarım');
assert.equal(result.boards[1].name, 'İkinci haber');
assert.equal(result.boards[0].state.brandName, 'Özgür Marka');
assert.equal(result.boards[0].state.logo, image);
assert.equal(result.boards[0].state.template, 'serit');
assert.equal(result.boards[0].state.format, 'story');
assert.equal(result.boards[0].post.caption, '');
assert.equal(result.boards[0].post.status, 'ready');
assert.equal(result.boards[1].post.status, 'draft');
assert.equal(new Set([base.id, ...result.boards.map(b => b.id)]).size, 3);
assert.equal(new Set([base.layers[0].id, ...result.boards.map(b => b.layers[0].id)]).size, 3);
assert.equal(base.state.photoZoom, 2, 'Source board stays untouched');
assert.equal(base.post.caption, 'Eski yazının açıklaması');
assert.throws(() => W.prepareCsv(csv, base, { maxCount: 1 }), /en fazla 1/);
assert.throws(() => W.prepareCsv(csv, base, { maxCount: 0 }), /en fazla 0/);
assert.throws(() => W.prepareCsv('headline\n', base), /veri satırı yok/);
const noPhotoColumn = W.prepareCsv('headline\nBaşlık', base).boards[0];
assert.equal(noPhotoColumn.state.photo, image);
assert.equal(noPhotoColumn.state.photoZoom, 2);
assert.equal(noPhotoColumn.state.photoX, 40);
assert.equal(W.prepareCsv('headline,photo\nBaşlık,""', base).boards[0].state.photo, '');
assert.equal(W.prepareCsv('headline,photo\nBaşlık,ç.jpg', base, { photos: { 'c\u0327.jpg': image } }).boards[0].state.photo, image);
assert.throws(() => W.prepareCsv('headline,photo\nBaşlık,bad.jpg', base, { photos: { 'bad.jpg': 'javascript:bad' } }), /güvenli değil/);
assert.equal(W.prepareCsv('headline,photo\nBaşlık,A.jpg', base, { photos: { 'a.jpg': image, 'A.JPG': image } }).warnings.length, 1);

const project = C.createProject();
project.boards = result.boards;
project.activeId = result.boards[0].id;
const board = project.boards[0];
board.name = '=HYPERLINK("bad")';
board.state.headline = 'Çok uzun **Türkçe** başlık, özel; karakterler \\ ve ' + 'ığüşöç '.repeat(24);
board.state.category = '@formül';
board.post.caption = 'İlk satır\nİkinci, satır; \\ çizgi';
board.post.altText = '  +SUM(1,1)';
const exportCsv = W.exportPlanCsv(project);
assert.equal(exportCsv.charCodeAt(0), 0xfeff);
assert.ok(exportCsv.includes("'="), 'Spreadsheet formula escaped');
assert.ok(exportCsv.includes("'@"), 'Category spreadsheet formula escaped');
assert.ok(exportCsv.includes("'  +SUM"), 'Whitespace-hidden formula escaped');
assert.ok(!exportCsv.includes('data:image/'), 'No embedded photo spilled into spreadsheet');
const exported = W.parseCsv(exportCsv);
assert.equal(exported.records[0].caption, board.post.caption);
assert.equal(exported.records[0].boardName[0], "'");

let ics = W.exportIcs(project);
assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n'));
assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 1);
assert.ok(ics.includes('DTSTART:20261020T143000\r\n'));
assert.ok(ics.includes('DTEND:20261020T150000\r\n'));
assert.ok(!ics.includes('DTSTART:20261020T143000Z'), 'Planned local wall time stays floating');
assert.ok(ics.includes(board.id + '@bultenstudio.local'));
const unfolded = ics.replace(/\r\n /g, '');
assert.ok(unfolded.includes('SUMMARY:Çok uzun Türkçe başlık\\, özel\\; karakterler \\\\ ve '));
assert.ok(unfolded.includes('DESCRIPTION:İlk satır\\nİkinci\\, satır\\; \\\\ çizgi\\nKaynak: https://example.com/haber\\nDurum: Hazır'));
for (const line of ics.split('\r\n')) assert.ok(Buffer.byteLength(line, 'utf8') <= 75, 'ICS UTF-8 line folding: ' + line);
assert.equal((ics.match(/\r\n /g) || []).length > 0, true);
board.post.publishAt = '2026-12-31T23:50:05';
ics = W.exportIcs(project);
assert.ok(ics.includes('DTEND:20270101T002005'));
board.post.publishAt = '9999-12-31T23:50';
assert.ok(W.exportIcs(project).includes('DURATION:PT30M'));
board.post.publishAt = '';
assert.ok(!W.exportIcs(project).includes('BEGIN:VEVENT'));
assert.equal(W.parseCsv(W.exampleCsv()).records.length, 2);
console.log('Workflow checks passed: CSV quoting/delimiters/limits, validated bulk rows, local photos, unique IDs, safe spreadsheet export, UTF-8 folded floating-time ICS.');
