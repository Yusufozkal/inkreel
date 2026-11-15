'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const platform = process.argv[2] || 'win32';
const nozip = process.argv.includes('--nozip');
if (!['win32', 'linux'].includes(platform)) throw new Error('Use win32 or linux.');
if (!process.env.ELECTRON_GET_USE_PROXY && (process.env.HTTPS_PROXY || process.env.HTTP_PROXY)) process.env.ELECTRON_GET_USE_PROXY = '1';

(async () => {
  const { packager } = await import('@electron/packager');
  const pkg = require('../package.json');
  if (!/^\d+\.\d+\.\d+$/.test(pkg.version) || !/^\d+\.\d+\.\d+$/.test(pkg.devDependencies.electron)) throw new Error('Application and Electron versions must be exact stable releases.');
  if (require('electron/package.json').version !== pkg.devDependencies.electron) throw new Error('Install the locked Electron dependency before packaging.');
  for (const file of ['ui/index.html', 'ui/app.js', 'native/main.cjs', 'native/preload.cjs']) await fs.access(path.join(root, file));
  const outputs = await packager({
    dir: root,
    out: path.join(root, 'dist'),
    platform, arch: 'x64', electronVersion: pkg.devDependencies.electron,
    name: 'Karevo', appBundleId: 'com.bultenstudio.app',
    executableName: 'Karevo',
    appVersion: pkg.version, buildVersion: pkg.version,
    appCopyright: pkg.author,
    icon: path.join(root, 'native', platform === 'win32' ? 'icon.ico' : 'icon.png'),
    asar: true, overwrite: true, prune: true,
    ignore: filename => {
      const normalized = '/' + filename.replace(/\\/g, '/').replace(/^\/+/, '');
      return normalized !== '/' && normalized !== '/package.json' && !/^\/(?:ui|native)(?:\/|$)/.test(normalized);
    },
    win32metadata: { CompanyName: pkg.author, FileDescription: pkg.productName, InternalName: 'Karevo', OriginalFilename: 'Karevo.exe', ProductName: pkg.productName }
  });
  const folder = outputs[0];
  if ((await fs.readFile(path.join(folder, 'version'), 'utf8')).trim() !== pkg.devDependencies.electron) throw new Error('Packaged Electron does not match the pinned release.');
  const help = 'KAREVO ' + pkg.version + '\r\n\r\n' +
    (platform === 'win32' ? 'Karevo uygulamasını Masaüstü veya Başlat menüsündeki kısayoldan başlatın. Taşınabilir paket kullanıyorsanız klasörü bütünüyle çıkarın ve Karevo.exe dosyasını açın; EXE dosyasını diğer dosyalardan ayrı taşımayın.\r\nWindows 10/11, 64 bit.\r\n' : 'Klasörü tamamen çıkarın ve Karevo programını başlatın.\n') +
    '\r\nProgram internetsiz çalışır. Projeler .karevo dosyası olarak kaydedilir; önceki .bulten, .netice ve JSON projeleri de açılabilir.\r\nToplu çıktı klasöründeki mevcut dosyalar korunur; ad çakışınca sayı eklenir.\r\n\r\nPaketin Windows Authenticode yayıncı imzası yoktur; Windows yayıncıyı tanımıyor uyarısı gösterebilir. Güncelleme dosyaları ayrıca uygulamadaki sabit açık anahtarla doğrulanır.\r\nBu sürüm Linux üzerinde paketlendi; Windows cihaz testi yapılmadı.\r\n\r\nElectron ve Chromium lisansları LICENSE ve LICENSES.chromium.html dosyalarındadır.\r\nYazı tipi lisansları resources/app.asar içindeki ui/assets/licenses klasöründedir.\r\n';
  await fs.writeFile(path.join(folder, 'BASLANGIC.txt'), help, 'utf8');
  if (nozip) {
    console.log(JSON.stringify({ folder, version: pkg.version, archive: null, reason: '--nozip' }, null, 2));
    return;
  }
  const basename = platform === 'win32' ? `Karevo-${pkg.version}-Windows-x64` : `Karevo-${pkg.version}-Linux-x64`;
  const archive = path.join(root, 'dist', basename + '.zip');
  await fs.rm(archive, { force: true });
  execFileSync('zip', ['-q', '-r', '-9', archive, path.basename(folder)], { cwd: path.dirname(folder), stdio: 'inherit' });
  const digest = crypto.createHash('sha256').update(await fs.readFile(archive)).digest('hex');
  await fs.writeFile(archive + '.sha256', digest + '  ' + path.basename(archive) + '\n');
  console.log(JSON.stringify({ folder, archive, sha256: digest }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
