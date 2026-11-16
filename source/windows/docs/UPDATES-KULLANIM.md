# Bülten Studio 3.1 — mağazasız Windows güncellemeleri

Yeni sürüm, Ed25519 ile imzalanmış yayın bilgilerini ve bu bilgilerin işaret ettiği kurucunun SHA-256/boyutunu doğrular. Yalnızca uygulama içindeki sabit genel anahtarla doğrulanabilen güncellemeler kurulur. Bu, Windows Authenticode yayıncı sertifikası değildir ve SmartScreen uyarısını kaldırmaz.

## Kullanıcı için

3.0 sürümüne bu sistem uzaktan eklenemez; 3.1 kurucusu bir kez elle kurulmalıdır. Mevcut Bülten Studio kapatılarak aynı kullanıcı hesabına kurulur. Programın adı, kimliği, yerel kaynağı ve proje veritabanı korunur. Çalışmalarınızı ayrıca `.bulten` dosyası olarak yedekleyin.

Üstteki güncelleme simgesi veya Yardım → Güncellemeleri denetle bölümünden yayıncının verdiği GitLab proje bağlantısını (örn. `Turkish_Vito/inkreel`) ya da HTTPS yayın adresini bir kez kaydedin. Kaynak ayarlanmadan uygulama çevrimiçi güncelleme denemez. Otomatik denetim açıksa en fazla günde bir denetler; indirme ve kurulum kullanıcı düğmeleriyle başlatılır.

Yeni sürüm bulunduğunda indir. İndirme ve doğrulama sırasında editörde çalışılabilir. `Yeniden başlat ve güncelle` açık projeyi kilitler, otomatik kaydı tamamlar ve `.bulten` yedeği oluşturur. Ardından doğrulanmış kurucu başlar; uygulamanın kapanmasını bekleyerek yeni sürümü yükler ve programı tekrar açar.

İnternet, indirme veya doğrulama hatası mevcut uygulama dosyalarını değiştirmez. Kurulum sırasında işletim sistemi veya disk hatası olursa doğrulanmış tam kurucu yeniden çalıştırılabilir. Mevcut taslaklar ve proje yedekleri program klasörünün dışındadır. Yalnızca bu akışta oluşturulan son üç proje yedeği tutulur. Kurulumun bütün Windows cihazlarında hatasız çalıştığı bu ortamda doğrulanmamıştır.

## Yayıncı için

GitLab hesabı bağlandıktan sonra yalnızca kurulum dosyaları için bir proje kullanılabilir (resmî proje: https://gitlab.com/Turkish_Vito/inkreel). Kaynak kodunu veya imza anahtarını herkese açmak gerekmez. Varsayılan public-release akışında depodaki kurucuların bağlantısı herkese açıktır; özel erişim isteyen dağıtım ayrıca tasarlanmalıdır. Şifre veya kişisel erişim anahtarı uygulamaya eklenmez.

Her yeni sürüm için:

1. Uygulama sürümünü ve sayısal yayın sırasını artır, test et ve kurucuyu üret.
2. Aynı özel Ed25519 anahtarıyla `latest.json` oluştur.
3. Kurucu ve `latest.json` dosyasını aynı GitLab sürümüne (release) yükle. Manifestin işaret ettiği sürümlü kurucu dosyasını değiştirme.
4. Yüklenen dosyaları yeniden indirip imza ve hash eşleşmesini kontrol et.
5. Önce birkaç test bilgisayarında eski sürümden yeni sürüme geçişi dene.

Örnek hazırlama komutu (`--publish` olmadan GitLab'a yazmaz):

```sh
node scripts/prepare-release.cjs --repo Turkish_Vito/inkreel --installer installer/out/Bulten-Studio-3.1.0-Setup.exe --version 3.1.0 --sequence 30100 --key /GUVENLI/KONUM/private-key.pem --out release/v3.1.0
```

Yayın dosyaları incelendikten sonra aynı komuta `--publish` eklenebilir. Bu, oturum açılmış GitLab CLI (`glab release create`) ile yalnızca açıkça belirtilen kurucu ve manifesti yükler. GitLab erişimi (`glab auth login`) bu komutun çalıştığı ortamda kullanıcı hesabıyla doğrulanmış olmalıdır.

## İmza anahtarının devamlılığı

Eski Windows imza özel anahtarı bu depoda bulunmaz. Örneklerdeki `/GUVENLI/KONUM/private-key.pem` yolu, mevcut anahtarın güvenli konumu için yer tutucudur. Anahtar ve şifreler kaynak ZIP'e, uygulamaya veya public GitLab projesine eklenmez. Anahtar kaybolursa kurulu 3.1 uygulamaları yeni bir anahtarla imzalanmış güncellemeleri kabul etmez; elle yeni kurulum gerekir.

Canlı dağıtımdan önce özel anahtar kullanıcıya ait güvenli bir yedek alanına veya yetkileri sınırlı bir yayın sırrı deposuna aktarılmalıdır. GitLab CI/CD değişkenleri (masked ve protected) kullanılacaksa anahtar gizli değişken olarak tutulur; dosya veya release asset olarak yüklenmez. Anahtarın yedeklenmesi ve GitLab erişimi henüz tamamlanmadıysa bu sürüm yayın altyapısı hazır olsa da aktif bir uzaktan güncelleme hizmeti değildir.
