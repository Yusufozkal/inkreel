# Karevo 3.2.3

Yayıncılar ve sosyal medya editörleri için Türkçe, çevrimdışı içerik atölyesi. Windows masaüstü uygulaması ve kurulumsuz HTML sürümü aynı proje biçimini kullanır.

## Kullanım

1. **Marka** sekmesinde profil oluştur: görünen ad, alt başlık, slogan, işaret, hesap, logo, renkler ve yazı tipi. Kaydettikten sonra açık çalışmaya veya tüm çalışmalara uygula. Profiller proje dosyasında saklanır.
2. Altı hazır şablondan birini seç. Fotoğrafı ekle, başlığı düzenle, metin/şekil/görsel katmanları ekle. Kendi düzenini **Kendi şablonların +** düğmesiyle sakla. Varsayılan olarak haber metni ve fotoğraflar özel şablona alınmaz.
3. **Projeler → CSV’den haber üret**: Örnek CSV'yi indir. CSV ve fotoğrafları seç, dosya adlarını eşleştir, önizlemeyi kontrol et ve çalışmaları oluştur. Proje en fazla 20 çalışma içerir.
4. **Yayın** panelinde açıklama, alternatif metin, HTTPS kaynak bağlantısı, yayın tarihi ve durum ekle. Üstteki takvim düğmesinden listeyi CSV, takvimi ICS olarak al. Bu, yerel hazırlık takvimidir; sosyal hesaba otomatik göndermez.
5. Izgara düğmesi son dokuz çalışmanın yan yana görünümünü açar. Kapaklar önizlemede 3:4 kırpılır; asıl çıktı değişmez.
6. **Video** açık tasarımı 5, 10 veya 15 saniyelik sessiz yakınlaşma/kayma/açılış animasyonuna dönüştürür. 720/1080 piksel genişlik, mevcut tasarım oranı. MP4 yalnızca ortam destekliyorsa, diğer durumda WebM. Kayıt sırasında pencereyi görünür tut. **Video düzenle** ile ayrıca yerel MP4/WebM klibini zaman çizelgesinde kes, kadrajını ve ses seviyesini değiştir, yazı ekle. Tek klip çıktısı 0,25–60 saniyedir; çok kanallı montaj ve otomatik altyazı bu sürümde bulunmaz.
7. **Kaydet** ile `.karevo` dosyasını yedekle. Fotoğraflar, katmanlar, markalar, şablonlar ve yayın bilgileri birlikte taşınır. Eski `.bulten`, `.netice` v2 dosyaları açılır; kayıtta yeni biçime geçer. Eski uygulamanın kayıtları otomatik taşınmaz.

Dört çıktı oranı, PNG/JPG, 1×–3× çözünürlük, tek işlemde 24 görsele kadar toplu çıktı, geri al/yinele, kilitlenen katmanlar, yerel proje arşivi ve otomatik kayıt desteklenir. Arşiv ve otomatik kayıt kullanılan cihaz/tarayıcıya bağlıdır; ayrıca proje dosyasını saklayın.

## Çalıştırma ve derleme

`npm ci` ardından `npm start`. Windows paketi için `npm run build:win`. Tarayıcı sürümleri için `node scripts/package-browser.cjs`. Kurucu derlemesi ve kontrolü `installer/` altında. NSIS araç zinciri ve Electron indirmesi gerekir.

Testler: `npm run test:native`, `node qa/core-check.cjs`, `node qa/renderer-check.cjs`, `node qa/workflow-check.cjs`, `node qa/video-check.cjs`, `node qa/dom-check.cjs`. QA bağımlılıkları `qa/package.json` üzerinden kurulur. HTML kontrolü `node qa/single-html-check.cjs dist/Karevo.html`.

Bu ortamda kontroller Node, jsdom ve Napi Canvas ile yapılır. Gerçek Windows kurulumu, tarayıcı yerleşimi ve işletim sisteminin video kodlayıcısı ayrıca cihaz üzerinde denenmelidir. Windows kurulum dosyası kod imzası içermez.

Font lisansları `ui/assets/licenses` içindedir. Eski projelerin özgün fotoğrafını açabilmek için eski görsel varlığı saklanır; yeni projelerde başlangıç fotoğrafı yoktur.

## İmzalı Windows güncellemeleri

3.1 sürümü mağazasız, Ed25519 doğrulamalı güncelleme istemcisi içerir. Güncelleme adresi ayarlanmadan ağ isteği yapılmaz. Ayrıntılar `docs/UPDATES-KULLANIM.md` ve `docs/SIGNED-UPDATES.md` içindedir. Bu mekanizma Windows yayıncı sertifikası sağlamaz. Mevcut uygulama kimliği, veri konumu ve proje biçimi korunur.

3.1.1 güvenlik yaması: `docs/SECURITY-3.1.1.md`. Zararlı görsel kaynak sınırları, kesilen güncelleme kaydında eski sürüm tekrarını engelleme ve kayıt hatasında kapatmayı durdurma içerir.

3.1.2 hata düzeltmeleri ve kontrol kapsamı: `docs/FIXES-3.1.2.md`.

## Video düzenleme

**Video düzenle** ile yerel MP4/WebM klibini kes, kadraj/döndürme/ses/yazı ayarlarını yap ve en fazla 60 saniyelik çıktı kaydet. Önceki tasarım videosu **Animasyon** adıyla korunur. Videolar haber proje dosyasına gömülmez; kaynak değiştirilmez ve dosyalar sunucuya yüklenmez. Sınırlar, kullanım ve test kapsamı: `docs/VIDEO-EDITOR-3.2.md`.

3.2.1: Video düzenleyicide başlangıç/bitiş tutamaçları, taşınabilir seçili klip ve oynatma konumu içeren zaman çizelgesi bulunur.
