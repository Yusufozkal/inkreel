# Inkreel 3.3.0 — Android (kaynak kodu)

Android 8.0 (API 26) ve üzeri için Türkçe, çevrimdışı içerik editörü. Paket kimliği `com.inkreel.studio`; önceki Karevo, Bülten Studio ve Netice uygulamalarından ayrı, yeni bir uygulama olarak kurulur ve onların verilerini değiştirmez. Karevo içinde projeni dışa aktarıp (Kaydet) Inkreel içinde açabilirsin. Güncel Android System WebView kullanılması önerilir.

3.0.1 güvenlik güncellemesi, dosyalardan ve projelerden gelen görsellerin çözünürlüğünü tarayıcıya vermeden önce kontrol eder. Tek görsel ve bir tasarımın farklı görselleri toplam 48 milyon pikseli; projenin farklı görselleri toplam 512 milyon pikseli aşamaz. Aşırı büyük bir proje açılmaz; açık çalışma korunur. Bu tarihî 3.0.1 yaması, o zamanki uygulamanın kimliğini koruyordu; yeni Inkreel 3.3.0 ayrı paket ve imza kullanır.

## Kurulum

Bu kaynak paketi tek başına yüklenebilir bir APK değildir. Aynı uygulamayı güncellemek için mevcut Android imza anahtarı ile imzalanmış bir Inkreel APK’sı oluşturulmalıdır. İmzalı APK hazırlandığında Android sorarsa indirmeyi açtığın uygulama için uygulama yükleme izni gerekir.

## Alt menü

- **Tasarım:** çalışma alanı. Seçim aracı ile katmanları taşı. Kadraj aracında fotoğrafı sürükle; iki parmak veya Medya bölümündeki yakınlaştırma çubuğunu kullan.
- **Şablon:** altı hazır düzen ve kendi şablonların. `+` ile açık tasarımın düzenini sakla. Varsayılan olarak habere özgü metin ve fotoğraflar şablona eklenmez.
- **Medya:** ana/ikinci fotoğraf, logo, kadraj, parlaklık ve kontrast.
- **Marka:** logo, marka adı, hesap, renkler ve yazı tipini profil olarak sakla. Kaydettikten sonra açık çalışmaya veya tümüne uygula. Haber metni ve fotoğraflar korunur. Profiller proje dosyasında saklanır.
- **Düzenle:** başlık, kategori, kaynak ve marka bilgileri; Katmanlar sekmesinde metin, şekil ve ek görsel.
- **Yayın:** açıklama, alternatif metin, kaynak bağlantısı, tarih ve durum. Takvim yerel hazırlık içindir; otomatik Instagram paylaşımı yapmaz.

**Bitti**, tasarımın boş alanı veya Android geri tuşu açık paneli kapatır. Android geri tuşu önce diyaloğu/paneli kapatır; editörden çıkarken otomatik kayıt tamamlanır.

## Üst düğmeler ve diğer işlemler

- **Proje aç/Kaydet:** fotoğraflar, katmanlar, markalar, şablonlar ve yayın bilgileriyle `.inkreel` dosyası. Bilgisayar sürümüyle aynı biçim kullanılır. Önceki `.karevo`, `.bulten`, `.netice` ve JSON proje dosyaları da açılır. Önceki Android uygulamasının kendi taslak alanı otomatik taşınmaz.
- **Dışa aktar:** dört oran, PNG/JPG, 1× veya 2× çözünürlük. Tek görsel Android 10+ üzerinde `Pictures/Inkreel` galerisine kaydedilir; Android 8–9 sistem dosya kaydetme ekranını kullanır. Toplu çıktıda 24 görsele kadar ZIP dosyası sistemin seçtiğin konumuna kaydedilir.
- **Diğer işlemler:** görsel paylaşımı, sessiz animasyonlu video, yayın planı, akış önizlemesi, CSV üretimi, arşiv ve yeni proje.
- **CSV’den üret:** örnek CSV'yi indir, başlık ve fotoğraf dosyası adlarını doldur. CSV'yi ve fotoğrafları seç; önizlemeden sonra çalışmaları oluştur. Bir projede en fazla 20 çalışma, 20 marka ve 30 özel şablon olabilir.
- **Video:** açık tasarımı 5/10/15 saniyelik yakınlaşma, kayma veya açılış animasyonuna dönüştürür. 720 veya 1080 piksel genişlik. MP4/WebM seçenekleri cihazın WebView kodlayıcı desteğine bağlıdır; destek yoksa düğme açıklama gösterir. Kayıt sırasında uygulama görünür kalmalıdır. Ayrıca tek bir video klibini düzenleme aracı bulunur; çok kanallı montaj bu sürümde bulunmaz.
- **Paylaşım:** açık çalışmayı PNG olarak hazırlar, Android paylaşım menüsünü açar. Hedef uygulamayı kullanıcı seçer.

## Saklama

İnternet izni, reklam veya analiz SDK'sı yoktur. Editör ve fontlar APK içinde bulunur. Proje ve taslaklar cihazdaki uygulama alanında saklanır; ayrıca Kaydet ile dosya yedeği al. Uygulamanın verilerini temizlemek veya kaldırmak yerel taslakları siler. Galeriye ve seçtiğin klasörlere kaydettiğin dosyalar ayrı saklanır.

Font lisansları `www/assets/licenses` içindedir. Eski projelerin başlangıç fotoğrafını açabilmek için eski görsel varlığı saklanır; yeni projeler fotoğrafsız ve genel marka bilgileriyle başlar.

## Derleme ve doğrulama

Araçlar ve komutlar `BUILD.md`, JavaScript kontrolleri `qa/README.md` içinde. Kaynak arşivi imza anahtarı/parolası içermez. Aynı uygulamaya güncelleme yayınlamak için `signing/` altındaki mevcut özel anahtar korunmalıdır; bu dosyaları paylaşmayın. Derleme araçları, bağımlılıklar ve özel anahtarlar kaynak ZIP'e alınmaz.

Android araçlarıyla derleme, manifest, DEX, arşiv bütünlüğü, piksel hizalaması ve APK imzası doğrulanır. Canvas ve JS köprüsü/arayüz testleri gerçek cihaz yerine jsdom/Napi Canvas ve taklit Android sınırıyla çalışır. Fiziksel cihaz, WebView yerleşimi, galeri/paylaşım pencereleri ve gerçek video kodlayıcısı bu ortamda denenmedi.

3.0.2 hata düzeltmeleri: `BUGFIX-3.0.2.md`. Kayıt başarısız olduğunda Android Geri tuşu çalışmayı kapatmaz; proje açma ve video iptali akışları da düzeltildi.

3.1.1 yerel video düzenleyicisi ve güvenlik/kullanım sınırları: `VIDEO-3.1.0.md`. Kaynak dosyayı kesme, kadraj, ses ve metin düzenleyip desteklenen MP4/WebM biçiminde çıktı alabilirsin.

3.1.1 ile video düzenleyicide zaman çizelgesi eklendi. Kenarlardaki tutamaçları sürükleyerek başlangıç/bitişi ayarla; seçili klibi sürükleyerek aralığı taşı veya çizgiye dokunarak oynatma konumuna git. Değerler önceki saniye alanlarıyla eşzamanlıdır. Video işleme ve güvenlik sınırları `VIDEO-3.1.0.md` içinde açıklanır.

## Inkreel adı

3.3.0 sürümü ayrı Inkreel uygulamasıdır; yeni paket kimliği ve yeni bir Android imzası kullanır (eski Karevo imza anahtarı kaybolduğu için Inkreel eski Karevo uygulamasının güncellemesi olamaz). Eski uygulamanın üzerine kurulmaz veya verilerini silmez. Yeni projeler `.inkreel` uzantısıyla kaydedilir; önceki `.karevo`, `.bulten`, `.netice` ve JSON dosyaları açılabilir. Şema sürümü ve veri doğrulaması korunur. Arayüz, paylaşım/galeri/ZIP/video ve takvim üretici adları Inkreel olarak yenilendi. Bu kaynak arşivi imza anahtarı içermez.
