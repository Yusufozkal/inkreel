# Bülten Studio 3.1.2 düzeltmeleri

22 Ekim 2026. Windows 3.1.1 üzerine hazırlanmıştır. Ortak düzenleyici düzeltmeleri Android 3.0.2 sürümüne de aktarılır. Uygulama kimlikleri, kullanıcı veri konumu, proje biçimi ve imza anahtarları korunur.

- Fotoğraf yakınlaştırması %500 ile %600 arasında artık çizime yansır. Geçerli taşınabilir projelerdeki 240 px başlık ve 8 px katman yazı değerleri sessizce farklı çizilmez. Başlık ve katmanlar gerektiğinde kutularına sığacak şekilde küçülmeye devam eder.
- Windows editörlerinin ekleyebildiği UTF-8 BOM işaretli `.bulten` ve eski `.netice` projeleri açılır. Yalnızca metnin başındaki işaret kaldırılır; içerikteki Türkçe karakterler ve işaretler korunur. Bozuk UTF-8 dosyaları Windows tarafında reddedilmeye devam eder.
- Proje dosyası okunurken düzenleme ve ikinci açma isteği engellenir. Böylece geciken eski dosya okuması daha sonraki çalışmanın üzerine yazmaz. İptal, bozuk dosya ve okuma hatası açık projeyi değiştirmeden düzenleyiciye döner.
- Video hazırlığı yazı tipi veya görsel beklerken iptal edilebilir; düzenleyici tekrar kullanılabilir. Başlamış görsel çözümlemesi arka planda tamamlanabilir, video kaydı veya dosya teslimi başlatılmaz.
- Başarısız güncelleme denetiminden sonra önceden doğrulanmış kurucu çevrimdışı kurulabilir. Yarım indirme, yeniden başarılı yayın denetimi beklemeden denenebilir. Yalnızca mevcut anahtar ve sıra numarasıyla doğrulanan aday işlem yeteneği kazanır; kurulumdan önce imza ve dosya özeti tekrar kontrol edilir.
- Geçersiz güncelleme adresi veya ayar kaydı hatası girilen adresi ve otomatik denetim seçimini silmez. Geciken güncelleme penceresi başka işlem sürerken açılmaz.
- Güncelleme indirmesinde disk dosyası açılamazsa HTTP yanıtı hemen kapatılır; geçici dosya bırakmadan yeniden deneme mümkündür.

## Android 3.0.2

- Otomatik kayıt başarısızken Geri tuşuyla çıkış uygulamayı kapatmaz; proje dosyasını elle kaydetme ve yeniden deneme mümkündür.
- Gecikmiş kapatma yanıtları istek kimliğiyle ayrılır. Yanıt gelmezse otomatik çıkış yerine varsayılanı düzenleyicide kalmak olan yerel uyarı gösterilir.
- Dosya seçici açıkken uygulama zorla durdurulup simgeden yeniden açılırsa eski bekleyen dışa aktarma kaydı düzenleyiciyi kilitlemez. Gerçek Activity geri yükleme akışı korunur.
- Sürüm etiketi sabit eski değerle değiştirilmez; yerel uygulamanın sürümü gösterilir.

## Kontrol kapsamı

Windows yerel altyapı testleri, gerçek Canvas çizim/çıktı kontrolleri, jsdom ile proje okuma/iptal/düzenleme/güncelleme akışları ve önceki zararlı görsel testleri çalıştırılmıştır. Android için Java kapatma istek eşleştirmesi JVM üzerinde, köprü ve düzenleyici akışları denetimli DOM ortamında kontrol edilir. Kurucu içindeki dosyalar ve APK imzası ayrıca doğrulanır. Bu Linux ortamında gerçek Windows kurulumu veya fiziksel Android/WebView testi yapılmamıştır. Windows kurucusu Authenticode yayıncı sertifikası içermez.
