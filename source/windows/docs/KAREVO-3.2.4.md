# Karevo 3.2.4 — yeni arayüz, GitLab ve yeni güncelleme anahtarı

## Kullanıcılar için
- **Bu sürümü bir kez elle kur.** 3.2.3 ve önceki sürümler bu sürüme otomatik güncellenemez: güncellemeleri imzalayan eski anahtar artık kullanılamıyor. 3.2.4'ü kurduktan sonraki sürümler yeniden otomatik gelir.
- Güncelleme kaynağı GitLab'a taşındı. **Güncellemeler → Güncelleme ayarları** bölümüne `Turkish_Vito/karevo` yazmak yeterli.
- Yeni arayüz: okunur yazı boyutları, tek renk dili, sadeleşmiş üst çubuk, "Dosya" menüsü (Proje aç, Kaydet, Güncellemeler), Video düzenle ve Animasyon için ayrı simgeler, yeni panel sekmeleri.
- Projeler, şablonlar ve kullanıcı verisi korunur; proje biçimi değişmedi.

## Teknik
- Güncelleme güven anahtarı değişti: `ed25519:17a876fe9ae838d3d31b2cf36a8f66cd` (`native/update-public-key.json`). Önceki anahtar `ed25519:c5584085b0c35f1c2bf52142e322236f` artık kullanılmıyor.
- Güncelleme duyurusu: `https://gitlab.com/Turkish_Vito/karevo/-/releases/permalink/latest/downloads/latest.json`.
- Kurucu Windows yayıncı sertifikasıyla imzalı değil; SmartScreen uyarı gösterebilir.
- Gerçek bir Windows cihazında kurulum, yükseltme ve kaldırma bu derleme ortamında (Linux) test edilmedi.
