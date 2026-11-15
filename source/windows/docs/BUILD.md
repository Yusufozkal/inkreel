# Karevo 3.2.3 — masaüstü derleme

Çalışma zamanı Electron 44.9.3 ve @electron/packager 20.3.0 ile sabitlenmiştir. Node.js 22.12 veya üzeri gerekir. Arayüzün çalışma zamanı npm bağımlılığı yoktur. Yerel video düzenleyici ve zaman çizelgesi `ui/clip-editor.js` ve `ui/clip-ui.js` dosyalarıyla paketlenir; FFmpeg veya dış servis çağrısı içermez.

```sh
ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci
npm run test:native
npm run build:runtime
node scripts/verify-package.cjs --nozip
python3 installer/build-installer.py
python3 installer/verify-installer.py
```

`build:runtime`, Windows 10/11 x64 için `dist/Karevo-win32-x64/Karevo.exe` ve gerekli Electron dosyalarını üretir. `--nozip` büyük ZIP arşivini oluşturmaz. ASAR yalnızca `ui`, `native` ve `package.json` içerir; derleyiciler, testler, araçlar ve belgeler çalışma zamanına girmez.

Electron 44.9.3, 21 Ekim 2026 tarihli resmi güvenlik yamasıdır; ANGLE, Chromium, PDFium, Skia ve V8 güvenlik düzeltmelerini geri taşır. Kaynak: https://github.com/electron/electron/releases/tag/v44.9.3. npm sürümü tam numara ve lockfile bütünlük değeriyle sabitlenmiştir.

Kurucu `installer/out/Karevo-3.2.3-Setup.exe` dosyasıdır. Linux'ta NSIS ve 7-Zip kurulu olmalıdır; `makensis` ve `7zz`/`7z` araçları `PATH` üzerinden bulunur. Özel konumlar `KAREVO_NSIS` ve `KAREVO_7ZIP` ile seçilebilir. Yerel olarak çıkarılmış araçlar için önceki `installer/toolchain/` yerleşimi de desteklenir. Özel NSIS kurulumu kullanılıyorsa `NSISDIR` ilgili NSIS veri klasörüne ayarlanır. Wine gerekmez. Derleyiciler ve ikili araçlar GitLab kaynaklarına dahil edilmez.

Kurucu kaynakları tam çalışma zamanından yeni bir `payload-tr-en-3.2.3` kopyası oluşturur. Yalnızca Türkçe ve en-US dışındaki Chromium `.pak` çevirileri çıkarılır. Tüm uygulama dosyaları, DLL'ler, GPU bileşenleri, fontlar ve lisanslar korunur. Güncelleme sözleşmesinin 268435456 bayt (256 MiB) kurucu sınırı doğrulama sırasında denetlenir. Google Drive arayüzünün 104857600 bayt (100 MiB) yükleme sınırına uygunluk raporda `under100MiB` ile ayrıca belirtilir; bu sınırın aşılması GitLab sürüm yüklemesini veya paket doğrulamasını engellemez. Derleyici önce küçük bir ön kontrolü uyarıları hata sayarak çalıştırır; yalnız ön kontrol için `python3 installer/build-installer.py --preflight-only` kullanılabilir. Bu seçenek uygulama yükünü paketlemez, eski çalışma zamanını kopyalamaz ve önceki kurucuları değiştirmez. Tam derleme önce çalışma zamanının sürümünü ve ASAR içindeki bütün kaynakları doğrular; ardından tek tam LZMA sıkıştırması yapar. Kurucu dosya adı ve Windows `3.2.3.0` sürüm alanları `package.json` sürümünden türetilir. Var olan aynı sürüm kurucusunun üstüne yazılmaz.

Yeni kurulum mevcut kullanıcının `%LOCALAPPDATA%\Programs\Karevo` klasörüne yapılır. Önceden kurulu sürüm varsa eski kayıt anahtarından o kurulum dizini bulunur; kullanıcı veri alanı taşınmaz. Yönetici izni istenmez. Masaüstü ve Başlat menüsü kısayolları oluşturulur. Kaldırıcı sadece manifestte bulunan program dosyalarını siler; AppData, taslaklar ve kullanıcı projeleri silinmez. 3.2.3, Bülten Studio 3.0.0, 3.1.0, 3.1.1, 3.1.2 ve 3.2.0 ile aynı iç uygulama kimliği ve kullanıcı veri alanını korur. Daha eski Netice uygulaması ayrı kurulum ve veri klasöründe kalır.

Uygulama `bulten://app` yerel kaynağından açılır. Sandbox, contextIsolation ve webSecurity açıktır; nodeIntegration kapalıdır. Arayüzün ağ istekleri, dış sayfalar, yeni pencereler ve sistem izinleri engellenir. Güncelleme indirmeleri arayüz dışında, ana Node sürecindeki sınırlı HTTPS istemcisiyle yapılır. Ön yükleme köprüsü `window.StudioDesktop` adındadır; yalnız güvenilir ana çerçeve IPC çağırabilir.

Proje kaydı `.karevo` üretir; açma penceresi önceki `.bulten`, `.netice` ve JSON projelerini de kabul eder. Proje sınırı 100 MiB'dır. PNG/JPEG çıktıları 48 MiB, 48 megapiksel ve kenar başına 16384 piksel ile sınırlıdır; toplu çıktı en fazla 24 dosyadır. MP4/WebM kaydı 80 MiB sınırı ve kapsayıcı başlığı doğrulaması kullanır. CSV/ICS/TXT metin çıktısı 10 MiB UTF-8 ile, panoya kopyalama 10000 karakterle sınırlıdır. Kayıt konumlarını sistem penceresi üzerinden kullanıcı seçer.

Normal kapanış `studio-before-close` olayını gönderir; arayüz son otomatik kaydı tamamladıktan sonra `StudioDesktop.finishClose(true)` çağırır. Kayıt başarısızsa `finishClose(false)` kapanışı iptal eder. Beş saniyede yanıt gelmezse varsayılanı düzenleyicide kalmak olan yerel onay penceresi gösterilir; veri kaybı otomatik olarak onaylanmaz. Açık yerel dosya işlemi tamamlanmadan kapanış başlatılmaz.

Doğrulama gerçek MP4/WebM örnekleriyle yerel doğrulayıcıları, sahte Electron API'si üzerinden dosya işlemlerini, PE x64 yapısını, ASAR kaynak eşleşmesini, NSIS bütünlüğünü ve çıkarılan dosyaların SHA256 eşleşmesini kapsar. Gerçek Windows kurulumu ve Windows/Android codec çalışması bu Linux ortamında test edilmedi. Kod imzalama sertifikası bulunmadığı için paket imzasızdır.

## Mağazasız güncelleme ve kurucu sözleşmesi

3.2.3, sabit Ed25519 açık anahtarıyla güncelleme duyurularını doğrular. Açık anahtar `native/update-public-key.json` içinde dağıtılır. Özel anahtar çalışma zamanı veya kaynak arşivine kesinlikle alınmaz; eski Windows özel anahtarı bu GitLab deposunda bulunmaz. Bu anahtar olmadan yeni bir sürüm mevcut güven zinciriyle imzalanamaz. Bu veri imzası Windows Authenticode yayıncı imzasından farklıdır: Windows kurucusu hâlâ imzasızdır ve SmartScreen uyarısı gösterebilir. İmzalı sürüm metadata dosyasını oluşturma komutları `docs/SIGNED-UPDATES.md` içinde açıklanır.

Kurucu güncelleme çağrısı şu üç bağımsız argümandır: `/S`, `/UPDATEPID=<uygulamanın işlem kimliği>`, `/RESTARTAPP`. İşlem kimliği yalnız pozitif, standart onluk yazılmış, işaretli 32 bit aralığındaki bir sayı olabilir; kurucunun kendi işlem kimliği kabul edilmez. Kurucu bu işlemi `OpenProcess(SYNCHRONIZE)` ve `WaitForSingleObject` ile en fazla60saniye bekler. Bekleme başarısızsa veya argüman geçersizse kurulu dosyalara dokunmadan iptal eder. Kapanmış bir işlem için Windows `ERROR_INVALID_PARAMETER` döndürürse devam eder. Programın dosyalarına geçmeden önce disk alanı da doğrulanır.

Sessiz kurulum başarıyla tamamlanınca `/RESTARTAPP`, yalnızca kendi kurulum klasöründeki `Karevo.exe` dosyasını başlatır; dışarıdan program yolu kabul edilmez. Normal kullanıcı arayüzlü kurulumda bitiş sayfasındaki başlat seçeneği korunur. Kurucunun ana işlemi bekleyip yeniden başlatması gerçek Windows üzerinde denenmedi; NSIS kaynak sözleşmesi ve uyarıları hata sayan derleme ön kontrolü doğrulanır.

Güncellemeden önce arayüz açık projeyi kaydeder ve ana süreç `.karevo` yedeği alır. Kurucu userData/IndexedDB klasörlerini değiştirmez. Yeni uygulama sürümleri de `bulten://app` kökenini, sabit kullanıcı veri yolunu ve proje şemasının taşınma kurallarını korumalıdır. Disk veya kurulum hatasında kullanıcı aynı doğrulanmış tam kurucuyu yeniden çalıştırabilir; bunun gerçek Windows kurtarma testi ayrıca yapılmalıdır.

Paket doğrulama raporu `dist/verification-3.2.3.json`, çıkarılmış kurucu doğrulama raporu `installer/out/Karevo-3.2.3-Setup.verification.json` konumundadır. Manifest, çıkarma klasörü ve kurucu raporları sürüm içerir; önceki 3.1.0, 3.1.1, 3.1.2 ve 3.2.0 kurucuları, SHA256 dosyaları ve raporları korunur. ASAR dosya listesi kaynakla birebir karşılaştırılır; kurucudan çıkarılan her uygulama dosyasının boyutu ve SHA256 özeti hem manifestle hem özgün çalışma zamanı ile doğrulanır. NSIS eklenti kaynakları dışında fazladan kurulacak dosya kabul edilmez.
