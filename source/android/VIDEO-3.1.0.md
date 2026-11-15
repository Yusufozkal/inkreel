# Bülten Studio 3.1.0 — Android video düzenleyici

24 Ekim 2026. Telefon menüsündeki **Video düzenle** ile cihazındaki tek bir MP4 veya WebM klibini açabilirsin. Mevcut haber tasarımını videoya dönüştüren seçenek **Animasyon** adıyla korunur.

- Başlangıç/bitiş zamanı seçme ve en fazla 60 saniyelik bölüm kesme.
- Özgün, 4:5, 9:16, 1:1 ve 16:9 kadraj; doldurma/sığdırma ve 90° döndürme.
- Kaynak sesini ayarlama veya sessize alma.
- Üst, orta veya alt konuma düz metin ekleme.
- 720/1080 piksel çıktı; cihazın desteklediği MP4 veya WebM kodlayıcısını seçme.
- Önizleme, ilerleme ve işlem iptali. Android Geri tuşu devam eden işlemi iptal eder veya açık video penceresini kapatır.

Video bu oturumda tutulur, `.bulten` proje dosyasına eklenmez. Pencereyi kapatmadan önce düzenlenen çıktıyı dışa aktar. Kaynak video dosyası değişmez.

## Güvenlik sınırları

Video, dosya seçiciden kullanıcı tarafından seçilir; harici video adresi kabul edilmez. Girdi 120 MiB, 5 dakika ve 4K sınırlarıyla denetlenir. MP4/WebM başlıkları görüntü çözücüye verilmeden önce kontrol edilir; geçersiz veya aşırı büyük dosyalar reddedilir. Çıktı 40 MiB ile sınırlıdır.

Uygulama video yüklemez, internet isteği yapmaz, mikrofon veya genel depolama izni istemez. Dosya seçici yalnızca seçtiğin `content://` belgesine geçici okuma yetkisi verir. Üst üste seçim başlatılması ve güvenilmeyen sayfaya dönmüş eski seçim yanıtları reddedilir. WebView medyayı yalnızca yerel Blob kaynağından oynatır.

Arka plana geçildiğinde önizleme durur ve hazırlık/kayıt işlemi iptal edilir. Son kaydetme konumu seçimi Android dosya seçicisinden iptal edilir. Tamamlanan ve iptal edilen işlemler video, ses akışı, kodlayıcı, zamanlayıcı ve Blob kaynaklarını temizler.

Kaynak sesli çıktı ve MP4 kodlama, cihazdaki Android System WebView desteğine bağlıdır. Destek yoksa uygulama bunu bildirir; uygun olduğunda WebM veya sessiz çıktı seçilebilir. Güncel Android System WebView kullanılması gerekir.

## Kontrol kapsamı

Java/DEX derlemesi, izinler, varlık eşleşmesi, APK imzası, orijinal sertifika ve 16 KiB hizalama doğrulanır. Köprü, mobil menü/Geri, arka plan iptali ve kayıt hatası akışları denetimli DOM ortamında test edilir. Bu kontroller gerçek Android cihaz/WebView kodlayıcısı veya ses senkronu testi değildir. Paket kimliği, uygulama verileri ve imza sertifikası önceki Bülten Studio sürümüyle aynıdır.
