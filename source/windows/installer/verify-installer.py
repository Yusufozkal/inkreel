#!/usr/bin/env python3
"""Inspect and extract the NSIS package without executing any Windows code."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import struct
import subprocess

root = Path(__file__).resolve().parent
project = root.parent
package = json.loads((project / 'package.json').read_text(encoding='utf-8'))
version = package['version']
output = root / 'out' / ('Inkreel-' + version + '-Setup.exe')
local_archive_tool = root / 'toolchain' / '7zip' / 'usr' / 'lib' / '7zip' / '7z'
archive_tool = os.environ.get('KAREVO_7ZIP') or (str(local_archive_tool) if local_archive_tool.is_file() else shutil.which('7zz') or shutil.which('7z'))
assert archive_tool, 'Install 7-Zip or set KAREVO_7ZIP to its executable'
payload = root / ('payload-tr-en-' + version)
original = project / 'dist' / 'Inkreel-win32-x64'
manifest = json.loads((root / ('payload-manifest-' + version + '.json')).read_text(encoding='utf-8'))
max_installer_bytes = json.loads(subprocess.check_output(
    ['node', '-e', 'process.stdout.write(JSON.stringify(require("./native/update-contract.cjs").MAX_INSTALLER_BYTES))'],
    cwd=project, text=True))
assert max_installer_bytes == 256 * 1024 * 1024, 'Review changes to the updater size contract'
size = output.stat().st_size
assert 0 < size <= max_installer_bytes, 'Installer exceeds the 256 MiB updater limit'
subprocess.run(['node', str(project / 'scripts' / 'verify-package.cjs'), str(original), '--nozip'],
               cwd=project, check=True)

with output.open('rb') as file:
    head = file.read(1024 * 1024)
assert head[:2] == b'MZ'
pe = struct.unpack_from('<I', head, 0x3c)[0]
assert head[pe:pe + 4] == b'PE\x00\x00'
machine = struct.unpack_from('<H', head, pe + 4)[0]
assert machine == 0x14c, 'NSIS bootstrap should be a32-bit PE that installs the64-bit runtime'
optional = pe + 24
assert struct.unpack_from('<H', head, optional)[0] == 0x10b
assert struct.unpack_from('<H', head, optional + 68)[0] == 2
certificate_bytes = struct.unpack_from('<I', head, optional + 132)[0]
assert certificate_bytes == 0, 'Expected an unsigned NSIS package'
assert b'asInvoker' in head, 'Installer must run as the current user'
fixed_version = head.find(b'\xbd\x04\xef\xfe')
assert fixed_version >= 0, 'Missing Windows version information'
file_ms, file_ls, product_ms, product_ls = struct.unpack_from('<IIII', head, fixed_version + 8)
expected_version = tuple(int(part) for part in version.split('.')) + (0,)
assert (file_ms >> 16, file_ms & 0xffff, file_ls >> 16, file_ls & 0xffff) == expected_version
assert (product_ms >> 16, product_ms & 0xffff, product_ls >> 16, product_ls & 0xffff) == expected_version

subprocess.run([str(archive_tool), 't', str(output), '-bb0'], check=True)
extracted = root / ('extracted-' + version)
if extracted.exists():
    shutil.rmtree(extracted)
subprocess.run([str(archive_tool), 'x', str(output), '-o' + str(extracted), '-y', '-bb0'], check=True)
all_files = [item for item in extracted.rglob('*') if item.is_file()]
matched = []
matched_extracted = set()
for entry in manifest:
    source = payload / entry['path']
    assert source.stat().st_size == entry['bytes']
    assert hashlib.file_digest(source.open('rb'), 'sha256').hexdigest() == entry['sha256'], 'Source payload changed after the build'
    original_file = original / entry['path']
    assert original_file.stat().st_size == entry['bytes']
    assert hashlib.file_digest(original_file.open('rb'), 'sha256').hexdigest() == entry['sha256'], 'Installer changed an original program file'
    candidates = [item for item in all_files
                  if item.relative_to(extracted).as_posix() == entry['path']]
    assert candidates, 'Missing installed file: ' + entry['path']
    exact = [item for item in candidates
             if item.stat().st_size == entry['bytes']
             and hashlib.file_digest(item.open('rb'), 'sha256').hexdigest() == entry['sha256']]
    assert len(exact) == 1, 'Packaged payload mismatch: ' + entry['path']
    matched.append(entry['path'])
    matched_extracted.add(exact[0])
# install.nsi writes exactly one uninstaller (WriteUninstaller "$INSTDIR\\Uninstall.exe").
# Depending on the NSIS/7-Zip versions, 7-Zip may list it as an extracted file; accept only that
# exact root path, and only if it is a Windows executable.
def expected_uninstaller(item):
    if item.relative_to(extracted).as_posix() != 'Uninstall.exe':
        return False
    with item.open('rb') as handle:
        return handle.read(2) == b'MZ'
assert all(item in matched_extracted or item.relative_to(extracted).as_posix().startswith('$PLUGINSDIR/')
           or expected_uninstaller(item)
           for item in all_files), 'Installer contains unexpected installed files'

installed_paths = {entry['path'] for entry in manifest}
original_paths = {item.relative_to(original).as_posix() for item in original.rglob('*') if item.is_file()}
removed_paths = original_paths - installed_paths
assert removed_paths and all(item.startswith('locales/') and item.endswith('.pak') for item in removed_paths)
assert 'locales/tr.pak' in installed_paths and 'locales/en-US.pak' in installed_paths
assert installed_paths <= original_paths

script = (root / 'install.nsi').read_text(encoding='utf-8')
deletes = (root / ('payload-uninstall-' + version + '.nsh')).read_text(encoding='utf-8')
assert 'RequestExecutionLevel user' in script
assert 'SetShellVarContext current' in script
assert 'HKLM' not in script
assert 'RMDir /r' not in script and 'RMDir /r' not in deletes
assert '$APPDATA' not in deletes and '$LOCALAPPDATA' not in deletes
assert '$DESKTOP' in script and '$SMPROGRAMS' in script
assert '${RunningX64}' in script and '${AtLeastWin10}' in script
assert '/UPDATEPID=' in script and '/RESTARTAPP' in script
assert 'kernel32::OpenProcess' in script and 'kernel32::WaitForSingleObject(p r0, i 60000)' in script
assert 'kernel32::CloseHandle' in script
assert 'Call WaitForUpdateParent' in script and 'Call CheckInstallSpace' in script
assert script.index('Call WaitForUpdateParent') < script.index('Section "Inkreel"')
assert script.index('Call CheckInstallSpace') < script.index('Delete "$INSTDIR\\Inkreel.exe"')
assert 'Exec \'"$INSTDIR\\Inkreel.exe"\'' in script
assert '${If} ${Silent}' in script and '$RestartAfterUpdate == 1' in script
assert 'InstallDir "$LOCALAPPDATA\\Programs\\Inkreel"' in script
assert 'InstallDirRegKey HKCU "Software\\BultenStudio" "InstallDir"' in script
install_section = script[script.index('Section "Inkreel" SEC_APP'):script.index('SectionEnd', script.index('Section "Inkreel" SEC_APP'))]
assert install_section.index('Call CheckInstalledAppsClosed') < install_section.index('Delete "$INSTDIR\\Inkreel.exe"')
assert install_section.index('Call CheckInstalledAppsClosed') < install_section.index('Delete "$INSTDIR\\Bulten Studio.exe"')
assert 'i 0x40010000, i 0, p 0, i 3' in script, 'Both old/new executable checks must use non-truncating OPEN_EXISTING with exclusive write/delete access'
assert 'Call un.CheckInstalledAppsClosed' in script
for legacy in ('Karevo.exe', 'Bulten Studio.exe'):
    assert 'StrCpy $0 "$INSTDIR\\' + legacy + '"' in script, 'Old executable must be checked for locks: ' + legacy
    assert install_section.index('Delete "$INSTDIR\\' + legacy + '"') < install_section.index('File /r'), 'Old executable must be removed before install: ' + legacy
assert install_section.index('Delete "$DESKTOP\\Karevo.lnk"') < install_section.index('CreateShortCut "$DESKTOP\\Inkreel.lnk"')
assert 'RMDir "$SMPROGRAMS\\Karevo"' in install_section and 'CreateShortCut "$SMPROGRAMS\\Inkreel\\Inkreel.lnk" "$INSTDIR\\Inkreel.exe"' in install_section
assert '"DisplayIcon" \'"$INSTDIR\\Inkreel.exe",0\'' in install_section
uninstall_section = script[script.index('Section "Uninstall"'):]
for item in ('Inkreel.exe', 'Karevo.exe', 'Bulten Studio.exe'):
    assert 'Delete "$INSTDIR\\' + item + '"' in uninstall_section
assert 'Inkreel.exe' in installed_paths and 'Bulten Studio.exe' not in installed_paths


digest = hashlib.file_digest(output.open('rb'), 'sha256').hexdigest()
expected = (output.with_suffix('.exe.sha256')).read_text().split()[0]
assert digest == expected
result = {'file': str(output), 'version': version, 'installerProductVersion': version + '.0',
          'electronVersion': package['devDependencies']['electron'], 'bytes': size, 'sha256': digest,
          'under100MiB': size < 100 * 1024 * 1024, 'driveUploadLimitBytes': 100 * 1024 * 1024,
          'updaterLimitBytes': max_installer_bytes, 'withinUpdaterLimit': True,
          'installerMachine': 'x86 bootstrap', 'applicationMachine': 'Windows x64',
          'payloadFilesVerified': len(matched), 'payloadBytes': sum(item['bytes'] for item in manifest),
          'extractedPayloadVerified': True, 'exactInstalledFileInventory': True,
          'payloadLanguagesRemoved': True, 'runtimeLocales': ['tr', 'en-US'],
          'unusedLocaleFilesRemoved': len(removed_paths),
          'perUser': True, 'requiresAdministrator': False,
          'preservesUserData': True, 'signed': False, 'updateParentWait': 'up to60seconds, before installed file mutations', 'silentRestart': 'own installed executable only', 'windowsRuntimeTested': False}
output.with_suffix('.verification.json').write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
print(json.dumps(result, indent=2))
