# Inkreel 3.3.0 — Karevo'nun yeni adı

## Kullanıcılar için
- Uygulama adı **Karevo → Inkreel** olarak değişti; yeni simge ve `Inkreel.exe` ile gelir. Kurucu: `Inkreel-3.3.0-Setup.exe`.
- Windows: mevcut kurulum klasörü, kullanıcı verisi (taslaklar, ayarlar) ve proje biçimi korunur. Kurucu eski `Karevo.exe` dosyasını ve eski Karevo kısayollarını (Masaüstü, Başlat menüsü) kaldırır, Inkreel kısayollarını oluşturur.
- Yeni projeler **`.inkreel`** olarak kaydedilir. `.karevo`, `.bulten`, `.netice` ve JSON projeleri açılmaya devam eder.
- Android: Inkreel (`com.inkreel.studio`) **yeni bir uygulama** olarak Karevo'nun yanına kurulur; eski Android imza anahtarı kayıp olduğu için güncelleme olamaz. Projelerinizi Karevo'da Kaydet ile dışa aktarıp Inkreel'de açın.

## Teknik
- Kasıtlı olarak değişmeyenler: Electron kullanıcı veri klasörü (`Bülten Studio`), AppUserModelId `com.bultenstudio.app`, kayıt defteri anahtarları `Software\BultenStudio` / `Uninstall\BultenStudio`, güncelleme şeması ve `bulten://app` protokolü, `KAREVO_*` derleme değişkenleri, `KarevoAndroid` köprü adı.
- Güncelleme öncesi proje yedeği `.inkreel` olarak yazılır; temizlik eski `.karevo` ve `.bulten` yedeklerini de tanır.
