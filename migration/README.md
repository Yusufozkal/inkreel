# Özgün Git geçmişi yedeği

[github-history.bundle](github-history.bundle?inline=false), GitHub kapanmadan önce doğrulanan kaynak deposunun bütün yerel Git geçmişini ve 7 sürüm etiketini içerir. GitLab'daki yeni arayüz ve taşıma commitleri değiştirilmedi.

Ana commit: `c8da025688b1757a533a65c3fc7d0c32b718d9c3`.
SHA-256: `806433aa7407305448e34871414021f3113ef64d3f9b1ac519baba209cbaa196`.

Ayrı bir klasöre geri yükleme:

```sh
git clone github-history.bundle eski-karevo
```

Bu yedek geçmişi mevcut GitLab dalının üzerine yazmaz. Özel anahtar, parola veya kişisel proje dosyası içermez. Kurulum dosyaları Git verisinin parçası değildir.

Windows dosyası ve sürüme yayınlama aracı [ayrı aktarım dalında](https://gitlab.com/Turkish_Vito/karevo/-/tree/migration/complete-transfer/migration/transfer) hazırlanmıştır. Bu dal geçici taşıma içindir; ana kaynak ağacının parçası değildir. GitLab hesabı CI çalıştırmaya izin verdiğinde pipeline çalıştırılarak kurucu package registry ve sürüm indirmelerine eklenir.
