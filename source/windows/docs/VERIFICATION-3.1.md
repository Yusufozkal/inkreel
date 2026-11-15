# 3.1.0 doğrulama kapsamı

20 Ekim 2026 tarihinde kaynak dondurulduktan sonra:

- `npm run test:native`: 34 test geçti. Gerçek Ed25519 imzaları, metadata sınırları, SHA-256/boyut doğrulaması, geri alma engeli, önbellek, zaman aşımı, native IPC, proje yedeği ve başarısız kurucu başlatma akışı kontrol edildi.
- `cd qa && npm test`: çekirdek, 48 çizim örneği ve 14 ek özellik, CSV/takvim iş akışları, 9 video yaşam döngüsü, 14 masaüstü arayüzü, 9 yayın iş akışı ve 8 güncelleme arayüzü grubu geçti.
- Bağımsız kaynak incelemesinde düzeltilmesi gereken somut bir güvenlik veya veri kaybı hatası bulunmadı.
- Yayın hazırlama aracının 7 ek testi geçti: açıkça `--publish` verilmeden GitLab'a yazmama, yalnız iki yayın dosyası yükleme, sürüm/dosya eşleşmesi, özel anahtarın çıktılara karışmasını ve yanlış anahtarla yayın hazırlamayı engelleme.
- Tek dosyalık HTML çıktısı ayrıca çevrimdışı başlangıç, eski fotoğraflı proje açma ve geçerli PNG/JPEG dışa aktarımı için kontrol edildi. Bu HTML test çıktısı Windows kurucusundan ayrıdır.

Arayüz testleri jsdom, Napi Canvas ve sahte native köprü kullanır. Ağ testlerinde kontrollü taşıyıcı kullanılır; canlı GitLab yayını yapılmadı. Gerçek Windows kurulumu, işletim sistemi video kodlayıcısı ve SmartScreen davranışı bu ortamda denenmedi.

Kurucunun PE, arşiv bütünlüğü, paketlenmiş kaynak eşleşmesi ve çıkarılan tüm yük dosyaları için ayrıca üretilen `Bulten-Studio-3.1.0-Setup-verification.json` raporuna bakın. Bu raporun `windowsRuntimeTested: false` alanı gerçek Windows kurulumunun denenmediğini belirtir.
