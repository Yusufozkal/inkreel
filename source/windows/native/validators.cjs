'use strict';

const path = require('node:path');

const MAX_PROJECT = 100 * 1024 * 1024;
const MAX_IMAGE = 48 * 1024 * 1024;
const MAX_BATCH = 24;
const MAX_BATCH_BYTES = 384 * 1024 * 1024;
const MAX_PIXELS = 48 * 1000 * 1000;
const MAX_VIDEO = 80 * 1024 * 1024;
const MAX_TEXT = 10 * 1024 * 1024;
const MAX_CLIPBOARD = 10000;

function validateProject(json) {
  if (typeof json !== 'string' || Buffer.byteLength(json, 'utf8') > MAX_PROJECT) throw new Error('Proje en fazla 100 MB olabilir.');
  let parsed;
  try { parsed = JSON.parse(json); } catch { throw new Error('Proje dosyası geçerli JSON içermiyor.'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Geçerli bir Inkreel projesi seçin.');
  return json;
}

function safeName(value, fallback = 'Inkreel', ext = '') {
  let name = typeof value === 'string' ? value : fallback;
  name = name.replace(/\\/g, '/').split('/').pop().normalize('NFC');
  name = name.replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g, '-').replace(/^[. ]+|[. ]+$/g, '').slice(0, 130);
  name = name.replace(/\.(?:png|jpe?g|inkreel|karevo|bulten|netice|json|mp4|webm|csv|ics|txt)$/i, '').replace(/[. ]+$/g, '');
  if (!name || /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(name)) name = fallback;
  return name + ext;
}

function jpegSize(bytes) {
  if (bytes.length < 12 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) throw new Error('JPEG dosyası bozuk.');
  let offset = 2;
  while (offset + 4 < bytes.length) {
    if (bytes[offset] !== 0xff) throw new Error('JPEG başlığı geçersiz.');
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xda || marker === 0xd9) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) break;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) throw new Error('JPEG segmenti geçersiz.');
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      if (length < 8) throw new Error('JPEG boyutu bulunamadı.');
      return { width: bytes.readUInt16BE(offset + 5), height: bytes.readUInt16BE(offset + 3) };
    }
    offset += length;
  }
  throw new Error('JPEG boyutu bulunamadı.');
}

function decodeImage(dataUrl) {
  if (typeof dataUrl !== 'string' || dataUrl.length > Math.ceil(MAX_IMAGE / 3) * 4 + 64) throw new Error('Görsel en fazla 48 MB olabilir.');
  const match = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!match || match[2].length % 4 !== 0) throw new Error('Yalnızca PNG veya JPEG görseller kaydedilebilir.');
  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.length > MAX_IMAGE || bytes.toString('base64') !== match[2]) throw new Error('Görsel verisi geçersiz.');
  let size;
  if (match[1] === 'png') {
    if (bytes.length < 45 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || bytes.toString('ascii', 12, 16) !== 'IHDR' || bytes.readUInt32BE(8) !== 13 || bytes.toString('ascii', bytes.length - 8, bytes.length - 4) !== 'IEND') throw new Error('PNG dosyası bozuk.');
    size = { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  } else {
    size = jpegSize(bytes);
  }
  if (size.width < 1 || size.height < 1 || size.width > 16384 || size.height > 16384 || size.width * size.height > MAX_PIXELS) throw new Error('Görsel boyutları desteklenen sınırı aşıyor.');
  return { bytes, width: size.width, height: size.height, ext: match[1] === 'png' ? '.png' : '.jpg' };
}

function prepareImages(items) {
  if (!Array.isArray(items) || !items.length || items.length > MAX_BATCH) throw new Error('Bir seferde 1–24 görsel kaydedebilirsiniz.');
  let total = 0;
  const seen = new Set();
  return items.map((item, index) => {
    if (!item || typeof item !== 'object') throw new Error('Görsel listesi geçersiz.');
    const image = decodeImage(item.dataUrl);
    total += image.bytes.length;
    if (total > MAX_BATCH_BYTES) throw new Error('Toplu çıktı en fazla 384 MB olabilir.');
    const base = safeName(item.name, `Inkreel-${index + 1}`);
    let name = base + image.ext;
    for (let n = 2; seen.has(name.toLocaleLowerCase('en')); n++) name = `${base}-${n}${image.ext}`;
    seen.add(name.toLocaleLowerCase('en'));
    return { ...image, name };
  });
}

function decodeVideo(dataUrl) {
  if (typeof dataUrl !== 'string' || dataUrl.length > Math.ceil(MAX_VIDEO / 3) * 4 + 512) throw new Error('Video en fazla 80 MB olabilir.');
  const comma = dataUrl.indexOf(',');
  const header = /^data:video\/(mp4|webm)(?:;codecs=[A-Za-z0-9., _"=-]+)?;base64$/i.exec(dataUrl.slice(0, comma));
  const encoded = dataUrl.slice(comma + 1);
  if (!header || !encoded || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new Error('Yalnızca MP4 veya WebM video kaydedilebilir.');
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.length > MAX_VIDEO || bytes.toString('base64') !== encoded) throw new Error('Video verisi geçersiz.');
  const kind = header[1].toLowerCase();
  if (kind === 'mp4') validateMp4(bytes); else validateWebm(bytes);
  return { bytes, ext: '.' + kind, mime: 'video/' + kind };
}

function validateMp4(bytes) {
  let offset = 0, count = 0, hasMoov = false, hasData = false;
  while (offset < bytes.length) {
    if (offset + 8 > bytes.length || ++count > 100000) throw new Error('MP4 kutu yapısı geçersiz.');
    let length = bytes.readUInt32BE(offset), header = 8;
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    if (length === 1) {
      if (offset + 16 > bytes.length) throw new Error('MP4 kutusu eksik.');
      const wide = bytes.readBigUInt64BE(offset + 8);
      if (wide > BigInt(bytes.length)) throw new Error('MP4 kutu boyutu geçersiz.');
      length = Number(wide); header = 16;
    } else if (length === 0) length = bytes.length - offset;
    if (length < header || offset + length > bytes.length || !/^[\x20-\x7e]{4}$/.test(type)) throw new Error('MP4 dosyası eksik veya bozuk.');
    if (offset === 0 && (type !== 'ftyp' || length < header + 8 || length > 4096)) throw new Error('MP4 dosya başlığı geçersiz.');
    if (type === 'moov' && length > header) hasMoov = true;
    if (type === 'mdat' && length > header) hasData = true;
    offset += length;
  }
  if (!hasMoov || !hasData) throw new Error('MP4 video bilgisi veya görüntü verisi bulunamadı.');
}

function ebmlLength(bytes, offset) {
  if (offset >= bytes.length || bytes[offset] === 0) throw new Error('WebM öğe uzunluğu geçersiz.');
  let width = 1, mask = 0x80;
  while (!(bytes[offset] & mask)) { width++; mask >>= 1; }
  if (width > 8 || offset + width > bytes.length) throw new Error('WebM başlığı eksik.');
  let value = BigInt(bytes[offset] & (mask - 1));
  for (let index = 1; index < width; index++) value = value * 256n + BigInt(bytes[offset + index]);
  return { width, value, unknown: value === (1n << BigInt(width * 7)) - 1n };
}

function validateWebm(bytes) {
  if (bytes.length < 20 || bytes.readUInt32BE(0) !== 0x1a45dfa3) throw new Error('WebM dosya başlığı geçersiz.');
  const length = ebmlLength(bytes, 4);
  if (length.unknown || length.value > 4096n) throw new Error('WebM başlığı geçersiz.');
  const start = 4 + length.width, end = start + Number(length.value);
  if (end > bytes.length) throw new Error('WebM başlığı eksik.');
  let offset = start, hasDocType = false;
  while (offset < end) {
    let width = 1, mask = 0x80;
    while (width <= 4 && !(bytes[offset] & mask)) { width++; mask >>= 1; }
    if (width > 4 || offset + width > end) throw new Error('WebM başlık öğesi geçersiz.');
    const id = bytes.subarray(offset, offset + width).toString('hex');
    const size = ebmlLength(bytes, offset + width);
    const content = offset + width + size.width;
    if (size.unknown || size.value > BigInt(end - content)) throw new Error('WebM başlık öğesi eksik.');
    if (id === '4282' && bytes.toString('ascii', content, content + Number(size.value)) === 'webm') hasDocType = true;
    offset = content + Number(size.value);
  }
  if (!hasDocType || end + 5 >= bytes.length || bytes.readUInt32BE(end) !== 0x18538067) throw new Error('WebM video bölümü bulunamadı.');
  const segment = ebmlLength(bytes, end + 4);
  const dataOffset = end + 4 + segment.width;
  if (dataOffset >= bytes.length || (!segment.unknown && segment.value !== BigInt(bytes.length - dataOffset))) throw new Error('WebM video bölümü eksik.');
}

function prepareText(text, name) {
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > MAX_TEXT) throw new Error('Metin çıktısı en fazla 10 MB olabilir.');
  if (typeof name !== 'string') throw new Error('Metin dosyasının adı gerekli.');
  const filename = name.replace(/\\/g, '/').split('/').pop();
  const match = /\.(csv|ics|txt)$/i.exec(filename);
  if (!match) throw new Error('Yalnızca CSV, ICS veya TXT dosyası kaydedilebilir.');
  const ext = '.' + match[1].toLowerCase();
  return { bytes: Buffer.from(text, 'utf8'), ext, name: safeName(filename, 'Inkreel', ext) };
}

function validateClipboard(text) {
  if (typeof text !== 'string' || text.length > MAX_CLIPBOARD) throw new Error('Panoya en fazla 10.000 karakter kopyalanabilir.');
  return text;
}

function assetPath(root, rawUrl) {
  let url;
  try { url = new URL(rawUrl); } catch { return null; }
  if (url.protocol !== 'bulten:' || url.hostname !== 'app' || url.port || url.username || url.password) return null;
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); } catch { return null; }
  // Windows treats colons as stream separators and can normalize trailing dots/spaces.
  if (/[\\:\x00-\x1f\x7f]/.test(pathname) || pathname.split('/').some(part => part === '..' || part === '.' || /[. ]$/.test(part))) return null;
  const absolute = path.resolve(root, '.' + pathname);
  return absolute.startsWith(path.resolve(root) + path.sep) ? absolute : null;
}

module.exports = { MAX_PROJECT, MAX_IMAGE, MAX_VIDEO, MAX_TEXT, MAX_CLIPBOARD, MAX_BATCH, validateProject, safeName, decodeImage, decodeVideo, prepareImages, prepareText, validateClipboard, assetPath };
