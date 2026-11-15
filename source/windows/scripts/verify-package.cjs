'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const folder = path.resolve(process.argv.slice(2).find(value => !value.startsWith('--')) || path.join(root, 'dist', 'Karevo-win32-x64'));
const nozip = process.argv.includes('--nozip');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

async function walk(dir, prefix) {
  const files = [];
  for (const item of await fs.readdir(dir, { withFileTypes: true })) {
    const relative = path.posix.join(prefix, item.name);
    if (item.isDirectory()) files.push(...await walk(path.join(dir, item.name), relative));
    else if (item.isFile()) files.push(relative);
  }
  return files;
}

(async () => {
  const { extractFile, listPackage } = await import('@electron/asar');
  const asarPath = path.join(folder, 'resources', 'app.asar');
  const files = listPackage(asarPath);
  assert(files.every(file => file === '/package.json' || /^\/(?:ui|native)(?:\/|$)/.test(file)), 'Only native, UI and package.json may enter app.asar');
  assert(!files.some(file => /(?:private[-_]?key|\.pem$|\.p12$|\.pfx$|\.password$|signing\/)/i.test(file)), 'Private signing material must never enter app.asar');
  for (const file of ['native/update-contract.cjs', 'native/update-manager.cjs', 'native/update-public-key.json']) assert(files.includes('/'+file), `Missing updater file: ${file}`);
  const sourceFiles = [...await walk(path.join(root, 'ui'), 'ui'), ...await walk(path.join(root, 'native'), 'native')];
  const packagedFiles = files.filter(file => !files.some(other => other.startsWith(file + '/'))).map(file => file.replace(/^\//, '')).sort();
  assert.deepEqual(packagedFiles, [...sourceFiles, 'package.json'].sort(), 'ASAR must contain exactly the current source files');
  for (const file of sourceFiles) assert.equal(sha(extractFile(asarPath, file)), sha(await fs.readFile(path.join(root, file))), `Packaged source changed: ${file}`);
  const pkg = JSON.parse(extractFile(asarPath, 'package.json').toString('utf8'));
  const sourcePackage = require('../package.json');
  assert.equal(pkg.version, sourcePackage.version);
  const electronVersion = (await fs.readFile(path.join(folder, 'version'), 'utf8')).trim();
  assert.equal(electronVersion, sourcePackage.devDependencies.electron, 'Runtime must match the pinned Electron release');
  assert.equal(pkg.main, 'native/main.cjs');
  assert.equal(pkg.productName, 'Karevo');
  assert.equal(pkg.name, 'karevo');
  const pin = JSON.parse(extractFile(asarPath, 'native/update-public-key.json').toString('utf8'));
  assert.equal(pin.schema, 'bulten-update-public-key');
  assert.equal(pin.algorithm, 'Ed25519');
  assert(!pin.publicKey.includes('PRIVATE KEY'));
  const publicKey = crypto.createPublicKey(pin.publicKey);
  assert.equal(publicKey.asymmetricKeyType, 'ed25519');
  const publicDer = publicKey.export({ type: 'spki', format: 'der' });
  assert.equal(pin.keyId, 'ed25519:' + sha(publicDer).slice(0, 32));
  const exe = path.join(folder, 'Karevo.exe');
  const handle = await fs.open(exe, 'r');
  let header = Buffer.alloc(4096);
  try { await handle.read(header, 0, header.length, 0); } finally { await handle.close(); }
  assert.equal(header.toString('ascii', 0, 2), 'MZ');
  const pe = header.readUInt32LE(0x3c);
  assert.equal(header.readUInt32LE(pe), 0x00004550);
  assert.equal(header.readUInt16LE(pe + 4), 0x8664, 'Expected Windows x64 executable');
  const optional = pe + 24;
  assert.equal(header.readUInt16LE(optional), 0x20b, 'Expected PE32+');
  assert.equal(header.readUInt16LE(optional + 68), 2, 'Expected Windows GUI subsystem');
  const certificateBytes = header.readUInt32LE(optional + 148);
  const archive = path.join(root, 'dist', `Karevo-${pkg.version}-Windows-x64.zip`);
  const result = { platform: 'win32', arch: 'x64', version: pkg.version, electronVersion, productName: pkg.productName, sourceFilesMatch: sourceFiles.length, exactAsarInventory: true, asarSha256: sha(await fs.readFile(asarPath)), runtimeFolder: folder, exeSha256: sha(await fs.readFile(exe)), authenticodeCertificateBytes: certificateBytes, updateVerification: 'pinned Ed25519 public key', updateKeyId: pin.keyId, windowsRuntimeTested: false };
  if (!nozip) {
    execFileSync('unzip', ['-tq', archive], { stdio: 'inherit' });
    result.portableArchive = archive;
    result.archiveBytes = (await fs.stat(archive)).size;
    result.sha256 = sha(await fs.readFile(archive));
    assert.equal(result.sha256, (await fs.readFile(archive + '.sha256', 'utf8')).split(' ')[0]);
  }
  await fs.writeFile(path.join(root, 'dist', `verification-${pkg.version}.json`), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
