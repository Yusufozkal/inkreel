# Inkreel Android build

This source produces the standalone offline Android application `com.inkreel.studio`, version `3.3.0` (version code `30300`). It is a separately installed Inkreel application. It does not replace the earlier Bülten Studio/Netice applications or their private data. Export a project from the old application and open it in Inkreel to transfer it.

Requirements: Linux, Python 3, JDK 21, Android SDK platform 35 and build tools 35.0.0. The build does not require Gradle, an Android account, or Internet access when those tools are already installed. All Java classes target Java 8/Android API 26.

```sh
KAREVO_JAVA_HOME=/path/to/jdk \
KAREVO_ANDROID_SDK=/path/to/android-sdk \
./build-apk.sh --compile-only
```

The compile check writes to `build-check/` and does not create signing keys or a signed distribution APK. Set `KAREVO_SIGNING_DIR` to the private key directory when keys are held outside this project. Once Java, web assets and resources are final, omit `--compile-only` to create `out/Inkreel-3.3.0-Android.apk`.

## Signing key (new for 3.3.0)

The old Karevo signing key is lost, so Inkreel uses a NEW key and installs as a separate application next to the old Karevo app (different package id `com.inkreel.studio`, different signature). Karevo data is not shared: export projects from Karevo and open the `.inkreel`/`.karevo` file in Inkreel.

Create the key once (RSA 3072, PKCS12, alias `inkreel-release`; files `inkreel-release.p12`, `release.password` and `certificate.sha256` are written to `signing/` or `KAREVO_SIGNING_DIR`):

```sh
KAREVO_JAVA_HOME=/path/to/jdk ./build-apk.sh --create-signing
```

The equivalent manual command is `keytool -genkeypair -keyalg RSA -keysize 3072 -storetype PKCS12 -alias inkreel-release -dname "CN=Inkreel, O=Inkreel" -validity 10950 -keystore inkreel-release.p12`. The release build never generates a key by itself and signs with APK Signature Scheme v2 and v3. Preserve the key and password securely: all future Inkreel updates must be signed with the same key. Signing keys and passwords must never be included in a downloadable source archive. This is a self-signed, installable APK; it is not a Google Play release.

No certificate is hard-coded. `certificate.sha256` (or `INKREEL_CERT_SHA256`) pins the public fingerprint: the first release build writes it if missing, and later builds with a different key refuse to sign.

`qa/verify-apk.py` checks the signed artifact's manifest and SDK metadata, absence of permissions, ZIP CRCs, exact web asset bytes, DEX checksums and class identities, compiled resources, provider export settings, v2/v3 signatures and 16 KiB ZIP alignment. When `INKREEL_CERT_SHA256` is set (build-apk.sh sets it from `certificate.sha256`), a build signed with a different key fails verification. It writes `out/apk-verification.json` and a SHA-256 sidecar. There are no CPU-specific `.so` libraries.

```sh
python3 qa/verify-apk.py out/Inkreel-3.3.0-Android.apk \
  --sdk /path/to/android-sdk --java-home /path/to/jdk \
  --report out/apk-verification.json
```

These checks establish package integrity and compile correctness. They do not establish successful installation, appearance or video codec behavior on a physical Android device. Android 8.0 (API 26) or newer and an up-to-date Android System WebView are needed. Animation and imported-clip exports depend on the device's WebView, canvas capture, MediaRecorder and audio codecs. Input video files are read from user-selected SAF documents; no Android permissions or remote media URLs are used.

For a source archive, exclude `signing/`, `build/`, `build-check/`, `out/`, `node_modules/`, `qa/node_modules/` and Python `__pycache__/` directories.

## Private signing backup

Keep an offline copy of the `signing/` directory in a private location, separate from the source. `tools/restore-signing.py` restores an encrypted `.inkreelkey` backup (scrypt N=131072, r=8, p=1, AES-256-GCM, containing `inkreel-release.p12`, `release.password` and `signing-config.json`) into a new empty directory:

```sh
python3 tools/restore-signing.py /private/Inkreel-Android-Imza-Yedegi.inkreelkey --output /private/inkreel-signing
KAREVO_SIGNING_DIR=/private/inkreel-signing ./build-apk.sh
```

The restore command prompts privately for the backup password. Do not put the password in command arguments, chat, or source control.
