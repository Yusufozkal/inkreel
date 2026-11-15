# Bülten Studio Android 3.0.2

22 Ekim 2026. Paket kimliği, yerel kayıt alanı ve Android imza sertifikası 3.0.0/3.0.1 ile aynıdır. Mevcut uygulamayı silmeden üzerine kurulabilir.

- Otomatik kayıt başarısız olduğunda Geri tuşu artık çalışmayı kapatmaz. Düzenleme ve proje dosyası olarak yedekleme açık kalır; kayıt tekrar denenebilir.
- Kapanışta beş saniye içinde yanıt gelmezse otomatik çıkış yerine varsayılanı düzenleyiciye dönmek olan Android uyarısı gösterilir. Kapanış isteği numarası, önceki bir kayıt veya zaman aşımı yanıtının sonraki isteği yanlışlıkla kapatmasını engeller.
- Dosya seçici açıkken uygulama durdurulup simgeden yeniden açıldığında eski bekleyen işlem temizlenir; yeni kaydetme/açma istekleri sürekli meşgul hatasına takılmaz. Android'in gerçekten yeniden oluşturduğu Activity için bekleyen dosya kurtarması korunur.
- Proje açılırken düzenleme ve ikinci açma isteği engellenir. İptal veya hatalı dosya açık çalışmayı korur; başarılı açma geri alınabilir.
- Video hazırlığı yazı tiplerini veya görsel çözümlemesini beklerken de iptal edilebilir; düzenleyici yeniden kullanılabilir kalır.
- Başlangıç UTF-8 BOM işareti taşıyan proje dosyaları açılır. 240 punto başlık, %600 fotoğraf yakınlaştırma ve 8 piksel metin katmanı artık kayıt/açılış ve çizimde aynı değerleri korur.
- Mobil alt çubuk eski 3.0.0 yazısıyla gerçek uygulama sürümünü ezmez.

Doğrulama: Android Promise köprüsü, proje/düzenleme/marka/şablon/çıktı iş akışları ve paylaşılan zararlı görsel testleri; ayrıca başarısız otomatik kayıt ve geciken proje/video hazırlığı için DOM regresyonları. Üretim Java kapanış isteği koruması JVM üzerinde çalıştırılır. APK için Java/DEX derleme, varlık eşleşmesi, CRC, sürüm, imza sertifikası ve hizalama kontrolleri yapılır. Gerçek Android cihazı/emülatörü, dosya sağlayıcısı ve Android uyarı penceresi bu ortamda çalıştırılmamıştır.
