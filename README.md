<div align="center">
  <img src="assets/karevo-banner.svg" alt="Karevo — sosyal medya içerikleri için tasarım ve video düzenleme" width="100%">

  **Hikâyeni tasarla, düzenle ve paylaşmaya hazırla.**

  Haber görsellerinden kısa videolara, sosyal medya içeriklerini tek bir çalışma alanında hazırla.

  ### [⬇ Windows için indir · 3.2.4](https://gitlab.com/Turkish_Vito/karevo/-/releases/v3.2.4/downloads/Karevo-3.2.4-Setup.exe) &nbsp;&nbsp;&nbsp; [⬇ Android için indir · 3.1.3](https://gitlab.com/Turkish_Vito/karevo/-/releases/karevo-v3.2.3-preview/downloads/Karevo-3.1.3-Android.apk)

  [Sürüm bilgileri](https://gitlab.com/Turkish_Vito/karevo/-/releases/v3.2.4) · [Kurulum](#kurulum) · [Güncellemeler](#güncellemeler) · [Kaynak kodu](source/README.md)

  Windows 10 / 11 · 64 bit &nbsp; • &nbsp; Android 8+ &nbsp; • &nbsp; Manuel kurulum
</div>

---

## Fikrinden paylaşıma

Karevo; içerik üreticileri, haber sayfaları ve kendi markası için paylaşım hazırlayanlar için bir görsel ve video içerik düzenleyicisidir. Hazır şablonlarla başlayabilir, kendi görsellerini ve marka öğelerini kullanarak tasarımını kişiselleştirebilirsin.

| Tasarla | Video düzenle | Düzenini koru |
| --- | --- | --- |
| Hazır şablonlar, metin, şekil ve görsel katmanlarıyla içerik oluştur. | Tek klibi zaman çizelgesinde kes; kadraj, yazı ve ses ayarlarını düzenle. | Marka profillerini kullan, projelerini kaydedip çalışmana daha sonra devam et. |

- **İçeriğine uygun görünüm:** Kendi logonu, renklerini ve görsellerini kullan.
- **Paylaşıma hazır çıktılar:** Görselleri PNG veya JPG olarak dışa aktar; birden fazla çıktıyı toplu hazırla.
- **Kısa videolar ve animasyonlar:** Videonun başlangıç ve bitişini zaman çizelgesinden seç, oynatma konumunu kontrol et ve animasyonlu içerikler hazırla.
- **Kendi çalışma alanın:** Projelerini kaydedip daha sonra düzenlemeye devam et. Video işleme cihazında yapılır.

<img src="assets/karevo-preview.png" alt="Karevo düzenleyicisinde yeni K simgesi, şablonlar ve tasarım çalışma alanı" width="100%">

Video düzenleyici tek kliple çalışır. Kaynak video en fazla 5 dakika ve 120 MiB, çıktı ise 0,25–60 saniye olabilir. MP4 ve WebM desteği cihazın kodlayıcılarına göre değişebilir.

## Kurulum

**Windows**

1. [Karevo Windows kurucusunu indir](https://gitlab.com/Turkish_Vito/karevo/-/releases/v3.2.4/downloads/Karevo-3.2.4-Setup.exe).
2. İndirilen `Karevo-3.2.4-Setup.exe` dosyasını aç ve kurulum adımlarını izle.
3. Uygulamayı aç, bir şablon seç ve ilk tasarımını oluştur.

**Gereksinim:** Windows 10 veya Windows 11, 64 bit. Kurulumdan önce mevcut çalışmalarını proje dosyası olarak yedekle.

**Android**

[Karevo Android APK’sını indir](https://gitlab.com/Turkish_Vito/karevo/-/releases/karevo-v3.2.3-preview/downloads/Karevo-3.1.3-Android.apk), dosyayı aç ve kurulum adımlarını izle. Android 8 veya üzeri gerekir. Güncel Android sürümü 3.1.3’tür ve [3.2.3 sürüm sayfasında](https://gitlab.com/Turkish_Vito/karevo/-/releases/karevo-v3.2.3-preview) yayımlanır. Karevo yeni, bağımsız bir uygulama olarak eski sürümün yanında kurulur. Eski uygulamadaki çalışmalarını proje dosyası olarak dışa aktararak Karevo’da açabilirsin.

**Projeler:** Yeni kayıtlar `.karevo` uzantısını kullanır. Eski `.bulten` ve `.netice` projeleri de açılabilir.

<details>
<summary>Windows uyarısı ve doğrulama bilgileri</summary>

Kurucu henüz Windows yayıncı sertifikasıyla imzalanmadığı için Microsoft Defender SmartScreen bir uyarı gösterebilir. Kurucu içeriği ve dosya bütünlüğü kontrol edilmiştir; bu sürümün kurulumu gerçek bir Windows cihazında henüz doğrulanmadı.

</details>

## Güncellemeler

**3.2.4 ve sonrası otomatik güncellenir.** Uygulamanın **Güncellemeler → Güncelleme ayarları** bölümüne şunu yaz ve kaydet:

```text
Turkish_Vito/karevo
```

Otomatik denetim açıksa uygulama yeni sürümleri GitLab'dan kontrol eder; indirme ve kurulumu sen başlatırsın. Güncelleme bilgileri Ed25519 imzasıyla doğrulanır (anahtar kimliği `ed25519:17a876fe9ae838d3d31b2cf36a8f66cd`); indirilen kurucunun boyutu ve dosya özeti kontrol edilir. Bu doğrulama, Windows yayıncı sertifikasının yerini almaz.

**3.2.3 veya daha eski bir sürüm kullanıyorsan, 3.2.4'ü bir kez elle kur.** Proje GitHub'dan GitLab'a taşınırken güncellemeleri imzalayan eski anahtar da değişti; eski sürümler yeni güncellemeleri tanımaz. Yukarıdaki indirme bağlantısıyla 3.2.4'ü kurman yeterli; projelerin ve ayarların korunur.

Android sürümü bu sayfadaki APK ile elle güncellenir.

## Sürümler ve arşiv

[Karevo 3.2.4 sürümünü görüntüle](https://gitlab.com/Turkish_Vito/karevo/-/releases/v3.2.4) · [Tüm sürümler](https://gitlab.com/Turkish_Vito/karevo/-/releases)

Windows ve Android kaynakları, testler ve derleme talimatları artık [Kaynak kodu](source/README.md) bölümündedir. Windows ve Android kurucuları GitLab Releases bölümündedir; indirme bağlantıları ve dosya özetleri doğrulanmıştır. İmzalı otomatik güncelleme kanalı 3.2.4 ile GitLab'da çalışıyor.

<details>
<summary>Önceki sürümler ve mevcut projelerle uyumluluk</summary>

Karevo, daha önce Bülten Studio adıyla sunuluyordu. Eski adla yayımlanan sürümler arşiv olarak korunur; imzalı otomatik kanaldaki son yayın 3.2.1’dir. Karevo indirmek için bu sayfanın üstündeki bağlantıyı kullan.

Mevcut Windows verilerinin konumu korunur; eski proje dosyaları açılabilir. Android sürümü ayrı kurulur, eski uygulamanın verilerini otomatik taşımaz. 3.0 ve önceki sürümlerde güncel kurucuyu bir kez elle kurmak gerekir.

Proje daha önce GitHub'da yayımlanıyordu; o adres artık kullanılmıyor ve yeni adrese yönlendirmiyor. Güncel indirmeler ve güncellemeler yalnızca GitLab'dadır.

</details>


[Özgün GitHub geçmişi ve 7 sürüm etiketi yedeği](migration/README.md)
