# Inkreel kaynak kodu

Windows 3.3.0 ve Android 3.3.0 uygulamalarının kaynakları, tasarım varlıkları, testleri ve derleme araçları bu klasördedir. İndirme ve güncelleme adresleri aynı depoda korunur; derlenmiş uygulamalar [Releases](https://gitlab.com/Turkish_Vito/inkreel/-/releases/karevo-v3.2.3-preview) bölümündedir.

| Klasör | İçerik |
| --- | --- |
| [windows](windows/) | Electron uygulaması, yerel dosya köprüsü, güncelleyici, NSIS kurucusu ve testler |
| [android](android/) | Android Java uygulaması, WebView köprüsü, web arayüzü, APK derleme ve doğrulama araçları |
| [branding](branding/) | Inkreel'in PNG ve SVG simgeleri |
| [release-tools](release-tools/) | Sürüm notu şablonu; yayımlama `windows/scripts/prepare-release.cjs` ile yapılır |
| [tools](tools/) | Kaynak yayınlama güvenlik kontrolü |

## Windows

Node.js 22.12 veya üzeri, npm ve Python 3 gerekir. Komutlar depo kökünden çalıştırılır:

```sh
cd source/windows
npm ci
npm start
```

Testler:

```sh
npm run test:native
npm --prefix qa ci
npm --prefix qa test
```

Windows çalışma zamanı ve kurucu:

```sh
npm run build:runtime
node scripts/verify-package.cjs --nozip
python3 installer/build-installer.py
python3 installer/verify-installer.py
```

Kurucu araçları Linux için NSIS ve 7-Zip'tir. Sistem araçları `PATH` üzerinden bulunur; özel konumlar için `KAREVO_NSIS` ve `KAREVO_7ZIP` değişkenlerini kullanabilirsin. Depoya derleyici veya Electron ikili dosyası eklenmez. Ayrıntılar: [Windows derleme](windows/docs/BUILD.md).

Tarayıcı sürümünü üretmek için:

```sh
node scripts/package-browser.cjs
node qa/single-html-check.cjs dist/Inkreel.html
```

## Android

Linux, Python 3, JDK 21, Android SDK platform 35 ve build-tools 35.0.0 gerekir. Android Studio veya Gradle zorunlu değildir.

```sh
cd source/android
export JAVA_HOME=/path/to/jdk
export ANDROID_HOME=/path/to/android-sdk
bash build-apk.sh --compile-only
npm --prefix qa ci
npm --prefix qa test
```

`--compile-only` kaynakları, kaynak dosyalarını ve DEX'i derler; dağıtılabilir imzalı APK üretmez. İmzalı APK için Inkreel 3.3.0 için yeni oluşturulan anahtar gerekir (eski Karevo anahtarı kayıptır): `./build-apk.sh --create-signing` anahtarı bir kez oluşturur, `KAREVO_SIGNING_DIR` ile depo dışındaki özel bir klasör seçilebilir. Sonraki derlemeler farklı sertifikayı reddeder. Ayrıntılar: [Android derleme ve imza yedeği](android/BUILD.md).

## Güncelleme ve veri uyumluluğu

`publisher/` ve imzalı Windows güncelleme dosyaları depo kökünde kalır. Kaynak kodu eklemek bu dosyaları, sürüm varlıklarını veya `releases/latest/download/latest.json` adresini değiştirmez. Inkreel Windows 3.3.0 ve Android 3.3.0 elle kurulur; Android'de Karevo uygulamasının yanında yeni bir uygulama olarak kurulur (eski imza anahtarı kayıp). Projeleri Karevo içinde kaydedip Inkreel içinde açın.

Windows'un eski kullanıcı veri yolu, yerel protokolü, proje şeması ve güncelleme açık anahtarı korunur. Android kimliği `com.inkreel.studio` olup önceki uygulamadan ayrı kurulur. Yeni kayıtlar `.inkreel`; önceki `.karevo`, `.bulten` ve `.netice` projeleri açılabilir.

## Depoda tutulanlar

Kaynaklar doğrulanmış son kaynak arşivlerinden alınmıştır. Uygulamanın çalışma zamanı kaynakları ve mevcut açık doğrulama anahtarları korunmuştur. Bağımlılık kilit dosyaları ve fontların OFL lisansları eklenmiştir. `package.json` içindeki `UNLICENSED` bilgisi korunur; ayrıca bir açık kaynak lisansı seçilmemiştir.

İmza özel anahtarları, keystore dosyaları, parolalar, şifreli imza yedekleri, kişisel proje dosyaları ve kullanıcıya özel Drive bağlantıları bu kaynaklara dahil değildir. Bağımlılıklar ve üretilen dosyalar derleme sırasında oluşturulur. Kaynak dosyaları yayımlamadan önce `python3 source/tools/check-source.py` ile kontrol edebilirsin.

CI kaynak ve işlev testlerini çalıştırır; Android'i anahtarsız derler. Bu kontroller gerçek Windows/Android cihazında kurulum, galeri veya video kodlayıcı testi yerine geçmez.
