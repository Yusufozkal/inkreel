'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { MAX_VIDEO, MAX_TEXT, safeName, validateProject, decodeImage, decodeVideo, prepareText, validateClipboard, prepareImages, assetPath } = require('../native/validators.cjs');
const png = () => 'data:image/png;base64,' + fs.readFileSync(require('node:path').join(__dirname, '..', 'native', 'icon.png')).toString('base64');

test('project validation accepts object JSON and rejects invalid project types', () => {
  assert.equal(validateProject('{"schema":3,"slides":[]}'), '{"schema":3,"slides":[]}');
  for (const value of ['', 'null', '[]', '"text"', '{', 2, {}]) assert.throws(() => validateProject(value));
});
test('filenames cannot escape export directory or use Windows device names', () => {
  assert.equal(safeName('../../one.png', 'default', '.png'), 'one.png');
  assert.equal(safeName('C:\\folder\\two.jpg', 'default', '.jpg'), 'two.jpg');
  assert.equal(safeName('CON', 'default', '.png'), 'default.png');
  for (const name of ['COM¹', 'COM².txt', 'LPT³', 'LPT¹.png']) assert.equal(safeName(name, 'default', '.png'), 'default.png');
  assert.equal(safeName('... ', 'default', '.inkreel'), 'default.inkreel');
  assert.equal(safeName('report.bulten', 'default', '.inkreel'), 'report.inkreel');
  assert.equal(safeName('report.inkreel', 'default', '.inkreel'), 'report.inkreel');
  assert.equal(safeName('report.karevo', 'default', '.inkreel'), 'report.inkreel');
  assert(!/[<>:"/\\|?*\x00-\x1f]/.test(safeName('bad<>?name:*')));
});
test('only real PNG/JPEG headers and bounded dimensions are accepted', () => {
  const image = decodeImage(png());
  assert.equal(image.width, 512); assert.equal(image.height, 512);
  for (const value of ['data:image/svg+xml;base64,PHN2Zz4=', 'data:image/png;base64,SGVsbG8=', 'https://example.com/a.png', '', null]) assert.throws(() => decodeImage(value));
  const modified = Buffer.from(png().split(',')[1], 'base64');
  modified.writeUInt32BE(30000, 16);
  assert.throws(() => decodeImage('data:image/png;base64,' + modified.toString('base64')));
});
test('batch export handles duplicate names and enforces item count', () => {
  const result = prepareImages([{ name: '../news.png', dataUrl: png() }, { name: 'news.PNG', dataUrl: png() }]);
  assert.deepEqual(result.map(item => item.name), ['news.png', 'news-2.png']);
  assert.throws(() => prepareImages([])); assert.throws(() => prepareImages(Array(25).fill({})));
});
test('custom asset origin confines all requested files to the UI', () => {
  const root = '/opt/studio/ui';
  assert.equal(assetPath(root, 'bulten://app/assets/image.jpg'), '/opt/studio/ui/assets/image.jpg');
  for (const url of ['file:///etc/passwd', 'https://app/index.html', 'bulten://evil/index.html', 'bulten://app/a/%2e%2e/%2e%2e%2fnative/main.cjs', 'bulten://app/%5c..%5cprivate.txt', 'bulten://user@app/index.html', 'bulten://app:80/index.html']) assert.equal(assetPath(root, url), null);
  for (const suffix of ['%2e%2e%20/native/main.cjs', 'assets./image.jpg', 'assets%20/image.jpg', 'assets/picture:stream.jpg', 'assets/%01image.jpg']) assert.equal(assetPath(root, 'bulten://app/' + suffix), null, suffix);
});

test('video save validates real MP4/WebM containers and rejects malformed or oversized data', () => {
  const mp4 = fs.readFileSync(path.join(__dirname, 'fixtures', 'video.mp4'));
  const webm = fs.readFileSync(path.join(__dirname, 'fixtures', 'video.webm'));
  const dataUrl = (mime, bytes) => `data:${mime};base64,` + bytes.toString('base64');
  assert.equal(decodeVideo(dataUrl('video/mp4', mp4)).ext, '.mp4');
  assert.equal(decodeVideo(dataUrl('video/mp4;codecs="avc1.42E01E"', mp4)).bytes.length, mp4.length);
  assert.equal(decodeVideo(dataUrl('video/webm;codecs=vp9', webm)).ext, '.webm');
  assert.throws(() => decodeVideo(dataUrl('video/mp4', webm)));
  assert.throws(() => decodeVideo(dataUrl('video/mp4', mp4.subarray(0, -10))));
  assert.throws(() => decodeVideo(dataUrl('video/webm', webm.subarray(0, 12))));
  assert.throws(() => decodeVideo(dataUrl('video/webm', Buffer.from('not a video container'))));
  assert.throws(() => decodeVideo(dataUrl('video/x-msvideo', mp4)));
  assert.throws(() => decodeVideo('x'.repeat(Math.ceil(MAX_VIDEO / 3) * 4 + 513)), /80 MB/);
});

test('text output is limited to UTF-8 CSV/ICS/TXT files with safe names', () => {
  for (const ext of ['csv', 'ics', 'txt']) {
    const item = prepareText('Türkçe içerik\n', '../../plan.' + ext);
    assert.equal(item.name, 'plan.' + ext);
    assert.equal(item.bytes.toString('utf8'), 'Türkçe içerik\n');
  }
  for (const name of ['file.exe', 'file.html', 'file.js', 'file.netice', 'file']) assert.throws(() => prepareText('x', name));
  assert.throws(() => prepareText('é'.repeat(MAX_TEXT / 2 + 1), 'plan.csv'), /10 MB/);
  assert.equal(prepareText('', 'empty.txt').bytes.length, 0);
});

test('clipboard only accepts bounded text', () => {
  assert.equal(validateClipboard('Türkçe açıklama'), 'Türkçe açıklama');
  assert.equal(validateClipboard('a'.repeat(10000)).length, 10000);
  assert.throws(() => validateClipboard('a'.repeat(10001)));
  assert.throws(() => validateClipboard({ text: 'x' }));
});
