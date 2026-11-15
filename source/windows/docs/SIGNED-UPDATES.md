# Bülten Studio kişisel Windows güncelleme imzası

Bu altyapı, mağaza dışında dağıtılan kurulum dosyasının yayıncıya ait Ed25519 anahtarıyla onaylandığını ve indirme sonrasında değiştirilmediğini doğrular. Windows Authenticode sertifikası değildir; SmartScreen veya “bilinmeyen yayıncı” uyarısını kaldırmaz.

## Anahtar

İlk anahtar aşağıdaki komutla oluşturulur:

```sh
node scripts/create-update-key.cjs \
  --private /GUVENLI/KONUM/private-key.pem \
  --public native/update-public-key.json
```

Özel anahtar uygulama kaynak ağacının dışında, yalnız sahibinin okuyabileceği `0600` izinleriyle saklanır. Aynı komut mevcut anahtarı yeniden kullanır; kimliği değiştirmez. Özel anahtar bulunamazken mevcut genel anahtar varsa işlem durur. Anahtarın şifreli, çevrimdışı bir yedeğini korumak yayıncının sorumluluğundadır. Özel anahtar, parola veya yedek hiçbir zaman APK/EXE, kaynak ZIP, GitLab deposu veya yayın dosyaları içine eklenmemelidir.

`native/update-public-key.json`, dağıtılan uygulamanın sabit güven köküdür. İçeriği gizli değildir:

```json
{
  "schema": "bulten-update-public-key",
  "algorithm": "Ed25519",
  "keyId": "ed25519:<SPKI-DER-SHA256-ilk32hex>",
  "publicKey": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----\n"
}
```

Anahtarı değiştirmek otomatik bir yeniden üretme işi değildir. Mevcut istemciler yalnız mevcut sabit anahtarı tanır. Özel anahtar kaybolursa yayıncı eski anahtarla güncelleme imzalayamaz; güvenilir bir kanaldan yeni kurulumla güven kökü yenilenmelidir.

## Bir sürümü imzalama

Kurucu tamamlanıp doğrulandıktan sonra:

```sh
node scripts/sign-update.cjs \
  --installer installer/out/Bulten-Studio-3.1.0-Setup.exe \
  --url https://gitlab.com/Turkish_Vito/karevo/-/releases/v3.1.0/downloads/Bulten-Studio-3.1.0-Setup.exe \
  --version 3.1.0 --sequence 30100 \
  --notes-file release-notes.txt \
  --key /GUVENLI/KONUM/private-key.pem \
  --out release/latest.json
```

Örnekteki sürüm ve dosya adı yer tutucudur; gerçek yayın URL'si verilmeden bu örnek canlı bir güncelleme kaynağı değildir. Kurucu ve `latest.json` aynı sürüm yayınına eklenir; GitLab'ın `https://gitlab.com/Turkish_Vito/karevo/-/releases/permalink/latest/downloads/latest.json` kalıcı adresi istemci için sabit besleme adresi olarak kullanılabilir. İlk güncelleme destekli sürüm bir kez elle kurulmalıdır; önceden dağıtılan 3.0.0 sürümünde güncelleme istemcisi yoktur.

Araç, kurucunun gerçek dosya adını, boyutunu ve SHA-256 özetini hesaplar. Dosyanın imzalama sırasında değişmediğini kontrol eder. Yayın notları düz metindir. Komut çıktısı yalnız sürüm, dosya özeti ve genel anahtar kimliği içerir; özel anahtar yazdırılmaz.

## İmza sözleşmesi

Zarfın alanları tam olarak `schema`, `keyId`, `payload`, `signature` olmalıdır. `payload`, UTF-8 JSON'un standart Base64 kodlamasıdır; Ed25519 imzası JSON yeniden oluşturulmadan doğrudan bu çözülen baytlar üzerinde denetlenir. Böylece boşluk veya anahtar sırası farkları yeniden imzalanmadan değiştirilemez.

İmzalanan JSON tam olarak şu alanları içerir:

- `schema: bulten-studio-update`, `schemaVersion: 1`, `appId: com.bultenstudio.app`.
- `platform: win32`, `arch: x64`, `channel: stable`.
- Kararlı `ana.alt.yama` sürümü, pozitif tamsayı `sequence`, ISO UTC `publishedAt` ve en fazla 8000 karakter `notes`.
- `installer`: güvenli `.exe` dosya adı, HTTPS URL, 64 küçük onaltılık karakter SHA-256 ve 1–268435456 bayt `size`.

Zarf en fazla 65536 bayttır. Bilinmeyen/eksik alan, bozuk Base64/UTF-8, yanlış anahtar/imza, uygulama/platform/kanal uyuşmazlığı ve geçersiz dosya bilgileri reddedilir. Kimlik bilgisi, kontrol karakteri, ters eğik çizgi veya parça işareti içeren URL'ler kabul edilmez.

İstemci doğruladığı en yüksek yayın sırasını korur. Daha düşük `sequence` tekrar sunulursa geri alma girişimi olarak reddedilir. Aynı yayın sırası yeniden denetlenebilir. Doğrulanmış eşit/eski uygulama sürümü `isNewer: false` döndürür ve kurulmaz. Yeni sürümler için hem semantik sürüm hem yayın sırası yükseltilmelidir; sürüm düşürmek bu akışın parçası değildir.

İmza yayıncı onayını, SHA-256 ise imzalı metadata ile indirme baytlarının eşleşmesini doğrular. Yerel zararlı yazılıma, özel anahtarın çalınmasına veya yayıncının kendi anahtarıyla zararlı dosya imzalamasına karşı tek başına koruma değildir. HTTPS, paket boyutu sınırı, indirme sonrası yeniden doğrulama ve kurulum öncesi proje yedeği istemci katmanında ayrıca uygulanır.

## Kontroller

`node --test scripts/update-contract.test.cjs` gerçek anahtarlarla imza doğrulamasını, değiştirilen/yanlış anahtarlı zarfları, imzalı fakat geçersiz içerikleri, sürüm/yayın geri almasını, URL ve boyut sınırlarını, anahtar kimliğinin tekrar kullanılmasını ve yayın CLI'sinin gerçek dosya özetiyle eşleşmesini sınar. Gerçek Windows çalıştırması veya SmartScreen taraması bu testin kapsamında değildir.
