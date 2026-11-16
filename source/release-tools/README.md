# Inkreel sürüm araçları

Bu klasörde yalnızca sürüm notu şablonu (`release-notes.md`) bulunur.

Eskiden burada, kurucuları 8 MB'lık parçalara bölüp git verisi olarak yükleyen ve GitHub Actions ile taslak sürüme ekleyen tek kullanımlık araçlar vardı. Proje GitLab'a taşındığı için bu araçlar kaldırıldı; kurucular artık doğrudan sürüm sayfasına eklenir.

## Windows sürümü yayımlamak

İmzalı `latest.json` hazırlamak ve GitLab'da sürüm oluşturmak için:

```sh
cd source/windows
node scripts/prepare-release.cjs --repo Turkish_Vito/inkreel --version 3.3.0 --sequence 30300 \
  --installer /yol/Inkreel-3.3.0-Setup.exe --key /guvenli/yol/update-private.pem \
  --notes-file ../release-tools/release-notes.md
```

Komut dosyaları `release/v<sürüm>` klasörüne hazırlar. Kontrol ettikten sonra aynı komuta `--publish` ekle.

Betik `--publish` verilmeden ağa hiçbir şey yazmaz. Yayımlama [glab](https://gitlab.com/gitlab-org/cli) ile yapılır; önce `glab auth login` ile kendi GitLab hesabında oturum aç. Ayrıntılar: [İmzalı güncellemeler](../windows/docs/SIGNED-UPDATES.md).

Android APK'sı ve Windows kurucusu, GitLab'daki sürüm sayfasına bağlantı (asset link) olarak eklenir. İndirme adresinin `.../-/releases/<etiket>/downloads/<dosya>` biçiminde çalışması için her bağlantının `filepath` değeri `/<dosya adı>` olmalıdır.
