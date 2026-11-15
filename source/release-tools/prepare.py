#!/usr/bin/env python3
"""Prepare only the public Karevo EXE + APK, without network requests or signing."""
import argparse, base64, hashlib, json, zipfile
from pathlib import Path

p = argparse.ArgumentParser()
p.add_argument('installer', type=Path)
p.add_argument('android_apk', type=Path)
p.add_argument('release_id', type=int)
p.add_argument('output_dir', type=Path)
a = p.parse_args()
if a.release_id <= 0: p.error('release_id must be positive')
targets = [(a.installer, 'Karevo-3.2.3-Setup.exe', 256*1024*1024),
           (a.android_apk, 'Karevo-3.1.3-Android.apk', 64*1024*1024)]
for source, name, maximum in targets:
    if source.name != name or not source.is_file() or not 0 < source.stat().st_size <= maximum:
        p.error('Only the expected public Windows installer and Android APK may be prepared')
with a.installer.open('rb') as f:
    if f.read(2) != b'MZ': p.error('The Windows installer is not a PE executable')
try:
    with zipfile.ZipFile(a.android_apk) as z:
        if not {'AndroidManifest.xml', 'classes.dex'}.issubset(z.namelist()): p.error('The Android file is not a compiled APK')
except zipfile.BadZipFile:
    p.error('The Android file is not a valid APK archive')
a.output_dir.mkdir(parents=True, exist_ok=False, mode=0o700)
assets = []
for asset_index, (source, name, maximum) in enumerate(targets, 1):
    chunks, full = [], hashlib.sha256()
    with source.open('rb') as f:
        index = 0
        while block := f.read(8*1024*1024):
            index += 1; full.update(block)
            git_sha = hashlib.sha1(b'blob ' + str(len(block)).encode() + b'\0' + block).hexdigest()
            chunks.append({'sha': git_sha, 'bytes': len(block), 'sha256': hashlib.sha256(block).hexdigest()})
            (a.output_dir / f'asset-{asset_index:02d}-blob-{index:02d}.json').write_text(json.dumps({'content':base64.b64encode(block).decode(), 'encoding':'base64'}))
    assets.append({'fileName':name, 'bytes':source.stat().st_size, 'sha256':full.hexdigest(), 'chunks':chunks})
plan = {'schema':'karevo-preview-upload-v2', 'repository':'Yusufozkal/karevo', 'releaseId':a.release_id, 'tag':'karevo-v3.2.3-preview', 'assets':assets}
(a.output_dir/'karevo-preview-plan.json').write_text(json.dumps(plan,indent=2)+'\n')
print(json.dumps({'releaseId':a.release_id,'assets':[{k:v for k,v in item.items() if k!='chunks'} for item in assets]}))
