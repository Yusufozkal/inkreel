#!/usr/bin/env python3
"""Build an unsigned, per-user NSIS installer without changing runtime files."""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile

root = Path(__file__).resolve().parent
project = root.parent
package = json.loads((project / 'package.json').read_text(encoding='utf-8'))
version = package['version']
assert re.fullmatch(r'\d+\.\d+\.\d+', version), 'Expected an exact stable application version'
assert all(int(part) <= 65535 for part in version.split('.')), 'NSIS version component is too large'
payload = root / ('payload-tr-en-' + version)
original = project / 'dist' / 'Karevo-win32-x64'
local_compiler = root / 'toolchain' / 'root' / 'usr' / 'bin' / 'makensis'
compiler = os.environ.get('KAREVO_NSIS') or (str(local_compiler) if local_compiler.is_file() else shutil.which('makensis'))
assert compiler, 'Install NSIS or set KAREVO_NSIS to the makensis executable'
output = root / 'out' / ('Karevo-' + version + '-Setup.exe')
report = output.with_suffix('.verification.json')
manifest_path = root / ('payload-manifest-' + version + '.json')
uninstall_include = root / ('payload-uninstall-' + version + '.nsh')
output.parent.mkdir(parents=True, exist_ok=True)
env = os.environ.copy()
if Path(compiler).resolve() == local_compiler.resolve() and 'NSISDIR' not in env:
    env['NSISDIR'] = str(root / 'toolchain' / 'root' / 'usr' / 'share' / 'nsis')


def compile_command(destination, include, installed_kb):
    return [str(compiler), '-WX', '-V3', '-INPUTCHARSET', 'UTF8',
            '-DAPP_SOURCE=' + str(payload), '-DOUT_FILE=' + str(destination),
            '-DAPP_VERSION=' + version, '-DAPP_VERSION_NUMERIC=' + version + '.0',
            '-DUNINSTALL_INCLUDE=' + str(include),
            '-DICON_PATH=' + str(project / 'native' / 'icon.ico'),
            '-DINSTALLED_KB=' + str(installed_kb), str(root / 'install.nsi')]


def preflight(include=None, installed_kb=512 * 1024):
    # CHECK_ONLY omits the application payload. A standalone preflight never
    # repackages stale runtimes or overwrites historical payloads and reports.
    with tempfile.TemporaryDirectory(prefix='nsis-preflight-', dir=output.parent) as temporary:
        temporary = Path(temporary)
        if include is None:
            include = temporary / 'payload-uninstall.nsh'
            include.write_text('; Compile-only preflight: no payload.\n', encoding='utf-8')
        command = compile_command(temporary / 'preflight.exe', include, installed_kb)
        command.insert(1, '-DCHECK_ONLY')
        subprocess.run(command, cwd=root, env=env, check=True)


if '--preflight-only' in sys.argv:
    preflight()
    print(json.dumps({'preflightOnly': True, 'version': version,
                      'installerProductVersion': version + '.0', 'payloadBuilt': False}))
    raise SystemExit(0)

assert (original / 'Karevo.exe').is_file(), 'Build the Windows runtime first.'
assert (original / 'resources' / 'app.asar').is_file(), 'The app.asar runtime is missing.'
# Reject stale runtimes and modified source before touching any installer output.
subprocess.run(['node', str(project / 'scripts' / 'verify-package.cjs'), str(original), '--nozip'],
               cwd=project, check=True)
max_installer_bytes = json.loads(subprocess.check_output(
    ['node', '-e', 'process.stdout.write(JSON.stringify(require("./native/update-contract.cjs").MAX_INSTALLER_BYTES))'],
    cwd=project, text=True))
assert max_installer_bytes == 256 * 1024 * 1024, 'Review changes to the updater size contract'
assert not output.exists(), 'Existing versioned installer must be preserved; choose a new version.'
if payload.exists():
    shutil.rmtree(payload)


def copy_file(source, destination):
    try:
        os.link(source, destination)
    except OSError:
        shutil.copy2(source, destination)


shutil.copytree(original, payload, copy_function=copy_file)
removed = []
for item in (payload / 'locales').iterdir():
    if item.is_file() and item.suffix == '.pak' and item.name not in ('tr.pak', 'en-US.pak'):
        removed.append({'path': 'locales/' + item.name, 'bytes': item.stat().st_size})
        item.unlink()
(root / ('removed-locales-' + version + '.json')).write_text(json.dumps(removed, indent=2) + '\n', encoding='utf-8')

entries = []
for item in sorted(payload.rglob('*')):
    if item.is_file():
        relative = item.relative_to(payload).as_posix()
        assert all(part not in ('.', '..') for part in Path(relative).parts)
        entries.append({'path': relative, 'bytes': item.stat().st_size,
                        'sha256': hashlib.file_digest(item.open('rb'), 'sha256').hexdigest()})
assert entries and any(item['path'] == 'resources/app.asar' for item in entries)
assert any(item['path'] == 'Karevo.exe' for item in entries)

# Delete only the exact shipped files; never recursively remove user folders.
lines = ['; Generated from the verified portable payload. No recursive deletion.']
for item in entries:
    filename = item['path'].replace('/', '\\').replace('$', '$$').replace('"', '$\\"')
    lines.append('Delete "$INSTDIR\\' + filename + '"')
directories = sorted({parent.as_posix() for item in entries
                      for parent in Path(item['path']).parents if parent.as_posix() != '.'},
                     key=lambda item: (item.count('/'), item), reverse=True)
for directory in directories:
    lines.append('RMDir "$INSTDIR\\' + directory.replace('/', '\\') + '"')
uninstall_include.write_text('\n'.join(lines) + '\n', encoding='utf-8')
manifest_path.write_text(json.dumps(entries, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
payload_bytes = sum(item['bytes'] for item in entries)
preflight(uninstall_include, payload_bytes // 1024)
# This is the only full payload compression pass.
subprocess.run(compile_command(output, uninstall_include, payload_bytes // 1024), cwd=root, env=env, check=True)
size = output.stat().st_size
assert 0 < size <= max_installer_bytes, 'Installer exceeds the 256 MiB updater limit'
digest = hashlib.file_digest(output.open('rb'), 'sha256').hexdigest()
output.with_suffix('.exe.sha256').write_text(digest + '  ' + output.name + '\n', encoding='utf-8')
result = {'file': str(output), 'version': version, 'installerProductVersion': version + '.0',
          'electronVersion': package['devDependencies']['electron'], 'bytes': size, 'sha256': digest,
          'payloadFiles': len(entries), 'payloadBytes': payload_bytes,
          'under100MiB': size < 100 * 1024 * 1024, 'driveUploadLimitBytes': 100 * 1024 * 1024,
          'updaterLimitBytes': max_installer_bytes, 'withinUpdaterLimit': True,
          'payloadLanguagesRemoved': True, 'runtimeLocales': ['tr', 'en-US'],
          'signed': False, 'windowsRuntimeTested': False, 'extractedPayloadVerified': False}
report.write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
print(json.dumps(result, indent=2))
