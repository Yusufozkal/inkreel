# Karevo 3.2.3 — isim geçişinin tamamlanması

- Uygulama dosyası ve işlem adı `Karevo.exe`, taşınabilir klasör `Karevo-win32-x64` oldu.
- Yeni kurulumlar `%LOCALAPPDATA%\Programs\Karevo` konumuna yapılır. Önceki kurulumun kayıt anahtarı varsa aynı kurulum dizini kullanılır.
- Kullanıcı veri konumu, IndexedDB kökeni, uygulama kimliği, proje şeması ve güncelleme güven anahtarı korunur.
- Eski `Bulten Studio.exe` yalnızca doğrulanmış kurulum dizinindeki bilinen program dosyası olarak temizlenir. Kurucu ve kaldırıcı, eski ve yeni iki uygulama dosyasını silmeden önce mevcut dosyaların özel yazma/silme erişimiyle açılabildiğini kontrol eder. Kontrol `OPEN_EXISTING` kullanır; dosyaya veri yazmaz, oluşturmaz veya kısaltmaz.
- Kısayollar, bitiş sayfası ve kaldırıcı simgesi `Karevo.exe` dosyasına yönelir.
- Üst logoda ortak K simgesi, uygulama düğmelerinde yeni turkuaz renk kullanılır. İçerik tasarımlarının seçilen renkleri değiştirilmez.
- Yeni projeler `.karevo` uzantısıyla saklanır. `.bulten`, `.netice` ve JSON projeleri açılabilir; proje içeriğinin şeması aynıdır.
- Güncelleme öncesi yeni yedekler `.karevo` kullanır; önceki otomatik `.bulten` yedeklerinin sınırlandırılmış saklama/temizleme kuralları sürer.
- Hazır Bülten şablonunun görünen adı Editoryal oldu; kayıtlı proje şablon kimlikleri korunur.

56 native test, editör/renderer, proje, iş akışı, güncelleyici, güvenlik ve video zaman çizelgesi QA kontrolleri geçti. NSIS preflight uyarıları hata sayarak derlendi. Kurucu ve kaynak eşleşmesi paketlemeden sonra ayrıca doğrulanır. Gerçek Windows cihazı üzerinde kurulum, yükseltme, kaldırma ve çalışan EXE kilit davranışı bu ortamda test edilmedi.
