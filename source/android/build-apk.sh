#!/usr/bin/env bash
set -euo pipefail
umask 077

project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
export JAVA_HOME="${KAREVO_JAVA_HOME:-${BULTEN_JAVA_HOME:-${JAVA_HOME:-}}}"
android_sdk="${KAREVO_ANDROID_SDK:-${BULTEN_ANDROID_SDK:-${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}}}"
[[ -n "$JAVA_HOME" ]] || { printf 'JDK konumu için JAVA_HOME veya KAREVO_JAVA_HOME ayarlayın.\n' >&2; exit 1; }
signing_dir="${KAREVO_SIGNING_DIR:-$project_dir/signing}"

# --create-signing: generate the Inkreel 3.3.0 release key (PKCS12, RSA 3072) once.
# The old Karevo key is lost, so Inkreel is signed with this NEW key and installs
# as a separate app beside Karevo. Back up the signing directory privately.
if [[ "${1:-}" == "--create-signing" ]]; then
    [[ -x "$JAVA_HOME/bin/keytool" ]] || { printf 'keytool bulunamadı: JAVA_HOME ayarlayın.\n' >&2; exit 1; }
    if [[ -e "$signing_dir/inkreel-release.p12" || -e "$signing_dir/release.password" ]]; then
        printf 'İmza anahtarı zaten var: %s (üzerine yazılmaz).\n' "$signing_dir" >&2; exit 1
    fi
    mkdir -p "$signing_dir"; chmod 700 "$signing_dir"
    head -c 36 /dev/urandom | base64 | tr -d '\n=+/' | head -c 40 > "$signing_dir/release.password"
    chmod 600 "$signing_dir/release.password"
    "$JAVA_HOME/bin/keytool" -genkeypair -keyalg RSA -keysize 3072 -sigalg SHA256withRSA -validity 10950 \
        -storetype PKCS12 -alias inkreel-release -dname "CN=Inkreel, O=Inkreel" \
        -keystore "$signing_dir/inkreel-release.p12" \
        -storepass:file "$signing_dir/release.password" -keypass:file "$signing_dir/release.password"
    chmod 600 "$signing_dir/inkreel-release.p12"
    "$JAVA_HOME/bin/keytool" -exportcert -keystore "$signing_dir/inkreel-release.p12" -alias inkreel-release \
        -storepass:file "$signing_dir/release.password" | python3 -c \
        'import hashlib,sys; print(hashlib.sha256(sys.stdin.buffer.read()).hexdigest())' > "$signing_dir/certificate.sha256"
    printf 'İmza anahtarı oluşturuldu: %s\nSHA-256: %s\nBu klasörü depo dışında ve özel yedekte tutun.\n' "$signing_dir" "$(cat "$signing_dir/certificate.sha256")"
    exit 0
fi

[[ -n "$android_sdk" ]] || { printf 'Android SDK konumu için ANDROID_HOME veya KAREVO_ANDROID_SDK ayarlayın.\n' >&2; exit 1; }
android_build_tools="$android_sdk/build-tools/35.0.0"
android_jar="$android_sdk/platforms/android-35/android.jar"
build_dir="$project_dir/build"
out_dir="$project_dir/out"
apk_name="Inkreel-3.3.0-Android.apk"
compile_only=false

case "${1:-}" in
    "") ;;
    --compile-only) compile_only=true; build_dir="$project_dir/build-check" ;;
    *) printf 'Kullanım: %s [--compile-only|--create-signing]\n' "$0" >&2; exit 2 ;;
esac

for executable in "$JAVA_HOME/bin/javac" "$JAVA_HOME/bin/keytool" "$android_build_tools/aapt2" \
    "$android_build_tools/d8" "$android_build_tools/zipalign" "$android_build_tools/apksigner"; do
    if [[ ! -x "$executable" ]]; then printf 'Eksik derleme aracı: %s\n' "$executable" >&2; exit 1; fi
done
[[ -f "$android_jar" ]] || { printf 'Android 35 platformu bulunamadı.\n' >&2; exit 1; }
[[ -f "$project_dir/www/index.html" ]] || { printf 'www/index.html hazır değil.\n' >&2; exit 1; }

# This is the separate Inkreel application; never overwrite the earlier Android package.
python3 - "$project_dir/native/AndroidManifest.xml" <<'PY'
import sys
from xml.etree import ElementTree as ET
manifest = ET.parse(sys.argv[1]).getroot()
android = '{http://schemas.android.com/apk/res/android}'
assert manifest.get('package') == 'com.inkreel.studio', 'Unexpected application package'
assert manifest.get(android + 'versionName') == '3.3.0', 'Unexpected version name'
assert manifest.get(android + 'versionCode') == '30300', 'Unexpected version code'
sdk = manifest.find('uses-sdk')
assert sdk is not None and sdk.get(android + 'minSdkVersion') == '26'
assert sdk.get(android + 'targetSdkVersion') == '35'
assert not manifest.findall('uses-permission'), 'This offline app does not need Android permissions'
PY

mkdir -p "$build_dir"
rm -rf -- "$build_dir/classes" "$build_dir/dex" "$build_dir/generated"
mkdir -p "$build_dir/classes" "$build_dir/dex" "$build_dir/generated"
rm -f -- "$build_dir/resources.zip" "$build_dir/unsigned.apk" "$build_dir/aligned.apk"

"$android_build_tools/aapt2" compile --dir "$project_dir/native/res" -o "$build_dir/resources.zip"
"$android_build_tools/aapt2" link -I "$android_jar" --manifest "$project_dir/native/AndroidManifest.xml" \
    --java "$build_dir/generated" -A "$project_dir/www" "$build_dir/resources.zip" -o "$build_dir/unsigned.apk"
find "$project_dir/native/src" "$build_dir/generated" -name '*.java' -print | LC_ALL=C sort > "$build_dir/java-sources.txt"
"$JAVA_HOME/bin/javac" --release 8 -Xlint:-options -encoding UTF-8 -classpath "$android_jar" \
    -d "$build_dir/classes" @"$build_dir/java-sources.txt"
find "$build_dir/classes" -name '*.class' -print | LC_ALL=C sort > "$build_dir/class-files.txt"
"$android_build_tools/d8" --release --lib "$android_jar" --min-api 26 --output "$build_dir/dex" \
    @"$build_dir/class-files.txt"

python3 - "$build_dir/unsigned.apk" "$build_dir/dex" <<'PY'
import sys
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED, ZipInfo
apk, dex_dir = sys.argv[1:]
dex_files = sorted(Path(dex_dir).glob('*.dex'))
assert dex_files, 'No DEX output was produced'
with ZipFile(apk, 'a') as archive:
    for dex in dex_files:
        entry = ZipInfo(dex.name, date_time=(2026, 10, 19, 0, 0, 0))
        entry.compress_type = ZIP_DEFLATED
        archive.writestr(entry, dex.read_bytes())
PY
"$android_build_tools/zipalign" -f -P 16 4 "$build_dir/unsigned.apk" "$build_dir/aligned.apk"
if [[ "$compile_only" == true ]]; then
    printf 'Java/DEX/kaynak derleme kontrolü geçti. İmzalı dağıtım paketi oluşturulmadı.\n'
    exit 0
fi

mkdir -p "$out_dir" "$signing_dir"
if [[ ! -s "$signing_dir/release.password" || ! -s "$signing_dir/inkreel-release.p12" ]]; then
    printf 'Inkreel Android imza anahtarı ve parola dosyası gerekli; güncelleme anahtarı otomatik değiştirilmez.\n' >&2
    exit 1
fi
chmod 600 "$signing_dir/release.password" "$signing_dir/inkreel-release.p12"
# The 3.3.0 key is new (the Karevo key was lost), so no certificate is hard-coded.
# If INKREEL_CERT_SHA256 or signing/certificate.sha256 is present, it must match;
# otherwise the first certificate is accepted and written to certificate.sha256 (pin on first use).
python3 - "$JAVA_HOME/bin/keytool" "$signing_dir" <<'PYKEY'
import hashlib, os, subprocess, sys
from pathlib import Path
folder = Path(sys.argv[2])
certificate = subprocess.check_output([sys.argv[1], '-exportcert', '-keystore', str(folder / 'inkreel-release.p12'), '-alias', 'inkreel-release', '-storepass:file', str(folder / 'release.password')])
digest = hashlib.sha256(certificate).hexdigest()
pin_file = folder / 'certificate.sha256'
expected = (os.environ.get('INKREEL_CERT_SHA256') or (pin_file.read_text().strip() if pin_file.is_file() else '')).lower()
if expected and digest != expected:
    raise SystemExit('Inkreel Android signing identity mismatch; refusing to sign.')
if not expected:
    pin_file.write_text(digest + '\n')
PYKEY
rm -f -- "$out_dir/$apk_name.idsig"
"$android_build_tools/apksigner" sign --ks "$signing_dir/inkreel-release.p12" \
    --ks-key-alias inkreel-release --ks-pass "file:$signing_dir/release.password" \
    --v1-signing-enabled false \
    --v2-signing-enabled true --v3-signing-enabled true --v4-signing-enabled false \
    --out "$out_dir/$apk_name" "$build_dir/aligned.apk"
"$android_build_tools/apksigner" verify --verbose --print-certs "$out_dir/$apk_name" \
    > "$out_dir/signing-certificate.txt"
"$android_build_tools/zipalign" -c -P 16 4 "$out_dir/$apk_name"
export INKREEL_CERT_SHA256="${INKREEL_CERT_SHA256:-$(cat "$signing_dir/certificate.sha256")}"
python3 "$project_dir/qa/verify-apk.py" "$out_dir/$apk_name" \
    --project "$project_dir" --sdk "$android_sdk" --java-home "$JAVA_HOME" \
    --report "$out_dir/apk-verification.json"
python3 - "$out_dir/$apk_name" <<'PY'
import hashlib, sys
from pathlib import Path
apk = Path(sys.argv[1])
(apk.parent / (apk.name + '.sha256')).write_text(hashlib.sha256(apk.read_bytes()).hexdigest() + '  ' + apk.name + '\n')
PY
chmod 644 "$out_dir/$apk_name" "$out_dir/$apk_name.sha256" "$out_dir/apk-verification.json" "$out_dir/signing-certificate.txt"
printf 'APK hazır: %s\n' "$out_dir/$apk_name"
