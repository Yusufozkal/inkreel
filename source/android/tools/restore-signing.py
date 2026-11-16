#!/usr/bin/env python3
"""Restore a private Inkreel signing backup locally; requires cryptography."""
import argparse
import base64
import getpass
import io
import json
from pathlib import Path
from zipfile import ZipFile
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.scrypt import Scrypt

MAGIC = b'INKREELKEY1\n'
AAD = b'Inkreel Android Signing Backup v1'
FILES = {'inkreel-release.p12', 'release.password', 'signing-config.json'}


def restore(source, password, output):
    raw = Path(source).read_bytes()
    if len(raw) > 1048576 or not raw.startswith(MAGIC):
        raise ValueError('Invalid signing backup.')
    data = json.loads(raw[len(MAGIC):])
    if data.get('format') != 'inkreel-android-signing-v1' or data.get('kdf') != 'scrypt-n131072-r8-p1':
        raise ValueError('Unsupported signing backup.')
    salt, nonce, ciphertext = [base64.b64decode(data[name], validate=True) for name in ('salt', 'nonce', 'ciphertext')]
    if len(salt) != 32 or len(nonce) != 12:
        raise ValueError('Invalid signing backup parameters.')
    key = Scrypt(salt=salt, length=32, n=131072, r=8, p=1).derive(password.encode('utf-8'))
    content = AESGCM(key).decrypt(nonce, ciphertext, AAD)
    folder = Path(output)
    if folder.exists():
        raise ValueError('Destination must not already exist.')
    with ZipFile(io.BytesIO(content)) as archive:
        entries = archive.infolist()
        if len(entries) != len(FILES) or {entry.filename for entry in entries} != FILES or any(entry.file_size > 65536 for entry in entries):
            raise ValueError('Unexpected files in signing backup.')
        files = {entry.filename: archive.read(entry) for entry in entries}
    config = json.loads(files['signing-config.json'])
    if config.get('package') != 'com.inkreel.studio' or config.get('alias') != 'inkreel-release':
        raise ValueError('Unexpected signing identity.')
    folder.mkdir(mode=0o700, parents=True)
    for name, data in files.items():
        target = folder / name
        target.write_bytes(data)
        target.chmod(0o600)
    return folder


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('backup', type=Path)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--password-file', type=Path, help='Local password file; omit to type privately.')
    args = parser.parse_args()
    try:
        password = args.password_file.read_text().strip() if args.password_file else getpass.getpass('Backup password: ')
        restore(args.backup, password, args.output)
    except Exception:
        raise SystemExit('Restore failed: check the backup/password and use a new empty destination.')
    print('Signing identity restored. Keep this directory private and outside source archives.')
