#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { normalizePublicKey } = require('../native/update-contract.cjs');

function argumentsFor(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    if (!['--private', '--public'].includes(key) || !argv[index + 1] || Object.prototype.hasOwnProperty.call(result, key)) throw new Error('Kullanım: node scripts/create-update-key.cjs --private ÖZEL_ANAHTAR_DOSYASI --public GENEL_ANAHTAR_JSON');
    result[key] = path.resolve(argv[index + 1]);
  }
  if (!result['--private'] || !result['--public'] || result['--private'] === result['--public']) throw new Error('Ayrı özel ve genel anahtar dosyaları belirtin.');
  return result;
}
function main(argv) {
  const options = argumentsFor(argv), privatePath = options['--private'], publicPath = options['--public'];
  // The private key must never be placed under the application/package tree.
  const projectRoot = path.resolve(__dirname, '..');
  if (privatePath === projectRoot || privatePath.startsWith(projectRoot + path.sep)) throw new Error('Özel anahtarı uygulama kaynaklarının dışındaki güvenli bir klasörde saklayın.');
  let reused = fs.existsSync(privatePath), privateKey;
  if (!reused && fs.existsSync(publicPath)) throw new Error('Genel anahtar var ancak özel anahtar bulunamadı. Yeni kimlik oluşturmak yerine mevcut özel anahtarın yedeğini geri yükleyin.');
  if (reused) {
    const stat = fs.lstatSync(privatePath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4096) throw new Error('Mevcut özel anahtar dosyası geçersiz.');
    privateKey = crypto.createPrivateKey(fs.readFileSync(privatePath));
  } else {
    const generated = crypto.generateKeyPairSync('ed25519'); privateKey = generated.privateKey;
    fs.mkdirSync(path.dirname(privatePath), { recursive: true, mode: 0o700 });
    fs.writeFileSync(privatePath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { flag: 'wx', mode: 0o600 });
  }
  if (privateKey.asymmetricKeyType !== 'ed25519') throw new Error('Mevcut özel anahtar Ed25519 değil.');
  fs.chmodSync(privatePath, 0o600);
  const pin = normalizePublicKey(crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }).toString());
  if (fs.existsSync(publicPath)) {
    const current = normalizePublicKey(JSON.parse(fs.readFileSync(publicPath, 'utf8')));
    if (current.keyId !== pin.keyId) throw new Error('Mevcut genel anahtar farklı. Anahtar değişimini açıkça planlamadan üzerine yazmayın.');
  } else {
    fs.mkdirSync(path.dirname(publicPath), { recursive: true });
    fs.writeFileSync(publicPath, JSON.stringify(pin, null, 2) + '\n', { flag: 'wx', mode: 0o644 });
  }
  console.log(JSON.stringify({ publicKeyFile: publicPath, keyId: pin.keyId, reusedPrivateKey: reused, privateKeyPrinted: false }));
}
if (require.main === module) { try { main(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode = 1; } }
module.exports = { main, argumentsFor };
