# Video düzenleme — Bülten Studio 3.2

Üst çubuktaki **Video düzenle** düğmesi cihazdaki MP4 veya WebM dosyasını açar. Önceki, haber tasarımını hareketlendiren araç **Animasyon** adıyla kullanılmaya devam eder.

1. **Video seç** ile tek klip aç. Oynat/duraklat ve zaman çizgisiyle görüntüyü incele. Zaman çizelgesindeki sol ve sağ tutamaçları sürükleyerek kesme noktalarını seç; seçili klibi sürükleyerek bölümü taşı ve oynatma çizgisinden istediğin ana git. İstersen başlangıç ve bitiş saniyelerini yaz veya **Buradan / Buraya** düğmelerini kullan.
2. Özgün oran, 4:5, 9:16, kare veya 16:9 kadraj seç. Görüntüyü sığdır/doldur ve 90° döndür. Kaynak sesinin seviyesini değiştir veya sessiz çıktı seç.
3. En fazla 300 karakterlik yazıyı üstte, ortada veya altta göster. Yazı kadraja sığmazsa metni kısalt. MP4/WebM ve çıktı genişliğini seçip **Videoyu dışa aktar** düğmesine bas.

Girdi sınırı 120 MiB, 5 dakika ve 4K/8,3 milyon pikseldir. Seçili çıktı bölümü 0,25–60 saniye, dosyası en fazla 40 MiB olabilir. Çıktı genişliği 720 veya 1080 pikseldir; çok uzun kadrajlar 1920 piksel yükseklik sınırına sığdırılır. Bu seçimler cihazın video kodlayıcısına bağlıdır; MP4 desteği yoksa WebM kullan. Dışa aktarma gerçek zamanlıdır, pencereyi açık ve görünür tut. Arka plana geçişte işlem iptal edilir; açık kaydetme penceresini bu pencerenin kendi iptal düğmesiyle kapat.

Kaynak video dosyası değiştirilmez. Video düzenleme oturumu haber projesine gömülmez; sonucu ayrıca video olarak kaydet. Video penceresini kapatmak oturumu temizler.

## Güvenlik ve doğrulama

Videolar sunucuya yüklenmez. Yalnızca dosya seçiciden alınan Blob/File girdileri kullanılır; URL, oynatma listesi veya komut satırı kabul edilmez. MP4/WebM kapsayıcı başlıkları sınırlı derinlik, okuma sayısı, toplam başlık baytı ve zaman bütçesiyle incelenir. Bildirilen boyutlar ve süre, çözücüye kaynak verilmeden denetlenir; gerçek metadata ayrıca doğrulanır. Harici MP4 veri referansları reddedilir. Medya politikası yalnızca oturuma ait `blob:` kaynaklarına izin verir; bağlantı, iframe, worker ve nesne yükleme kapalıdır. Kaynak sesini almak için mikrofon izni istenmez.

İşlemler aynı anda çalıştırılmaz. İptal ve kapatmada kaydedici, video/ses izleri, zamanlayıcılar ve nesne URL'leri temizlenir. Güncelleme kurulumu ve haber projesi düzenleme video işlemi sırasında engellenir. Kapanış iptal edilirse açık klip korunur.

Otomatik güvenlik/arayüz testlerinin yanında Linux Chromium üzerinde gerçek MP4/WebM sesli ve sessiz kodlama, kesme, döndürme, tekrar dışa aktarma, iptal, dosyayı yeniden açma ve yerel kaydetme doğrulaması çalıştırılmıştır. Gerçek Windows kurulumu ve Android cihaz/WebView çalıştırması bu Linux ortamında denenmemiştir. Kapsayıcı ve kaynak sınırları tüm codec bit akışlarının güvenli olduğu veya mutlak bellek sınırı garantisi değildir; güncel Electron ve Android System WebView kullanılmalıdır.
