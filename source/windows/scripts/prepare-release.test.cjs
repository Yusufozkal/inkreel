'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { prepareRelease } = require('./prepare-release.cjs');
const C = require('../native/update-contract.cjs');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bulten-prepare-'));
  const version = '3.1.0', installer = path.join(root, 'Karevo-' + version + '-Setup.exe'), keyFile = path.join(root, 'private.pem'), out = path.join(root, 'release'), notes = path.join(root, 'notes.txt');
  const keys = crypto.generateKeyPairSync('ed25519'), pin = C.normalizePublicKey(keys.publicKey.export({ type: 'spki', format: 'pem' }).toString());
  const executable = Buffer.alloc(1024); executable.write('MZ'); executable.writeUInt32LE(128, 0x3c); executable.writeUInt32LE(0x4550, 128); executable.writeUInt16LE(0x14c, 132); executable.write('Installer fixture', 200);
  fs.writeFileSync(installer, executable); fs.writeFileSync(keyFile, keys.privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 }); fs.writeFileSync(notes, 'Bu sürüm test düzeltmelerini içerir.');
  const calls = [], logs = [];
  const argv = ['--repo', 'example-owner/bulten-updates', '--installer', installer, '--version', version, '--sequence', '30100', '--key', keyFile, '--out', out, '--notes-file', notes];
  const dependencies = { publicKey: pin, log: value => logs.push(JSON.parse(value)), spawnSync(command, args, options) { calls.push({ command, args, options }); if (command === 'gh') return { status: 0 }; return spawnSync(command, args, { ...options, stdio: 'pipe' }); } };
  return { root, version, installer, keyFile, out, notes, pin, keys, executable, calls, logs, argv, dependencies, cleanup() { fs.rmSync(root, { recursive: true, force: true }); } };
}
function replace(argv, key, value) { const result = argv.slice(); result[result.indexOf(key) + 1] = value; return result; }

test('preparation signs exact public files; absence of --publish performs zero GitHub writes', () => {
  const f = fixture();
  try {
    fs.mkdirSync(f.out); fs.writeFileSync(path.join(f.out, 'not-a-public-asset.txt'), 'Must never enter asset list');
    const output = prepareRelease(f.argv, f.dependencies);
    assert.equal(output.prepared, true); assert.equal(output.published, false); assert.equal(f.calls.length, 1); assert.equal(f.calls[0].command, process.execPath);
    assert.deepEqual(output.files.map(file => path.basename(file)), [path.basename(f.installer), 'latest.json']);
    assert(!output.files.some(file => file === f.keyFile || file === f.notes));
    const verified = C.verifyEnvelope(fs.readFileSync(output.files[1]), { publicKey: f.pin, appVersion: '3.0.0' });
    assert.equal(verified.isNewer, true); assert.equal(verified.payload.installer.sha256, crypto.createHash('sha256').update(f.executable).digest('hex'));
    assert.equal(verified.payload.installer.fileName, path.basename(f.installer)); assert.equal(verified.payload.installer.size, f.executable.length);
    assert(!JSON.stringify(f.logs).includes('BEGIN PRIVATE KEY')); assert.equal(f.logs.length, 1);
  } finally { f.cleanup(); }
});
test('--publish invokes gh once with only installer and signed manifest as release assets', () => {
  const f = fixture();
  try {
    const result = prepareRelease([...f.argv, '--publish'], f.dependencies);
    assert.equal(result.published, true); const github = f.calls.filter(call => call.command === 'gh'); assert.equal(github.length, 1);
    const command = github[0]; assert.deepEqual(command.args.slice(0, 7), ['release', 'create', 'v3.1.0', '--repo', 'example-owner/bulten-updates', path.join(f.out, path.basename(f.installer)), path.join(f.out, 'latest.json')]);
    assert.equal(command.options.shell, false); assert(!command.args.includes(f.keyFile)); assert(command.args.includes('--notes-file')); assert.equal(f.logs.at(-1).published, true);
  } finally { f.cleanup(); }
});
test('version and filename must match; malformed or duplicate options cannot trigger a GitHub action', () => {
  const f = fixture();
  try {
    for (const argv of [replace(f.argv, '--version', '3.2.0'), replace(f.argv, '--version', '03.1.0'), replace(f.argv, '--sequence', '0'), replace(f.argv, '--repo', 'owner/..'), [...f.argv, '--publsh', 'yes'], [...f.argv, '--publish', '--publish']]) assert.throws(() => prepareRelease(argv, f.dependencies));
    assert.equal(f.calls.length, 0); assert.equal(fs.existsSync(f.out), false);
  } finally { f.cleanup(); }
});
test('private key aliases and PEM-bearing notes are refused before any publish or private-byte mutation', () => {
  const f = fixture();
  try {
    const original = fs.readFileSync(f.keyFile), hardlink = path.join(f.root, 'aliased-notes.txt'), copy = path.join(f.root, 'copied-notes.txt');
    fs.linkSync(f.keyFile, hardlink); fs.copyFileSync(f.keyFile, copy);
    for (const notes of [f.keyFile, hardlink, copy]) assert.throws(() => prepareRelease(replace(f.argv, '--notes-file', notes), f.dependencies), /anahtar/);
    assert.throws(() => prepareRelease(replace(f.argv, '--installer', f.keyFile), f.dependencies));
    assert.equal(f.calls.length, 0); assert.deepEqual(fs.readFileSync(f.keyFile), original);
  } finally { f.cleanup(); }
});
test('existing output symlinks, broken symlinks, hardlinks to keys and private output directories are refused', () => {
  for (const kind of ['target-link', 'manifest-link', 'broken-link', 'target-hardlink', 'manifest-hardlink', 'private-in-output', 'folder-link']) {
    const f = fixture();
    try {
      const original = fs.readFileSync(f.keyFile); fs.mkdirSync(f.out);
      const target = path.join(f.out, path.basename(f.installer)), manifest = path.join(f.out, 'latest.json'); let argv = f.argv;
      if (kind === 'target-link') fs.symlinkSync(f.keyFile, target);
      if (kind === 'manifest-link') fs.symlinkSync(f.keyFile, manifest);
      if (kind === 'broken-link') fs.symlinkSync(path.join(f.root, 'must-not-create.pem'), target);
      if (kind === 'target-hardlink') fs.linkSync(f.keyFile, target);
      if (kind === 'manifest-hardlink') fs.linkSync(f.keyFile, manifest);
      if (kind === 'private-in-output') argv = replace(argv, '--out', f.root);
      if (kind === 'folder-link') { const alias = path.join(f.root, 'folder-link'); fs.symlinkSync(f.out, alias, 'dir'); argv = replace(argv, '--out', alias); }
      assert.throws(() => prepareRelease(argv, f.dependencies), undefined, kind); assert.equal(f.calls.length, 0, kind); assert.deepEqual(fs.readFileSync(f.keyFile), original, kind); assert(!fs.existsSync(path.join(f.root, 'must-not-create.pem')));
    } finally { f.cleanup(); }
  }
});
test('wrong signing identity or non-PE installers are rejected before public files are prepared', () => {
  const f = fixture();
  try {
    const wrongKey = crypto.generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }).toString();
    assert.throws(() => prepareRelease(f.argv, { ...f.dependencies, publicKey: wrongKey }), /eşleşmiyor/);
    fs.writeFileSync(f.installer, 'A private PEM or arbitrary text renamed to .exe is not a Windows installer.');
    assert.throws(() => prepareRelease(f.argv, f.dependencies), /kurucu/);
    assert.equal(f.calls.length, 0); assert.equal(fs.existsSync(f.out), false);
  } finally { f.cleanup(); }
});
test('GitHub failure cannot be reported as a successful publication', () => {
  const f = fixture();
  try {
    const originalRunner = f.dependencies.spawnSync;
    f.dependencies.spawnSync = (command, args, options) => command === 'gh' ? { status: 1 } : originalRunner(command, args, options);
    assert.throws(() => prepareRelease([...f.argv, '--publish'], f.dependencies), /tamamlanamadı/); assert(!f.logs.some(value => value.published));
  } finally { f.cleanup(); }
});
