/* Prepare only explicit public release files. No GitLab writes without --publish. Publishing uses the glab CLI (gitlab.com/<namespace>/<project>). */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const C = require('../native/update-contract.cjs');

function args(argv) {
  const values = {}, allowed = ['repo', 'installer', 'version', 'sequence', 'key', 'out', 'notes-file'];
  for (let index = 0; index < argv.length; index++) {
    const option = argv[index];
    if (option === '--publish') {
      if (values.publish) throw new Error('--publish bir kez kullanılabilir.');
      values.publish = true; continue;
    }
    const key = typeof option === 'string' && option.startsWith('--') ? option.slice(2) : '';
    if (!allowed.includes(key) || values[key] !== undefined || !argv[index + 1] || argv[index + 1].startsWith('--')) throw new Error('Bilinmeyen, yinelenen veya eksik parametre: ' + option);
    values[key] = argv[++index];
  }
  return values;
}
function fileInfo(filename, max, label) {
  const absolute = path.resolve(filename), stat = fs.lstatSync(absolute);
  if (!stat.isFile() || stat.isSymbolicLink() || !stat.size || stat.size > max) throw new Error(label + ' geçersiz veya çok büyük.');
  return { absolute, real: fs.realpathSync(absolute), stat };
}
function sameFile(left, right) {
  return left.real === right.real || (left.stat.dev === right.stat.dev && left.stat.ino === right.stat.ino);
}
function inside(folder, filename) { return filename === folder || filename.startsWith(folder + path.sep); }
function prospectiveFile(folder, name) {
  const absolute = path.join(folder, name);
  let stat;
  try { stat = fs.lstatSync(absolute); } catch (error) { if (error.code === 'ENOENT') return { absolute, real: absolute, stat: { dev: -1, ino: -1 } }; throw error; }
  if (stat.isSymbolicLink()) throw new Error('Yayın çıktısı sembolik bağlantı olamaz.');
  return fileInfo(absolute, Number.MAX_SAFE_INTEGER, 'Mevcut yayın çıktısı');
}
function validateExecutable(file) {
  const handle = fs.openSync(file.absolute, 'r');
  try {
    const header = Buffer.alloc(64);
    if (fs.readSync(handle, header, 0, header.length, 0) !== 64 || header.toString('ascii', 0, 2) !== 'MZ') throw new Error('Geçerli bir Windows kurucusu seçin.');
    const offset = header.readUInt32LE(0x3c);
    if (offset < 64 || offset + 24 > file.stat.size) throw new Error('Windows kurucusunun PE başlığı geçersiz.');
    const pe = Buffer.alloc(6); fs.readSync(handle, pe, 0, pe.length, offset);
    if (pe.readUInt32LE(0) !== 0x4550 || ![0x14c, 0x8664].includes(pe.readUInt16LE(4))) throw new Error('Windows kurucusunun PE başlığı geçersiz.');
  } finally { fs.closeSync(handle); }
}
function prepareRelease(argv, dependencies = {}) {
  const run = dependencies.spawnSync || spawnSync, log = dependencies.log || console.log;
  const a = args(argv);
  const repoSegment = '[A-Za-z0-9_][A-Za-z0-9_.-]{0,99}';
  if (!new RegExp('^' + repoSegment + '(?:/' + repoSegment + ')+$').test(a.repo || '') || (a.repo || '').split('/').some(part => /^\.+$/.test(part) || /\.git$/.test(part)) || (a.repo || '').length > 255) throw new Error('--repo ad-alani/proje (iç içe gruplar dahil, örn. Turkish_Vito/karevo) biçiminde gerekli.');
  for (const key of ['installer', 'version', 'sequence', 'key']) if (!a[key]) throw new Error('--' + key + ' gerekli.');
  C.compareVersions(a.version, a.version);
  if (!/^[1-9]\d*$/.test(a.sequence) || !Number.isSafeInteger(Number(a.sequence))) throw new Error('Yayın sırası pozitif ve güvenli bir tamsayı olmalı.');
  const installer = fileInfo(a.installer, C.MAX_INSTALLER_BYTES, 'Kurulum dosyası'), key = fileInfo(a.key, 4096, 'İmzalama anahtarı');
  const fileName = path.basename(installer.absolute);
  if (fileName !== 'Karevo-' + a.version + '-Setup.exe') throw new Error('Kurucu dosya adı belirtilen sürümle tam olarak eşleşmeli.');
  if (sameFile(installer, key)) throw new Error('Kurucu ve özel anahtar ayrı dosyalar olmalı.');
  validateExecutable(installer);
  const privateKey = crypto.createPrivateKey(fs.readFileSync(key.absolute));
  const actualPin = C.normalizePublicKey(crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }).toString());
  const expectedPin = C.normalizePublicKey(dependencies.publicKey || JSON.parse(fs.readFileSync(path.join(__dirname, '../native/update-public-key.json'), 'utf8')));
  if (actualPin.keyId !== expectedPin.keyId) throw new Error('İmzalama anahtarı dağıtılan uygulamanın genel anahtarıyla eşleşmiyor.');
  const notes = a['notes-file'] ? fileInfo(a['notes-file'], 32768, 'Sürüm notu dosyası') : null;
  if (notes) {
    if (sameFile(notes, key) || sameFile(notes, installer)) throw new Error('Sürüm notları özel anahtar veya kurucu dosyası olamaz.');
    const text = fs.readFileSync(notes.absolute, 'utf8');
    if (text.length > 8000 || /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text)) throw new Error('Sürüm notları çok uzun veya özel anahtar içeriyor.');
  }
  const requestedFolder = path.resolve(a.out || path.join('release', 'v' + a.version));
  fs.mkdirSync(requestedFolder, { recursive: true });
  if (fs.lstatSync(requestedFolder).isSymbolicLink()) throw new Error('Yayın klasörü sembolik bağlantı olamaz.');
  const folder = fs.realpathSync(requestedFolder);
  if (inside(folder, key.real)) throw new Error('Özel anahtar yayın klasörünün içinde bulunamaz.');
  const targetInfo = prospectiveFile(folder, fileName), manifestInfo = prospectiveFile(folder, 'latest.json');
  for (const output of [targetInfo, manifestInfo]) {
    if (sameFile(output, key) || (notes && sameFile(output, notes))) throw new Error('Yayın çıktısı özel anahtarın veya sürüm notlarının üzerine yazamaz.');
  }
  if (sameFile(manifestInfo, installer)) throw new Error('İmzalı yayın bilgisi kurucunun üzerine yazamaz.');
  const target = targetInfo.absolute, manifest = manifestInfo.absolute;
  if (!sameFile(installer, targetInfo)) fs.copyFileSync(installer.absolute, target);
  const url = 'https://gitlab.com/' + a.repo + '/-/releases/v' + a.version + '/downloads/' + encodeURIComponent(fileName);
  const signArgs = [path.join(__dirname, 'sign-update.cjs'), '--installer', target, '--url', url, '--version', a.version, '--sequence', a.sequence, '--key', key.absolute, '--out', manifest];
  if (notes) signArgs.push('--notes-file', notes.absolute);
  let result = run(process.execPath, signArgs, { stdio: 'inherit', shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('Güncelleme imzalanamadı.');
  const signed = C.verifyEnvelope(fs.readFileSync(manifest), { publicKey: expectedPin, appVersion: a.version }).payload;
  if (signed.version !== a.version || signed.sequence !== Number(a.sequence) || signed.installer.fileName !== fileName || signed.installer.url !== url || signed.installer.size !== fs.statSync(target).size) throw new Error('Hazırlanan yayın dosyaları eşleşmiyor.');
  const verifiedTarget = fileInfo(target, C.MAX_INSTALLER_BYTES, 'Hazırlanan kurucu');
  const hash = crypto.createHash('sha256'), handle = fs.openSync(target, 'r'), buffer = Buffer.alloc(1024 * 1024); let total = 0;
  try { let length; while ((length = fs.readSync(handle, buffer, 0, buffer.length, null)) > 0) { total += length; if (total > C.MAX_INSTALLER_BYTES) throw new Error('Hazırlanan kurucu boyut sınırını aşıyor.'); hash.update(buffer.subarray(0, length)); } }
  finally { fs.closeSync(handle); }
  if (verifiedTarget.stat.size !== signed.installer.size || total !== signed.installer.size || hash.digest('hex') !== signed.installer.sha256) throw new Error('Hazırlanan kurucu imzalı dosya özetiyle eşleşmiyor.');
  const feed = 'https://gitlab.com/' + a.repo + '/-/releases/permalink/latest/downloads/latest.json';
  const releaseArgs = ['release', 'create', 'v' + a.version, target, manifest, '--repo', a.repo, '--name', 'Karevo ' + a.version];
  if (notes) releaseArgs.push('--notes-file', notes.absolute); else releaseArgs.push('--notes', 'Karevo ' + a.version + ' Windows güncellemesi.');
  const output = { prepared: true, published: false, repo: a.repo, feed, files: [target, manifest], next: 'Dosyalar hazır. Yayımlamak için aynı komuta --publish ekleyin; glab ile GitLab hesabınızda oturum açılmış olmalı.' };
  log(JSON.stringify(output, null, 2));
  if (a.publish) {
    result = run('glab', releaseArgs, { stdio: 'inherit', shell: false });
    if (result.error) throw new Error('GitLab CLI (glab) bulunamadı. glab kurun ve glab auth login ile kendi GitLab hesabınızda oturum açın.');
    if (result.status !== 0) throw new Error('GitLab yayını tamamlanamadı. Mevcut sürümü silmeden hatayı kontrol edin.');
    output.published = true; log(JSON.stringify({ published: true, repo: a.repo, feed }));
  }
  return output;
}
if (require.main === module) { try { prepareRelease(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode = 1; } }
module.exports = { prepareRelease, args };
