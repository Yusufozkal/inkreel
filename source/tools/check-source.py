#!/usr/bin/env python3
"""Check the source tree before publishing; print filenames, never secret values."""
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PRIVATE_NAME = re.compile(r'(?i)(?:\.(?:p12|pfx|pem|key|jks|keystore|karevokey|password)$|(?:^|/)(?:\.env[^/]*|release\.password|signing-config\.json|[^/]*parolasi[^/]*)$)')
PRIVATE_CONTENT = re.compile(rb'-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----|\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{50,}|AKIA[A-Z0-9]{16})\b')
EXCLUDED = {'node_modules', 'dist', 'build', 'build-check', 'out', 'toolchain', '__pycache__'}

def main():
    tracked = subprocess.check_output(['git', '-C', str(ROOT), 'ls-files', '-z', '--cached', '--others', '--exclude-standard']).split(b'\0')
    failures = []
    checked = 0
    for raw in tracked:
        if not raw:
            continue
        name = raw.decode('utf-8')
        path = ROOT / name
        if any(part in EXCLUDED for part in Path(name).parts):
            failures.append(name + ' (generated dependency or output)')
            continue
        if path.is_symlink() or not path.is_file():
            failures.append(name + ' (unexpected file type)')
            continue
        if PRIVATE_NAME.search(name) or PRIVATE_CONTENT.search(path.read_bytes()):
            failures.append(name + ' (private material pattern)')
        if re.search(rb'https?://drive[.]google[.]com/', path.read_bytes()):
            failures.append(name + ' (personal Drive link)')
        checked += 1
    if failures:
        raise SystemExit('Source check failed:\n' + '\n'.join(failures))
    print('Source publication check passed: ' + str(checked) + ' files.')

if __name__ == '__main__':
    main()
