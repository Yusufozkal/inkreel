/* Build offline browser editions with embedded fonts and legacy-project photo. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),ui=path.join(root,'ui'),out=path.join(root,'dist');
const version=require('../package.json').version,prefix='Karevo-Tarayici/';
const entries=new Map();
function collect(directory){for(const name of fs.readdirSync(directory)){const filename=path.join(directory,name);if(fs.statSync(filename).isDirectory())collect(filename);else entries.set(path.relative(ui,filename).split(path.sep).join('/'),fs.readFileSync(filename));}}
collect(ui);
const photo='data:image/jpeg;base64,'+entries.get('assets/erdogan-innovation.jpg').toString('base64');
let core=entries.get('core.js').toString('utf8');
const needle='image.src = source;';
if(!core.includes(needle))throw Error('Review core image loader before embedding legacy photo.');
core=core.replace(needle,'image.src = source === LEGACY_PHOTO ? '+JSON.stringify(photo)+' : source;');
entries.set('core.js',Buffer.from(core));
let app=entries.get('app.js').toString('utf8');
const preview="$('photoPreview').src=b.state.photo;";
if(!app.includes(preview))throw Error('Review legacy photo preview embedding.');
app=app.replace(preview,"$('photoPreview').src=b.state.photo===C.LEGACY_PHOTO?"+JSON.stringify(photo)+':b.state.photo;');
entries.set('app.js',Buffer.from(app));
const fonts=entries.get('fonts.css').toString('utf8').replace(/url\(\.\/assets\/([^)]+)\)/g,(_match,name)=>'url(data:font/ttf;base64,'+entries.get('assets/'+name).toString('base64')+')');
entries.set('fonts.css',Buffer.from(fonts));
let html=entries.get('index.html').toString('utf8');
html=html.replace(/src="assets\/karevo-icon\.png"/g,'src="data:image/png;base64,'+entries.get('assets/karevo-icon.png').toString('base64')+'"');
html=html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/,'<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'; img-src data: blob:; font-src data:; media-src blob:; connect-src \'none\'; object-src \'none\'; base-uri \'none\'">');
html=html.replace(/<link rel="stylesheet" href="([^"]+)">/g,(_match,name)=>'<style>'+entries.get(name).toString('utf8').replace(/<\/style/gi,'<\\/style')+'</style>');
html=html.replace(/<script src="([^"]+)"><\/script>/g,(_match,name)=>'<script>'+entries.get(name).toString('utf8').replace(/<\/script/gi,'<\\/script')+'</script>');
if(/<script[^>]*\bsrc=|<link[^>]*\bhref=/.test(html))throw Error('Standalone build contains an external resource.');
const licenses=['barlowcondensed-OFL.txt','manrope-OFL.txt'].map(name=>'FONT LICENSE: '+name+'\n'+entries.get('assets/licenses/'+name).toString('utf8')).join('\n\n');
html=html.replace('</head>','<!-- '+licenses.replace(/-->/g,'-- >')+' -->\n</head>');
fs.mkdirSync(out,{recursive:true});
function write(name,bytes){const filename=path.join(out,name);fs.writeFileSync(filename,bytes);const sha256=crypto.createHash('sha256').update(bytes).digest('hex');fs.writeFileSync(filename+'.sha256',sha256+'  '+name+'\n');return{output:filename,bytes:bytes.length,sha256};}
const single=write('Karevo.html',Buffer.from(html));
const files=[...entries].map(([name,bytes])=>({name:prefix+name,bytes}));
files.push({name:'BASLANGIC.txt',bytes:Buffer.from('KAREVO '+version+' — TARAYICI SÜRÜMÜ\r\n\r\nZIP dosyasını tamamen çıkarın. Karevo-Tarayici klasöründeki index.html dosyasını güncel Chrome veya Edge ile açın. İnternetsiz çalışır.\r\n\r\nMarka: Her yayıncı için logo, renk, yazı tipi ve hesap bilgileri kaydedin. Profiller proje dosyasında saklanır.\r\nŞablonlar: Açık tasarımın düzenini tekrar kullanmak için kendi koleksiyonunuza ekleyin.\r\nProjeler: CSV’den haber üret ile yerel fotoğrafları dosya adlarıyla eşleştirin; önce önizleyin.\r\nYayın paneli: Açıklama, alternatif metin, kaynak, tarih ve durum ekleyin. Planı CSV veya takvim için ICS indirin. Bu plan otomatik paylaşım yapmaz.\r\nAnimasyon: Açık tasarımı 5–15 saniyelik sessiz animasyona dönüştürün. MP4/WebM seçenekleri cihazın kodlayıcısına bağlıdır. Kayıt sırasında pencere görünür kalmalıdır.\r\n\r\nVideo düzenle: Cihazındaki MP4/WebM klibini kes, kadrajını ve sesini düzenle, yazı ekle ve en fazla 60 saniyelik çıktı kaydet. Video oturumu haber projesine gömülmez; sonucu ayrıca dışa aktar.\r\n\r\nKaydet, tüm fotoğrafları, markaları, şablonları ve çalışmaları içeren .karevo dosyası indirir. Eski .bulten ve .netice projeleri açılabilir. Tarayıcı kaydına ek olarak proje dosyanızı yedekleyin.\r\nTekli görseller PNG/JPG, toplu çıktılar ZIP olarak indirilir.\r\nFont lisansları assets/licenses klasöründedir.\r\n')});
const table=new Uint32Array(256);for(let i=0;i<256;i++){let n=i;for(let j=0;j<8;j++)n=n&1?0xedb88320^(n>>>1):n>>>1;table[i]=n>>>0;}
function crc(data){let n=0xffffffff;for(const b of data)n=table[(n^b)&255]^(n>>>8);return(n^0xffffffff)>>>0;}
const locals=[],centrals=[];let offset=0;
for(const file of files){const name=Buffer.from(file.name),data=zlib.deflateRawSync(file.bytes,{level:9}),checksum=crc(file.bytes),local=Buffer.alloc(30),central=Buffer.alloc(46);local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(20,4);local.writeUInt16LE(0x800,6);local.writeUInt16LE(8,8);local.writeUInt32LE(checksum,14);local.writeUInt32LE(data.length,18);local.writeUInt32LE(file.bytes.length,22);local.writeUInt16LE(name.length,26);central.writeUInt32LE(0x02014b50,0);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt16LE(0x800,8);central.writeUInt16LE(8,10);central.writeUInt32LE(checksum,16);central.writeUInt32LE(data.length,20);central.writeUInt32LE(file.bytes.length,24);central.writeUInt16LE(name.length,28);central.writeUInt32LE(offset,42);locals.push(local,name,data);centrals.push(central,name);offset+=local.length+name.length+data.length;}
const directorySize=centrals.reduce((n,b)=>n+b.length,0),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(files.length,8);end.writeUInt16LE(files.length,10);end.writeUInt32LE(directorySize,12);end.writeUInt32LE(offset,16);
const archive=write(`Karevo-${version}-Tarayici.zip`,Buffer.concat([...locals,...centrals,end]));console.log(JSON.stringify({single,archive},null,2));
