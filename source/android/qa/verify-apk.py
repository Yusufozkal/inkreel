#!/usr/bin/env python3
"""Verify the signed distribution APK against its packaged source tree.

This is a package/integrity check. It does not replace a device installation test.
Only the Android SDK, Java and Python's standard library are needed.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import struct
import subprocess
import sys
from xml.etree import ElementTree as ET
from zipfile import ZipFile
import zlib

ANDROID = '{http://schemas.android.com/apk/res/android}'
PACKAGE = 'com.karevo.studio'
VERSION = '3.1.3'
VERSION_CODE = '30103'
LABEL = 'Karevo'
# Public SHA-256 certificate fingerprint for the separately installed Karevo
# package baseline. This does not claim compatibility with the previous package.
RELEASE_CERTIFICATE_SHA256 = '25e15c339646e5566e6fb0799fdedc3ac4b373530bfc3d4012bd60efc52c964d'


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def run(command, env):
    result = subprocess.run([str(part) for part in command], env=env, text=True,
                            encoding='utf-8', capture_output=True, check=False)
    require(result.returncode == 0,
            'Tool failed: ' + str(command[0]) + '\n' + result.stdout + result.stderr)
    return result.stdout + result.stderr


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('apk', type=Path)
    parser.add_argument('--project', type=Path, default=Path(__file__).resolve().parent.parent)
    parser.add_argument('--sdk', type=Path,
                        default=Path(os.environ.get('KAREVO_ANDROID_SDK') or os.environ.get('BULTEN_ANDROID_SDK') or os.environ.get('ANDROID_HOME') or os.environ.get('ANDROID_SDK_ROOT') or ''))
    parser.add_argument('--java-home', type=Path,
                        default=Path(os.environ.get('KAREVO_JAVA_HOME') or os.environ.get('BULTEN_JAVA_HOME') or os.environ.get('JAVA_HOME') or ''))
    parser.add_argument('--report', type=Path)
    args = parser.parse_args()
    project = args.project.resolve()
    apk = args.apk.resolve()
    build_tools = args.sdk / 'build-tools/35.0.0'
    env = dict(os.environ, JAVA_HOME=str(args.java_home))
    env['PATH'] = str(args.java_home / 'bin') + os.pathsep + env.get('PATH', '')
    report = {'apk': apk.name, 'package': PACKAGE, 'version': VERSION,
              'versionCode': int(VERSION_CODE), 'minSdk': 26, 'targetSdk': 35,
              'checks': {}, 'runtimeTested': False,
              'runtimeLimitation': 'No physical Android device or emulator was available.'}

    require(apk.is_file(), 'APK file not found')
    apk_bytes = apk.read_bytes()
    require(0 < len(apk_bytes) < 32 * 1024 * 1024, 'APK must be smaller than 32 MiB')
    report.update(bytes=len(apk_bytes), sha256=hashlib.sha256(apk_bytes).hexdigest())

    manifest = ET.parse(project / 'native/AndroidManifest.xml').getroot()
    require(manifest.get('package') == PACKAGE, 'Source package mismatch')
    require(manifest.get(ANDROID + 'versionName') == VERSION, 'Source version name mismatch')
    require(manifest.get(ANDROID + 'versionCode') == VERSION_CODE, 'Source version code mismatch')
    require(not manifest.findall('uses-permission'), 'Source declares unexpected permissions')
    sdk = manifest.find('uses-sdk')
    require(sdk is not None and sdk.get(ANDROID + 'minSdkVersion') == '26', 'Wrong source minSdk')
    require(sdk.get(ANDROID + 'targetSdkVersion') == '35', 'Wrong source targetSdk')
    application = manifest.find('application')
    require(application is not None and application.get(ANDROID + 'label') == LABEL, 'Wrong source label')
    for attribute in ('allowBackup', 'usesCleartextTraffic'):
        require(application.get(ANDROID + attribute) == 'false', attribute + ' must be false')
    require(application.get(ANDROID + 'debuggable', 'false') == 'false', 'Debuggable release')
    provider = application.find('provider')
    require(provider is not None, 'Export provider missing')
    require(provider.get(ANDROID + 'authorities') == PACKAGE + '.exports', 'Wrong provider authority')
    require(provider.get(ANDROID + 'exported') == 'false', 'Provider must not be exported')
    require(provider.get(ANDROID + 'grantUriPermissions') == 'true', 'URI sharing grants missing')
    report['checks']['sourceManifest'] = True

    with ZipFile(apk) as archive:
        names = archive.namelist()
        require(len(names) == len(set(names)), 'Duplicate ZIP entry names')
        require(archive.testzip() is None, 'ZIP CRC failure')
        require(all(not name.startswith('/') and '..' not in Path(name).parts for name in names),
                'Unsafe ZIP path')
        require({'AndroidManifest.xml', 'resources.arsc', 'classes.dex'} <= set(names),
                'Compiled manifest, resources or DEX missing')
        require(not any(name.startswith('lib/') or name.endswith('.so') for name in names),
                'Unexpected architecture-specific native library')
        require(not any('release.password' in name or name.endswith(('.p12', '.jks', '.keystore'))
                        for name in names), 'Signing secret included in APK')
        report['checks']['zipCrcAndUniquePaths'] = True
        report['checks']['architectureIndependent'] = True

        web_files = sorted(path for path in (project / 'www').rglob('*') if path.is_file())
        require(web_files, 'Web source tree is empty')
        wanted_assets = {'assets/' + path.relative_to(project / 'www').as_posix() for path in web_files}
        actual_assets = {name for name in names if name.startswith('assets/') and not name.endswith('/')}
        require(wanted_assets == actual_assets,
                'APK assets differ from www files: ' + str(sorted(wanted_assets ^ actual_assets)))
        asset_hashes = {}
        for path in web_files:
            name = 'assets/' + path.relative_to(project / 'www').as_posix()
            source_data = path.read_bytes()
            require(archive.read(name) == source_data, 'Asset bytes mismatch: ' + name)
            asset_hashes[name] = hashlib.sha256(source_data).hexdigest()
        report['checks']['webAssetsByteExact'] = True
        report['assetCount'] = len(asset_hashes)
        report['assetSha256'] = asset_hashes

        dex_names = sorted(name for name in names if re.fullmatch(r'classes(?:[2-9]|[1-9][0-9]+)?\.dex', name))
        require(dex_names, 'DEX entries missing')
        dex_data = b''
        for name in dex_names:
            data = archive.read(name)
            require(len(data) >= 112 and data.startswith(b'dex\n') and data[7] == 0, 'Invalid DEX: ' + name)
            require(struct.unpack_from('<I', data, 32)[0] == len(data), 'DEX size mismatch: ' + name)
            require(struct.unpack_from('<I', data, 8)[0] == zlib.adler32(data[12:]) & 0xffffffff,
                    'DEX Adler32 mismatch: ' + name)
            require(data[12:32] == hashlib.sha1(data[32:]).digest(), 'DEX SHA1 mismatch: ' + name)
            dex_data += data
        for descriptor in (b'Lcom/karevo/studio/MainActivity;', b'Lcom/karevo/studio/ExportProvider;'):
            require(descriptor in dex_data, 'Compiled Java class missing: ' + descriptor.decode())
        require(b'Lcom/neticehaber/studio/' not in dex_data, 'Old Netice package compiled into DEX')
        require(b'Lcom/bultenstudio/app/' not in dex_data, 'Old Bulten package compiled into DEX')
        report['checks']['compiledDexChecksumsAndClasses'] = True
        report['dexCount'] = len(dex_names)
        for required_resource in ('res/mipmap-anydpi-v26/ic_launcher.xml',
                                  'res/mipmap-anydpi-v26/ic_launcher_round.xml',
                                  'res/drawable/ic_brand.xml', 'res/drawable/splash_background.xml'):
            require(required_resource in names, 'Native resource missing: ' + required_resource)
        report['checks']['nativeResourcesPresent'] = True

    badging = run([build_tools / 'aapt2', 'dump', 'badging', apk], env)
    package_line = re.search(r"^package: name='([^']*)' versionCode='([^']*)' versionName='([^']*)'", badging, re.M)
    require(package_line and package_line.groups() == (PACKAGE, VERSION_CODE, VERSION), 'Compiled manifest package/version mismatch')
    require("minSdkVersion:'26'" in badging, 'Compiled minSdk mismatch')
    require("targetSdkVersion:'35'" in badging, 'Compiled targetSdk mismatch')
    require("application-label:'" + LABEL + "'" in badging, 'Compiled app label mismatch')
    require("launchable-activity: name='" + PACKAGE + ".MainActivity'" in badging, 'Launcher activity mismatch')
    require(not re.search(r'^uses-permission(?:[-:]|$)', badging, re.M), 'Compiled app requests Android permissions')
    report['checks']['compiledIdentitySdkLabelNoPermissions'] = True

    xmltree = run([build_tools / 'aapt2', 'dump', 'xmltree', apk, '--file', 'AndroidManifest.xml'], env)
    for fragment in (':allowBackup(', ':usesCleartextTraffic('):
        require(any(fragment in line and line.rstrip().endswith('=false') for line in xmltree.splitlines()),
                'Compiled manifest missing false flag: ' + fragment)
    require(PACKAGE + '.exports' in xmltree and 'E: provider' in xmltree, 'Compiled provider identity mismatch')
    provider_tree = xmltree.split('E: provider', 1)[1]
    require(any(':exported(' in line and line.rstrip().endswith('=false')
                for line in provider_tree.splitlines()), 'Compiled provider is exported')
    require(any(':grantUriPermissions(' in line and line.rstrip().endswith('=true')
                for line in provider_tree.splitlines()), 'Compiled URI grants missing')
    require(not any(':debuggable(' in line and line.rstrip().endswith('=true')
                    for line in xmltree.splitlines()), 'Compiled release is debuggable')
    resources = run([build_tools / 'aapt2', 'dump', 'resources', apk], env)
    for symbol in ('style/AppTheme', 'drawable/ic_brand', 'mipmap/ic_launcher'):
        require(symbol in resources, 'Compiled resource symbol missing: ' + symbol)
    report['checks']['compiledProviderAndResources'] = True

    signatures = run([build_tools / 'apksigner', 'verify', '--verbose', '--print-certs', apk], env)
    for scheme in ('v2 scheme (APK Signature Scheme v2)', 'v3 scheme (APK Signature Scheme v3)'):
        require('Verified using ' + scheme + ': true' in signatures, scheme + ' signature missing')
    require('Number of signers: 1' in signatures, 'Unexpected signer count')
    require('Signer #1 key algorithm: RSA' in signatures, 'Signer must use RSA')
    require('Signer #1 key size (bits): 3072' in signatures, 'Signer must use RSA 3072')
    require('CN=Karevo' in signatures, 'Unexpected certificate subject')
    fingerprint = re.search(r'Signer #1 certificate SHA-256 digest: ([0-9a-f]+)', signatures)
    require(fingerprint is not None, 'Certificate fingerprint missing')
    report['certificateSha256'] = fingerprint.group(1)
    require(report['certificateSha256'] == RELEASE_CERTIFICATE_SHA256,
            'Signing certificate differs from the Karevo package baseline')
    report['checks']['karevoReleaseSigningCertificate'] = True
    report['checks']['apkSignatureV2V3Rsa3072'] = True
    run([build_tools / 'zipalign', '-c', '-P', '16', '4', apk], env)
    report['checks']['zipAlign16KiB'] = True
    report['allChecksPassed'] = True
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({key: report[key] for key in ('apk', 'bytes', 'sha256', 'assetCount', 'allChecksPassed')}, ensure_ascii=False))


if __name__ == '__main__':
    try:
        main()
    except (AssertionError, OSError, ET.ParseError) as error:
        print('APK verification failed: ' + str(error), file=sys.stderr)
        sys.exit(1)
