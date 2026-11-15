# Karevo Android build

This source produces the standalone offline Android application `com.karevo.studio`, version `3.1.3` (version code `30103`). It is a separately installed Karevo application. It does not replace the earlier Bülten Studio/Netice applications or their private data. Export a project from the old application and open it in Karevo to transfer it.

Requirements: Linux, Python 3, JDK 21, Android SDK platform 35 and build tools 35.0.0. The build does not require Gradle, an Android account, or Internet access when those tools are already installed. All Java classes target Java 8/Android API 26.

```sh
KAREVO_JAVA_HOME=/path/to/jdk \
KAREVO_ANDROID_SDK=/path/to/android-sdk \
./build-apk.sh --compile-only
```

The compile check writes to `build-check/` and does not create signing keys or a signed distribution APK. Set `KAREVO_SIGNING_DIR` to the private key directory when keys are held outside this project. Once Java, web assets and resources are final, omit `--compile-only` to create `out/Karevo-3.1.3-Android.apk`.

The release build requires the persistent Karevo RSA 3072-bit PKCS12 signing key at `signing/karevo-release.p12` and the adjacent `release.password`. It refuses to generate a replacement key. It signs with APK Signature Scheme v2 and v3. Preserve both files securely for future updates of this application. Signing keys and passwords must never be included in a downloadable source archive. This is a self-signed, installable APK; it is not a Google Play release.

`qa/verify-apk.py` checks the signed artifact's manifest and SDK metadata, absence of permissions, ZIP CRCs, exact web asset bytes, DEX checksums and class identities, compiled resources, provider export settings, v2/v3 signatures and 16 KiB ZIP alignment. It also pins the public SHA-256 signing-certificate fingerprint created for this separate Karevo application, so a build signed with a different key fails verification. It writes `out/apk-verification.json` and a SHA-256 sidecar. There are no CPU-specific `.so` libraries.

```sh
python3 qa/verify-apk.py out/Karevo-3.1.3-Android.apk \
  --sdk /path/to/android-sdk --java-home /path/to/jdk \
  --report out/apk-verification.json
```

These checks establish package integrity and compile correctness. They do not establish successful installation, appearance or video codec behavior on a physical Android device. Android 8.0 (API 26) or newer and an up-to-date Android System WebView are needed. Animation and imported-clip exports depend on the device's WebView, canvas capture, MediaRecorder and audio codecs. Input video files are read from user-selected SAF documents; no Android permissions or remote media URLs are used.

For a source archive, exclude `signing/`, `build/`, `build-check/`, `out/`, `node_modules/`, `qa/node_modules/` and Python `__pycache__/` directories.

## Private signing backup

The persistent Karevo key is held outside this source archive. Keep the encrypted `.karevokey` backup and its backup-password file in separate private locations. The encrypted payload contains the PKCS12 keystore, its password and alias configuration. It uses scrypt (N=131072, r=8, p=1) and authenticated AES-256-GCM.

Restore locally with Python and the `cryptography` package:

```sh
python3 tools/restore-signing.py /private/Karevo-Android-Imza-Yedegi.karevokey --output /private/karevo-signing
KAREVO_SIGNING_DIR=/private/karevo-signing ./build-apk.sh
```

The restore command prompts privately for the backup password. Do not put the password in command arguments, chat, or source control. The selected keystore must match the pinned public Karevo certificate before a release is signed.
