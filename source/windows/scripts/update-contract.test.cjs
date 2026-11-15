'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const C = require('../native/update-contract.cjs');
const generated = crypto.generateKeyPairSync('ed25519');
const privatePem = generated.privateKey.export({ type: 'pkcs8', format: 'pem' });
const publicPem = generated.publicKey.export({ type: 'spki', format: 'pem' }).toString();
const pin = C.normalizePublicKey(publicPem);
function payload(overrides = {}) {
  return { schema: 'bulten-studio-update', schemaVersion: 1, appId: C.APP_ID, platform: 'win32', arch: 'x64', channel: 'stable', version: '3.2.0', sequence: 30200, publishedAt: '2026-10-20T12:34:56.000Z', installer: { fileName: 'Bulten-Studio-3.2.0-Setup.exe', url: 'https://github.com/publisher/releases/releases/download/v3.2.0/Bulten-Studio-3.2.0-Setup.exe', sha256: 'ab'.repeat(32), size: 104452033 }, notes: 'Yeni şablonlar ve düzeltmeler.\nÇalışmalar korunur.', ...overrides };
}
function sign(value = payload(), key = privatePem) { return JSON.stringify(C.createEnvelope(value, key)); }
function verify(raw, options = {}) { return C.verifyEnvelope(raw, { publicKey: pin, appVersion: '3.1.0', ...options }); }
function signedUnchecked(value) {
  const raw = Buffer.from(JSON.stringify(value));
  return JSON.stringify({ schema: C.ENVELOPE_SCHEMA, keyId: pin.keyId, payload: raw.toString('base64'), signature: crypto.sign(null, raw, privatePem).toString('base64') });
}

test('real Ed25519 pin and signed UTF-8 metadata roundtrip; stable semantic versions compare numerically', () => {
  const data = verify(Buffer.from(sign()));
  assert.deepEqual(data.payload, payload()); assert.equal(data.isNewer, true);
  assert.equal(C.compareVersions('3.10.0', '3.2.0'), 1); assert.equal(C.compareVersions('3.0.0', '3.0.0'), 0); assert.equal(C.compareVersions('2.99.99', '3.0.0'), -1);
  assert.equal(C.keyIdForPublicKey(publicPem), pin.keyId); assert.equal(pin.keyId.length, 40);
  assert.deepEqual(C.normalizePublicKey(pin), pin);
  assert.deepEqual(verify(sign(), { publicKey: publicPem }).payload, payload());
  assert.equal(verify(sign(), { appVersion: '3.2.0' }).isNewer, false);
  assert.equal(verify(sign(), { appVersion: '4.0.0' }).isNewer, false);
});
test('signature and key pin reject tampering, unknown keys, mismatch and malformed encoding', () => {
  const original = JSON.parse(sign());
  for (const change of [
    value => { value.payload = Buffer.from(JSON.stringify(payload({ version: '9.0.0' }))).toString('base64'); },
    value => { value.signature = crypto.randomBytes(64).toString('base64'); },
    value => { value.signature = crypto.randomBytes(63).toString('base64'); },
    value => { value.signature += '\n'; },
    value => { value.keyId = 'ed25519:' + '0'.repeat(32); },
    value => { value.payload = '%%%%'; },
    value => { value.schema = 'foreign-envelope'; },
    value => { value.extra = true; },
    value => { delete value.signature; }
  ]) { const changed = structuredClone(original); change(changed); assert.throws(() => verify(JSON.stringify(changed))); }
  const other = crypto.generateKeyPairSync('ed25519');
  assert.throws(() => verify(sign(payload(), other.privateKey.export({ type: 'pkcs8', format: 'pem' }))));
  assert.throws(() => verify(sign(), { publicKey: { ...pin, keyId: 'ed25519:' + 'f'.repeat(32) } }));
  const rsa = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({ type: 'spki', format: 'pem' }).toString();
  assert.throws(() => C.normalizePublicKey(rsa));
  assert.throws(() => C.normalizePublicKey({ ...pin, injected: true }));
});
test('signed malformed payloads are rejected even with a valid publisher signature', () => {
  const changes = [
    value => { value.appId = 'other.app'; }, value => { value.arch = 'arm64'; }, value => { value.platform = 'linux'; }, value => { value.channel = 'beta'; },
    value => { value.schemaVersion = 2; }, value => { value.version = '3.01.0'; }, value => { value.version = '3.1.0-beta'; }, value => { value.version = '65536.0.0'; },
    value => { value.sequence = 0; }, value => { value.sequence = 3.5; }, value => { value.sequence = Number.MAX_SAFE_INTEGER + 1; },
    value => { value.publishedAt = '2026-02-31T12:34:56.000Z'; }, value => { value.publishedAt = 'not-a-date'; },
    value => { value.notes = 'a'.repeat(8001); }, value => { value.notes = 'bad\u0000notes'; },
    value => { value.installer.sha256 = 'A'.repeat(64); }, value => { value.installer.size = 0; }, value => { value.installer.size = C.MAX_INSTALLER_BYTES + 1; },
    value => { value.installer.size = '104452033'; }, value => { value.installer.url = 'http://example.test/setup.exe'; },
    value => { value.installer.fileName = '../setup.exe'; }, value => { value.installer.fileName = 'folder\\setup.exe'; }, value => { value.installer.fileName = 'CON.exe'; },
    value => { value.installer.extra = 'not allowed'; }, value => { value.surprise = true; }, value => { delete value.notes; }
  ];
  for (const change of changes) { const value = payload(); change(value); assert.throws(() => verify(signedUnchecked(value))); }
});
test('highest sequence blocks rollback while repeated current release and newer releases remain usable', () => {
  assert.equal(verify(sign(), { highestSequence: 30200 }).isNewer, true);
  assert.throws(() => verify(sign(), { highestSequence: 30201 }), /eski/);
  assert.throws(() => verify(sign(), { highestSequence: -1 }));
  assert.throws(() => verify(sign(), { highestSequence: 1.5 }));
  assert.throws(() => verify(sign(), { appVersion: 'invalid' }));
});
test('bounded HTTPS URLs reject credentials, fragments, controls and malformed schemes', () => {
  assert.equal(C.validateFeedUrl('https://example.test/updates/latest.json'), 'https://example.test/updates/latest.json');
  for (const url of ['http://example.test/a', 'file:///tmp/a', 'https://name:secret@example.test/a', 'https://user@example.test/a', 'https://example.test/a#fragment', 'https://example.test/a b', 'https://example.test/\\foo', 'https://example.test/a\n', '', null, 'https://' + 'a'.repeat(5000)]) assert.throws(() => C.validateFeedUrl(url));
});
test('untrusted envelope input cannot exceed bounded UTF-8 JSON or introduce wrong shapes', () => {
  for (const raw of [Buffer.alloc(0), Buffer.alloc(C.MAX_ENVELOPE_BYTES + 1), '{', '[]', 'null', '{}', new Uint8Array([0xff, 0xfe])]) assert.throws(() => verify(raw));
  assert.throws(() => verify({ signature: 'object-input' }));
  const raw = Buffer.from([0xff, 0xfe]);
  const envelope = { schema: C.ENVELOPE_SCHEMA, keyId: pin.keyId, payload: raw.toString('base64'), signature: crypto.sign(null, raw, privatePem).toString('base64') };
  assert.throws(() => verify(JSON.stringify(envelope)), /okunamadı/);
});
test('production key generator creates outside source tree, reuses identity and never prints secret material', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bulten-keygen-'));
  try {
    const privateFile = path.join(directory, 'secret', 'private.pem'), publicFile = path.join(directory, 'public.json');
    const run = () => JSON.parse(execFileSync(process.execPath, [path.join(__dirname, 'create-update-key.cjs'), '--private', privateFile, '--public', publicFile], { encoding: 'utf8' }));
    const first = run(), second = run();
    assert.equal(first.reusedPrivateKey, false); assert.equal(second.reusedPrivateKey, true); assert.equal(first.keyId, second.keyId);
    assert.equal(fs.statSync(privateFile).mode & 0o777, 0o600); assert.equal(first.privateKeyPrinted, false); assert(!JSON.stringify(first).includes('PRIVATE KEY'));
    const privateBefore = fs.readFileSync(privateFile);
    const wrong = { ...JSON.parse(fs.readFileSync(publicFile)), keyId: 'ed25519:' + '0'.repeat(32) }; fs.writeFileSync(publicFile, JSON.stringify(wrong));
    assert.equal(spawnSync(process.execPath, [path.join(__dirname, 'create-update-key.cjs'), '--private', privateFile, '--public', publicFile]).status, 1);
    assert.deepEqual(fs.readFileSync(privateFile), privateBefore);
    fs.writeFileSync(publicFile, JSON.stringify(C.normalizePublicKey(crypto.createPublicKey(crypto.createPrivateKey(privateBefore)).export({ type: 'spki', format: 'pem' }).toString())));
    fs.unlinkSync(privateFile);
    assert.equal(spawnSync(process.execPath, [path.join(__dirname, 'create-update-key.cjs'), '--private', privateFile, '--public', publicFile]).status, 1); assert(!fs.existsSync(privateFile));
    const inSource = path.join(__dirname, '.do-not-create-private.pem');
    assert.equal(spawnSync(process.execPath, [path.join(__dirname, 'create-update-key.cjs'), '--private', inSource, '--public', publicFile]).status, 1); assert(!fs.existsSync(inSource));
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
test('release CLI signs exact installer filename, bytes and SHA256 without exposing signing key', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bulten-sign-'));
  try {
    const installer = path.join(directory, 'Bulten-Studio-3.2.0-Setup.exe'), keyFile = path.join(directory, 'private.pem'), notesFile = path.join(directory, 'notes.txt'), out = path.join(directory, 'latest.json');
    const bytes = Buffer.alloc(256); bytes.write('MZ'); bytes.writeUInt32LE(128, 0x3c); bytes.writeUInt32LE(0x4550, 128); bytes.writeUInt16LE(0x14c, 132); fs.writeFileSync(installer, bytes); fs.writeFileSync(keyFile, privatePem); fs.writeFileSync(notesFile, 'Gerçek sürüm notu.');
    const output = execFileSync(process.execPath, [path.join(__dirname, 'sign-update.cjs'), '--installer', installer, '--url', 'https://example.test/releases/installer.exe', '--version', '3.2.0', '--sequence', '30200', '--notes-file', notesFile, '--key', keyFile, '--out', out], { encoding: 'utf8' });
    assert(!output.includes('PRIVATE KEY')); const result = verify(fs.readFileSync(out));
    assert.equal(result.payload.installer.fileName, path.basename(installer)); assert.equal(result.payload.installer.size, bytes.length); assert.equal(result.payload.installer.sha256, crypto.createHash('sha256').update(bytes).digest('hex')); assert.equal(result.payload.notes, 'Gerçek sürüm notu.');
    assert.equal(JSON.parse(output).privateKeyPrinted, false);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
