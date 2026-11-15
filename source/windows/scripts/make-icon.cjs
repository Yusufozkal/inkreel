'use strict';
// Regenerate the native Karevo icons from the committed brand image.
const fs = require('node:fs');
const path = require('node:path');
let canvas;
try { canvas = require('@napi-rs/canvas'); }
catch { canvas = require('../qa/node_modules/@napi-rs/canvas'); }

const source = fs.readFileSync(path.join(__dirname, '..', '..', 'branding', 'karevo-icon.png'));
const brand = new canvas.Image();
brand.src = source;

function png(size) {
  const image = canvas.createCanvas(size, size);
  image.getContext('2d').drawImage(brand, 0, 0, size, size);
  return image.toBuffer('image/png');
}

const output = process.argv[2] ? path.resolve(process.argv[2]) : path.join(__dirname, '..', 'native');
fs.mkdirSync(output, {recursive:true});
fs.writeFileSync(path.join(output, 'icon.png'), source);
const images = [16, 32, 48, 64, 128, 256].map(size => ({ size, bytes: png(size) }));
const header = Buffer.alloc(6 + 16 * images.length);
header.writeUInt16LE(1, 2); header.writeUInt16LE(images.length, 4);
let offset = header.length;
images.forEach((image, i) => {
  const p = 6 + 16 * i;
  header[p] = image.size === 256 ? 0 : image.size; header[p + 1] = header[p];
  header.writeUInt16LE(1, p + 4); header.writeUInt16LE(32, p + 6);
  header.writeUInt32LE(image.bytes.length, p + 8); header.writeUInt32LE(offset, p + 12);
  offset += image.bytes.length;
});
fs.writeFileSync(path.join(output, 'icon.ico'), Buffer.concat([header, ...images.map(image => image.bytes)]));
console.log('Native PNG and Windows ICO generated.');
