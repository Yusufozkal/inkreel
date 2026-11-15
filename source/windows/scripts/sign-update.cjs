#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { APP_ID, MAX_INSTALLER_BYTES, createEnvelope, normalizePublicKey, verifyEnvelope, validateFeedUrl } = require('../native/update-contract.cjs');
function parseArguments(argv) {
  const values = {}, allowed = ['--installer', '--url', '--version', '--sequence', '--notes-file', '--key', '--out'];
  for (let index = 0; index < argv.length; index += 2) {
    if (!allowed.includes(argv[index]) || !argv[index + 1] || Object.prototype.hasOwnProperty.call(values, argv[index])) throw new Error('Geçerli --installer, --url, --version, --sequence, --key ve --out seçeneklerini kullanın.');
    values[argv[index]] = argv[index + 1];
  }
  for (const field of ['--installer', '--url', '--version', '--sequence', '--key', '--out']) if (!values[field]) throw new Error(field + ' seçeneği gerekli.');
  return values;
}
function sameFile(left, right) {
  const a = fs.statSync(left), b = fs.statSync(right);
  return fs.realpathSync(left) === fs.realpathSync(right) || (a.dev === b.dev && a.ino === b.ino);
}
function checkOutput(outputPath, protectedPaths) {
  let output;
  try { output = fs.lstatSync(outputPath); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  if (!output.isFile() || output.isSymbolicLink()) throw new Error('Yayın çıktısı normal bir dosya olmalı.');
  if (protectedPaths.some(filename => sameFile(filename, outputPath))) throw new Error('Yayın çıktısı anahtar, kurucu veya sürüm notlarının üzerine yazamaz.');
}
function checkExecutable(filename, size) {
  const handle = fs.openSync(filename, 'r');
  try {
    const header = Buffer.alloc(64);
    if (fs.readSync(handle, header, 0, header.length, 0) !== 64 || header.toString('ascii', 0, 2) !== 'MZ') throw new Error('Geçerli bir Windows kurucusu seçin.');
    const offset = header.readUInt32LE(0x3c), pe = Buffer.alloc(6);
    if (offset < 64 || offset + 24 > size || fs.readSync(handle, pe, 0, pe.length, offset) !== 6 || pe.readUInt32LE(0) !== 0x4550 || ![0x14c, 0x8664].includes(pe.readUInt16LE(4))) throw new Error('Windows kurucusunun PE başlığı geçersiz.');
  } finally { fs.closeSync(handle); }
}
async function main(argv) {
  const values = parseArguments(argv), installerPath = path.resolve(values['--installer']), keyPath = path.resolve(values['--key']), outputPath = path.resolve(values['--out']);
  if (outputPath === installerPath || outputPath === keyPath) throw new Error('Çıktı dosyası anahtar veya kurulum dosyasının üzerine yazamaz.');
  const stat = fs.lstatSync(installerPath);
  if (!stat.isFile() || stat.isSymbolicLink() || !stat.size || stat.size > MAX_INSTALLER_BYTES) throw new Error('Kurulum dosyası geçersiz veya çok büyük.');
  const keyStat = fs.lstatSync(keyPath);
  if (!keyStat.isFile() || keyStat.isSymbolicLink() || keyStat.size > 4096) throw new Error('İmzalama anahtarı dosyası geçersiz.');
  if (sameFile(installerPath, keyPath)) throw new Error('Kurucu ile özel anahtar ayrı dosyalar olmalı.');
  checkExecutable(installerPath, stat.size);
  const url = validateFeedUrl(values['--url']);
  if (!/^\d+$/.test(values['--sequence'])) throw new Error('Yayın sırası pozitif tamsayı olmalı.');
  const notesPath = values['--notes-file'] ? path.resolve(values['--notes-file']) : null;
  let notes = '';
  if (notesPath) {
    const notesStat = fs.lstatSync(notesPath);
    if (!notesStat.isFile() || notesStat.isSymbolicLink() || notesStat.size > 32768 || sameFile(notesPath, keyPath) || sameFile(notesPath, installerPath)) throw new Error('Sürüm notları özel anahtar veya kurucu dosyası olamaz; en fazla 32 KB metin seçin.');
    try { notes = new TextDecoder('utf-8', { fatal: true }).decode(fs.readFileSync(notesPath)); }
    catch { throw new Error('Sürüm notları geçerli UTF-8 metni olmalı.'); }
    if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(notes)) throw new Error('Sürüm notları özel anahtar içeriyor; yayın bilgisi oluşturulmadı.');
  }
  const protectedPaths = [installerPath, keyPath, ...(notesPath ? [notesPath] : [])];
  checkOutput(outputPath, protectedPaths);
  const hash = crypto.createHash('sha256');
  let readBytes = 0;
  for await (const chunk of fs.createReadStream(installerPath)) { readBytes += chunk.length; if (readBytes > MAX_INSTALLER_BYTES) throw new Error('Kurulum dosyası okuma sırasında boyut sınırını aştı.'); hash.update(chunk); }
  const after = fs.lstatSync(installerPath);
  if (!after.isFile() || after.isSymbolicLink() || readBytes !== stat.size || after.size !== stat.size || after.ino !== stat.ino || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs) throw new Error('Kurulum dosyası imzalama sırasında değişti. Derleme tamamlandıktan sonra yeniden deneyin.');
  const payload = { schema: 'bulten-studio-update', schemaVersion: 1, appId: APP_ID, platform: 'win32', arch: 'x64', channel: 'stable', version: values['--version'], sequence: Number(values['--sequence']), publishedAt: new Date().toISOString(), installer: { fileName: path.basename(installerPath), url, sha256: hash.digest('hex'), size: stat.size }, notes };
  const key = fs.readFileSync(keyPath), envelope = createEnvelope(payload, key);
  const publicKey = normalizePublicKey(crypto.createPublicKey(crypto.createPrivateKey(key)).export({ type: 'spki', format: 'pem' }).toString());
  verifyEnvelope(JSON.stringify(envelope), { publicKey, appVersion: payload.version });
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  // Resolve parent aliases before writing, and recheck existing file identities.
  checkOutput(path.join(fs.realpathSync(path.dirname(outputPath)), path.basename(outputPath)), protectedPaths);
  const temporary = outputPath + '.tmp-' + crypto.randomUUID();
  try { fs.writeFileSync(temporary, JSON.stringify(envelope, null, 2) + '\n', { flag: 'wx', mode: 0o644 }); fs.renameSync(temporary, outputPath); }
  finally { fs.rmSync(temporary, { force: true }); }
  console.log(JSON.stringify({ manifest: outputPath, version: payload.version, sequence: payload.sequence, installerBytes: payload.installer.size, installerSha256: payload.installer.sha256, keyId: envelope.keyId, privateKeyPrinted: false }));
}
if (require.main === module) main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { main, parseArguments };
