'use strict';
// Regenerate the Inkreel installer artwork (NSIS welcome/finish sidebar and page header).
// Output: installer/art/wizard.bmp (328x628) and installer/art/header.bmp (300x114), 24-bit BMP.
// Both are drawn at 2x of the NSIS control size so they stay sharp on high-DPI screens.
const fs = require('node:fs');
const path = require('node:path');
let canvas;
try { canvas = require('@napi-rs/canvas'); }
catch { canvas = require('../qa/node_modules/@napi-rs/canvas'); }
const { createCanvas, Image, GlobalFonts } = canvas;

const root = path.join(__dirname, '..');
GlobalFonts.registerFromPath(path.join(root, 'ui', 'assets', 'font-7.woff2'), 'Manrope ExtraBold');
GlobalFonts.registerFromPath(path.join(root, 'ui', 'assets', 'font-6.woff2'), 'Manrope Bold');
GlobalFonts.registerFromPath(path.join(root, 'ui', 'assets', 'font-4.woff2'), 'Manrope Medium');

const logo = new Image();
logo.src = fs.readFileSync(path.join(root, '..', 'branding', 'inkreel-icon.svg'));

function bmp(cv) {
  const { width, height } = cv;
  const rgba = cv.getContext('2d').getImageData(0, 0, width, height).data;
  const row = Math.ceil(width * 3 / 4) * 4;
  const out = Buffer.alloc(54 + row * height);
  out.write('BM', 0); out.writeUInt32LE(out.length, 2); out.writeUInt32LE(54, 10);
  out.writeUInt32LE(40, 14); out.writeInt32LE(width, 18); out.writeInt32LE(height, 22);
  out.writeUInt16LE(1, 26); out.writeUInt16LE(24, 28); out.writeUInt32LE(row * height, 34);
  out.writeInt32LE(2835, 38); out.writeInt32LE(2835, 42);
  for (let y = 0; y < height; y++) {
    const target = 54 + (height - 1 - y) * row;
    for (let x = 0; x < width; x++) {
      const s = (y * width + x) * 4, t = target + x * 3;
      out[t] = rgba[s + 2]; out[t + 1] = rgba[s + 1]; out[t + 2] = rgba[s];
    }
  }
  return out;
}

function wizard() {
  const cv = createCanvas(328, 628), g = cv.getContext('2d');
  const bg = g.createLinearGradient(0, 0, 328, 628);
  bg.addColorStop(0, '#18243a'); bg.addColorStop(1, '#2a2f55');
  g.fillStyle = bg; g.fillRect(0, 0, 328, 628);
  // Soft accent shapes, echoing the README banner.
  g.fillStyle = '#6d5ae0';
  g.beginPath(); g.arc(300, 600, 170, 0, Math.PI * 2); g.fill();
  g.strokeStyle = 'rgba(214, 207, 251, 0.28)'; g.lineWidth = 2;
  g.beginPath(); g.arc(300, 600, 118, 0, Math.PI * 2); g.stroke();
  g.fillStyle = 'rgba(255, 255, 255, 0.06)'; g.fillRect(0, 470, 328, 1);
  // Logo with a subtle outline so the navy tile reads on the navy background.
  g.drawImage(logo, 92, 104, 144, 144);
  g.strokeStyle = 'rgba(255, 255, 255, 0.18)'; g.lineWidth = 2;
  g.beginPath(); g.roundRect(92, 104, 144, 144, 31.5); g.stroke();
  g.textAlign = 'center';
  g.fillStyle = '#ffffff'; g.font = '54px "Manrope ExtraBold"';
  g.fillText('inkreel', 164, 322);
  g.fillStyle = '#a99cf2'; g.fillRect(146, 346, 36, 4);
  g.fillStyle = '#c9d3dc'; g.font = '19px "Manrope Medium"';
  g.fillText('Tasarla · Düzenle · Paylaş', 164, 392);
  return cv;
}

function header() {
  const cv = createCanvas(300, 114), g = cv.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 300, 114);
  g.drawImage(logo, 196, 17, 80, 80);
  g.textAlign = 'right'; g.fillStyle = '#1f2a3a'; g.font = '30px "Manrope ExtraBold"';
  g.fillText('inkreel', 182, 68);
  return cv;
}

const out = path.join(root, 'installer', 'art');
fs.mkdirSync(out, { recursive: true });
const art = { 'wizard.bmp': wizard(), 'header.bmp': header() };
for (const [name, cv] of Object.entries(art)) fs.writeFileSync(path.join(out, name), bmp(cv));
if (process.argv[2]) for (const [name, cv] of Object.entries(art)) fs.writeFileSync(path.join(process.argv[2], name.replace('.bmp', '.png')), cv.toBuffer('image/png'));
console.log('Installer artwork generated in ' + path.relative(process.cwd(), out));
