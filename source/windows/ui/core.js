/* Inkreel — portable, offline project and storage core. */
(function (root) {
  'use strict';

  const SCHEMA = 'bulten-studio-project';
  const VERSION = 3;
  const DEFAULT_PHOTO = '';
  const LEGACY_PHOTO = 'assets/erdogan-innovation.jpg';
  const MAX_BOARDS = 20;
  const MAX_LAYERS = 20;
  const MAX_BRANDS = 20;
  const MAX_TEMPLATES = 30;
  const MAX_PROJECT_BYTES = 100 * 1024 * 1024;
  const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
  const MAX_IMAGE_PIXELS = 48000000;
  const MAX_PROJECT_PIXELS = 512000000;
  const MAX_IMAGE_DATA = Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 64;
  const FORMATS = Object.freeze({
    portrait: Object.freeze({ width: 1080, height: 1350, label: 'Dikey · 4:5' }),
    square: Object.freeze({ width: 1080, height: 1080, label: 'Kare · 1:1' }),
    story: Object.freeze({ width: 1080, height: 1920, label: 'Hikâye · 9:16' }),
    landscape: Object.freeze({ width: 1920, height: 1080, label: 'Yatay · 16:9' })
  });
  const TEMPLATES = Object.freeze([
    Object.freeze({ id: 'odak', name: 'Odak' }),
    Object.freeze({ id: 'manset', name: 'Manşet' }),
    Object.freeze({ id: 'sade', name: 'Sade' }),
    Object.freeze({ id: 'serit', name: 'Şerit' }),
    Object.freeze({ id: 'bulten', name: 'Editoryal' }),
    Object.freeze({ id: 'alinti', name: 'Alıntı' })
  ]);
  const FONTS = Object.freeze(['Barlow Condensed', 'Manrope', 'Arial', 'Georgia']);
  const DEFAULTS = Object.freeze({
    template: 'odak', format: 'portrait', headline: 'Haber başlığını\nburaya yaz',
    highlight: '', subtitle: 'GÜNCEL GELİŞMELER', category: 'GÜNDEM',
    source: '', location: '', handle: '@hesabiniz',
    brandName: 'MARKANIZ', brandLabel: 'HABER', tagline: 'GÜNCEL VE GÜVENİLİR', brandMark: 'M',
    accent: '#a294ff', background: '#152136', showBrand: true, showFooter: true,
    showQuote: false, quoteOpacity: 0.10, fontSize: 108, fontFamily: 'Barlow Condensed',
    photoZoom: 1, photoX: 0, photoY: 0, fit: 'cover', brightness: 0, contrast: 0,
    bw: false, showSecond: false, secondZoom: 1, secondX: 0, secondY: 0,
    photo: DEFAULT_PHOTO, second: '', logo: ''
  });
  const LEGACY_DEFAULTS = Object.freeze({
    ...DEFAULTS, headline: "Türkiye'nin\ninovasyon\ngündemi", highlight: 'inovasyon',
    subtitle: 'TÜRKİYE İNOVASYON HAFTASI', source: 'Fotoğraf: İletişim Başkanlığı',
    location: 'TÜRKİYE', handle: '@neticehaber', photo: LEGACY_PHOTO,
    accent: '#ff7548', background: '#111d31',
    brandName: 'netice', brandLabel: 'HABER', tagline: 'HABERİN NET HALİ.', brandMark: 'N'
  });
  const POST_DEFAULTS = Object.freeze({ caption: '', altText: '', sourceUrl: '', publishAt: '', status: 'draft' });
  const BRAND_FIELDS = Object.freeze(['brandName', 'brandLabel', 'tagline', 'brandMark', 'handle', 'location', 'accent', 'background', 'fontFamily', 'logo']);

  function own(value, key) { return Object.prototype.hasOwnProperty.call(value, key); }
  function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
  function clone(value) {
    if (value === undefined || value === null) return value;
    if (typeof root.structuredClone === 'function') return root.structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }
  function id(prefix) {
    const label = String(prefix || 'item').replace(/[^a-z0-9_-]/gi, '').slice(0, 24) || 'item';
    let suffix;
    try {
      const bytes = new Uint32Array(3);
      root.crypto.getRandomValues(bytes);
      suffix = Array.from(bytes, n => n.toString(36)).join('');
    } catch (_) { suffix = Date.now().toString(36) + Math.random().toString(36).slice(2, 12); }
    return label + '-' + suffix;
  }
  function number(value, fallback, min, max) {
    return typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
  }
  function text(value, fallback, max) {
    return typeof value === 'string' ? value.replace(/\u0000/g, '').slice(0, max) : fallback;
  }
  function bool(value, fallback) { return typeof value === 'boolean' ? value : fallback; }
  function color(value, fallback) { return typeof value === 'string' && /^#[a-f\d]{6}$/i.test(value) ? value.toLowerCase() : fallback; }
  function choice(value, allowed, fallback) { return allowed.includes(value) ? value : fallback; }
  function dimensions(format) {
    const d = own(FORMATS, format) ? FORMATS[format] : FORMATS.portrait;
    return { width: d.width, height: d.height };
  }
  // Inspect compressed headers before handing an untrusted image to the browser.
  // A small, flat PNG can otherwise expand to gigabytes despite the byte limit.
  function imageInfo(length, byte) {
    const word = (offset, size, little) => {
      let value = 0;
      for (let n = 0; n < size; n++) value = value * 256 + byte(offset + (little ? size - n - 1 : n));
      return value;
    };
    const tag = (offset, value) => offset + value.length <= length && Array.from(value).every((char, n) => byte(offset + n) === char.charCodeAt(0));
    let width = 0, height = 0, frames = 1;
    if (length < 8) return null; // Truncated files are reported by the decoder.
    if (tag(0, '\x89PNG\r\n\x1a\n')) {
      if (length < 24) return null;
      if (word(8, 4) !== 13 || !tag(12, 'IHDR')) throw new Error('Görselin PNG başlığı geçersiz.');
      width = word(16, 4); height = word(20, 4);
      let actualFrames = 0;
      for (let offset = 8; offset + 12 <= length;) {
        const size = word(offset, 4);
        if (size > length - offset - 12) break;
        if (offset !== 8 && tag(offset + 4, 'IHDR')) throw new Error('Görselin PNG başlığı belirsiz.');
        if (tag(offset + 4, 'acTL') && size >= 8) frames = Math.max(frames, word(offset + 8, 4));
        if (tag(offset + 4, 'fcTL')) {
          if (size !== 26 || word(offset + 20, 4) + word(offset + 12, 4) > width || word(offset + 24, 4) + word(offset + 16, 4) > height) throw new Error('Görselin PNG kare boyutları geçersiz.');
          actualFrames++;
        }
        offset += size + 12;
      }
      frames = Math.max(frames, actualFrames);
    } else if (byte(0) === 255 && byte(1) === 216 && byte(2) === 255) {
      for (let offset = 2; offset + 3 < length;) {
        if (byte(offset++) !== 255) break;
        while (offset < length && byte(offset) === 255) offset++;
        const marker = byte(offset++);
        if (marker === 217 || marker === 218) break;
        if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
        const size = word(offset, 2);
        if (size < 2 || size > length - offset) break;
        if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker) && size >= 8) {
          height = word(offset + 3, 2); width = word(offset + 5, 2); break;
        }
        offset += size;
      }
      if (!width || !height) throw new Error('Görselin JPG başlığı geçersiz.');
    } else if (tag(0, 'RIFF') && tag(8, 'WEBP')) {
      if (word(4, 4, true) + 8 !== length) throw new Error('Görselin WebP kapsayıcısı geçersiz.');
      let extended = false, raster = false;
      const rasterSize = (offset, payload, size) => {
        if (tag(offset, 'VP8L') && size >= 5 && byte(payload) === 47) {
          const bits = word(payload + 1, 4, true);
          return { width: 1 + (bits & 16383), height: 1 + ((bits >>> 14) & 16383) };
        }
        if (tag(offset, 'VP8 ') && size >= 10 && tag(payload + 3, '\x9d\x01\x2a')) return { width: word(payload + 6, 2, true) & 16383, height: word(payload + 8, 2, true) & 16383 };
        return null;
      };
      for (let offset = 12; offset + 8 <= length;) {
        const size = word(offset + 4, 4, true), payload = offset + 8;
        if (size + (size % 2) > length - payload) throw new Error('Görselin WebP kapsayıcısı geçersiz.');
        if (tag(offset, 'VP8X')) {
          if (extended || offset !== 12 || size !== 10) throw new Error('Görselin WebP başlığı belirsiz.');
          extended = true; width = 1 + word(payload + 4, 3, true); height = 1 + word(payload + 7, 3, true);
        } else if (tag(offset, 'VP8L') || tag(offset, 'VP8 ')) {
          const dimensions = rasterSize(offset, payload, size);
          if (raster || !dimensions || (extended && (dimensions.width !== width || dimensions.height !== height))) throw new Error('Görselin WebP başlığı belirsiz.');
          raster = true; width = dimensions.width; height = dimensions.height;
        } else if (tag(offset, 'ANMF')) {
          if (!extended || size < 16) throw new Error('Görselin WebP başlığı geçersiz.');
          const frameWidth = 1 + word(payload + 6, 3, true), frameHeight = 1 + word(payload + 9, 3, true);
          if (word(payload, 3, true) * 2 + frameWidth > width || word(payload + 3, 3, true) * 2 + frameHeight > height) throw new Error('Görselin WebP kare boyutları geçersiz.');
          for (let inner = payload + 16; inner + 8 <= payload + size;) {
            const frameBytes = word(inner + 4, 4, true), framePayload = inner + 8;
            if (frameBytes + (frameBytes % 2) > payload + size - framePayload) throw new Error('Görselin WebP karesi geçersiz.');
            if (tag(inner, 'VP8 ') || tag(inner, 'VP8L')) {
              const dimensions = rasterSize(inner, framePayload, frameBytes);
              if (!dimensions || dimensions.width !== frameWidth || dimensions.height !== frameHeight) throw new Error('Görselin WebP kare boyutları geçersiz.');
            }
            inner = framePayload + frameBytes + (frameBytes % 2);
          }
          frames++;
        }
        if (width * height > MAX_IMAGE_PIXELS) throw new Error('Bu görselin çözünürlüğü çok büyük. Önce daha küçük bir kopya oluşturun.');
        offset = payload + size + (size % 2);
      }
      if (!width || !height) throw new Error('Görselin WebP başlığı geçersiz.');
      // The initial frame count is one for still images, zero for animation.
      if (frames > 1) frames--;
    } else throw new Error('JPG, PNG veya WebP biçiminde bir görsel seçin.');
    if (!width || !height || width * height * frames > MAX_IMAGE_PIXELS) throw new Error('Bu görselin çözünürlüğü çok büyük. Önce daha küçük bir kopya oluşturun.');
    return { width, height, pixels: width * height * frames };
  }
  function embeddedImageInfo(source) {
    if (!source || source === LEGACY_PHOTO) return null;
    const start = source.indexOf(',') + 1, payloadLength = source.length - start;
    const padding = source.endsWith('==') ? 2 : source.endsWith('=') ? 1 : 0;
    const length = Math.floor(payloadLength * 3 / 4) - padding;
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const digit = index => alphabet.indexOf(source[index]);
    return imageInfo(length, index => {
      const offset = start + Math.floor(index / 3) * 4, part = index % 3;
      return (part === 0 ? (digit(offset) << 2) | (digit(offset + 1) >> 4) : part === 1 ? (digit(offset + 1) << 4) | (digit(offset + 2) >> 2) : (digit(offset + 2) << 6) | digit(offset + 3)) & 255;
    });
  }
  function mediaPixels(sources, maximum) {
    let pixels = 0;
    for (const source of new Set(sources)) {
      const info = embeddedImageInfo(source);
      pixels += info ? info.pixels : 0;
      if (pixels > maximum) throw new Error('Projede çok fazla yüksek çözünürlüklü görsel var. Fotoğraf veya tasarım sayısını azaltın.');
    }
    return pixels;
  }
  function boardImages(board) { return [board.state.photo, board.state.second, board.state.logo, ...board.layers.filter(layer => layer.type === 'image').map(layer => layer.src)]; }
  function safeImage(source, fallback) {
    if (typeof source !== 'string') return fallback;
    if (source === '' || source === LEGACY_PHOTO) return source;
    if (source.length > MAX_IMAGE_DATA) throw new Error('Projede 20 MB sınırını aşan bir görsel var. Görseli küçültüp yeniden ekleyin.');
    if (!/^data:image\/(?:png|jpeg|webp);base64,[a-z\d+/]+={0,2}$/i.test(source)) {
      throw new Error('Projedeki görsel kaynağı güvenli değil. Yalnızca dosyaya gömülü JPG, PNG ve WebP görselleri kullanılabilir.');
    }
    const payloadLength = source.length - source.indexOf(',') - 1;
    const padding = source.endsWith('==') ? 2 : source.endsWith('=') ? 1 : 0;
    if (Math.floor(payloadLength * 3 / 4) - padding > MAX_IMAGE_BYTES) throw new Error('Projede 20 MB sınırını aşan bir görsel var. Görseli küçültüp yeniden ekleyin.');
    embeddedImageInfo(source);
    return source;
  }
  function uniqueId(value, prefix, used) {
    let result = typeof value === 'string' && /^[a-z\d_-]{1,80}$/i.test(value) ? value : id(prefix);
    while (used.has(result)) result = id(prefix);
    used.add(result);
    return result;
  }
  function normalizeState(raw, options) {
    const input = object(raw) ? raw : {};
    const defaults = options && options.legacy ? LEGACY_DEFAULTS : DEFAULTS;
    const state = { ...defaults };
    state.template = choice(input.template, TEMPLATES.map(t => t.id), defaults.template);
    state.format = own(FORMATS, input.format) ? input.format : defaults.format;
    for (const [key, length] of Object.entries({ headline: 500, highlight: 500, subtitle: 200, category: 80, source: 300, location: 100, handle: 100, brandName: 60, brandLabel: 60, tagline: 100, brandMark: 3 })) {
      state[key] = text(input[key], defaults[key], length);
    }
    for (const key of ['accent', 'background']) state[key] = color(input[key], defaults[key]);
    for (const key of ['showBrand', 'showFooter', 'showQuote', 'bw', 'showSecond']) state[key] = bool(input[key], defaults[key]);
    state.quoteOpacity = number(input.quoteOpacity, defaults.quoteOpacity, 0, 1);
    state.fontSize = number(input.fontSize, defaults.fontSize, 28, 240);
    state.fontFamily = choice(input.fontFamily, FONTS, defaults.fontFamily);
    for (const key of ['photoZoom', 'secondZoom']) state[key] = number(input[key], defaults[key], 0.25, 6);
    for (const key of ['photoX', 'photoY', 'secondX', 'secondY']) state[key] = number(input[key], defaults[key], -12000, 12000);
    for (const key of ['brightness', 'contrast']) state[key] = number(input[key], defaults[key], -50, 50);
    state.fit = choice(input.fit, ['cover', 'contain'], defaults.fit);
    for (const key of ['photo', 'second', 'logo']) state[key] = safeImage(input[key], defaults[key]);
    return state;
  }
  function createLayer(type, format) {
    if (!['text', 'rect', 'image'].includes(type)) throw new Error('Bu katman türü desteklenmiyor.');
    const d = dimensions(format);
    const w = type === 'text' ? Math.round(d.width * 0.65) : type === 'rect' ? Math.round(d.width * 0.45) : Math.round(d.width * 0.4);
    const h = type === 'text' ? 170 : type === 'rect' ? 110 : Math.round(w * 0.75);
    return {
      id: id('layer'), type, name: type === 'text' ? 'Metin' : type === 'rect' ? 'Şekil' : 'Görsel',
      x: Math.round((d.width - w) / 2), y: Math.round((d.height - h) / 2), w, h,
      rotation: 0, opacity: 1, visible: true, locked: false,
      text: type === 'text' ? 'Yeni metin' : '', color: '#ffffff', fill: '#ff7548',
      fontSize: 64, fontFamily: 'Manrope', fontWeight: 700, align: 'left',
      stroke: '#ffffff', strokeWidth: 0, src: '', fit: 'cover', radius: 0
    };
  }
  function normalizeLayer(raw, format, used) {
    if (!object(raw) || !['text', 'rect', 'image'].includes(raw.type)) throw new Error('Projede desteklenmeyen bir katman var.');
    const layer = createLayer(raw.type, format);
    layer.id = uniqueId(raw.id, 'layer', used);
    layer.name = text(raw.name, layer.name, 100).trim() || layer.name;
    for (const key of ['x', 'y']) layer[key] = number(raw[key], layer[key], -12000, 12000);
    for (const key of ['w', 'h']) layer[key] = number(raw[key], layer[key], 4, 12000);
    layer.rotation = number(raw.rotation, 0, -360, 360);
    layer.opacity = number(raw.opacity, 1, 0, 1);
    layer.visible = bool(raw.visible, true);
    layer.locked = bool(raw.locked, false);
    layer.text = text(raw.text, layer.text, 2000);
    layer.color = color(raw.color, layer.color);
    layer.fill = color(raw.fill, layer.fill);
    layer.stroke = color(raw.stroke, layer.stroke);
    layer.fontSize = number(raw.fontSize, layer.fontSize, 8, 500);
    layer.fontFamily = choice(raw.fontFamily, FONTS, layer.fontFamily);
    layer.fontWeight = Math.round(number(raw.fontWeight, layer.fontWeight, 100, 900) / 100) * 100;
    layer.align = choice(raw.align, ['left', 'center', 'right'], layer.align);
    layer.strokeWidth = number(raw.strokeWidth, 0, 0, 80);
    layer.src = safeImage(raw.src, '');
    layer.fit = choice(raw.fit, ['cover', 'contain'], layer.fit);
    layer.radius = number(raw.radius, 0, 0, 3000);
    return layer;
  }
  function normalizePost(raw) {
    const input = object(raw) ? raw : {};
    const post = {
      caption: text(input.caption, '', 5000), altText: text(input.altText, '', 2000),
      sourceUrl: text(input.sourceUrl, '', 2000).trim(), publishAt: text(input.publishAt, '', 30).trim(),
      status: choice(input.status, ['draft', 'ready', 'published'], 'draft')
    };
    if (post.sourceUrl) {
      let valid = false;
      try {
        const url = new root.URL(post.sourceUrl);
        valid = url.protocol === 'https:' && !!url.hostname && !url.username && !url.password && !/[\u0000-\u0020\u007f\\]/.test(post.sourceUrl);
      } catch (_) { /* Report the same readable validation error below. */ }
      if (!valid) throw new Error('Kaynak bağlantısı https:// ile başlayan geçerli bir adres olmalı.');
    }
    if (post.publishAt) {
      const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(post.publishAt);
      let valid = false;
      if (parts) {
        const values = parts.slice(1).map(value => Number(value || 0));
        const [year, month, day, hour, minute, second] = values;
        const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
        valid = year >= 1000 && date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day && date.getUTCHours() === hour && date.getUTCMinutes() === minute && date.getUTCSeconds() === second;
      }
      if (!valid) throw new Error('Yayın zamanı geçerli bir tarih ve saat olmalı.');
    }
    return post;
  }
  function normalizeBoard(raw, index, used, options) {
    if (!object(raw)) throw new Error('Projedeki tasarım bilgileri okunamadı.');
    const state = normalizeState(raw.state, options);
    const layers = raw.layers === undefined ? [] : raw.layers;
    if (!Array.isArray(layers)) throw new Error('Tasarım katmanları okunamadı.');
    if (layers.length > MAX_LAYERS) throw new Error('Bir tasarımda en fazla 20 ek katman olabilir.');
    const board = {
      id: uniqueId(raw.id, 'board', used),
      name: text(raw.name, 'Tasarım ' + (index + 1), 100).trim() || 'Tasarım ' + (index + 1),
      state, layers: layers.map(layer => normalizeLayer(layer, state.format, used)), post: normalizePost(raw.post)
    };
    mediaPixels(boardImages(board), MAX_IMAGE_PIXELS);
    return board;
  }
  function normalizeBrand(raw, used) {
    if (!object(raw)) throw new Error('Marka profili okunamadı.');
    const state = normalizeState(raw);
    const brand = {
      id: uniqueId(raw.id, 'brand', used),
      name: text(raw.name, 'Yeni marka', 100).trim() || 'Yeni marka'
    };
    for (const field of BRAND_FIELDS) brand[field] = state[field];
    return brand;
  }
  function createBrand(state, name) {
    const input = normalizeState(state);
    const brand = { id: id('brand'), name: text(name, input.brandName || 'Yeni marka', 100).trim() || 'Yeni marka' };
    for (const field of BRAND_FIELDS) brand[field] = input[field];
    return brand;
  }
  function applyBrand(board, brand) {
    if (!object(board) || !object(board.state)) throw new Error('Marka uygulanacak tasarım bulunamadı.');
    const profile = normalizeBrand(brand, new Set());
    for (const field of BRAND_FIELDS) board.state[field] = profile[field];
    return board;
  }
  function createTemplate(board, name, category) {
    const snapshot = normalizeBoard(board, 0, new Set());
    snapshot.id = id('board');
    for (const layer of snapshot.layers) layer.id = id('layer');
    return {
      id: id('template'), name: text(name, board.name || 'Yeni şablon', 100).trim() || 'Yeni şablon',
      category: text(category, '', 60).trim(), board: snapshot
    };
  }
  function boardFromTemplate(template) {
    if (!object(template) || !object(template.board)) throw new Error('Şablon bilgileri okunamadı.');
    const board = normalizeBoard(template.board, 0, new Set());
    board.id = id('board');
    for (const layer of board.layers) layer.id = id('layer');
    return board;
  }
  function createBoard(format, template) {
    const state = { ...DEFAULTS };
    state.format = own(FORMATS, format) ? format : DEFAULTS.format;
    state.template = choice(template, TEMPLATES.map(t => t.id), DEFAULTS.template);
    return { id: id('board'), name: 'Yeni tasarım', state, layers: [], post: { ...POST_DEFAULTS } };
  }
  function createProject() {
    const board = createBoard();
    board.name = 'İlk haber';
    return {
      schema: SCHEMA, version: VERSION, name: 'Yeni haber projesi', updated: Date.now(),
      activeId: board.id, boards: [board], brands: [], activeBrandId: null, templates: []
    };
  }
  function normalizeProject(raw) {
    if (!object(raw) || ![SCHEMA, 'netice-studio-project'].includes(raw.schema)) throw new Error('Bu dosya bir Inkreel projesi değil.');
    const legacy = raw.schema === 'netice-studio-project';
    if (raw.version !== (legacy ? 2 : VERSION)) throw new Error('Bu proje sürümü desteklenmiyor. Inkreel sürüm 3 veya eski Netice sürüm 2 proje dosyası seçin.');
    if (!Array.isArray(raw.boards) || !raw.boards.length) throw new Error('Proje en az bir tasarım içermeli.');
    if (raw.boards.length > MAX_BOARDS) throw new Error('Bir projede en fazla 20 tasarım olabilir.');
    const brandInputs = raw.brands === undefined ? [] : raw.brands;
    const templateInputs = raw.templates === undefined ? [] : raw.templates;
    if (!Array.isArray(brandInputs)) throw new Error('Projenin marka profilleri okunamadı.');
    if (!Array.isArray(templateInputs)) throw new Error('Projenin kayıtlı şablonları okunamadı.');
    if (brandInputs.length > MAX_BRANDS) throw new Error('Bir projede en fazla 20 marka profili olabilir.');
    if (templateInputs.length > MAX_TEMPLATES) throw new Error('Bir projede en fazla 30 kayıtlı şablon olabilir.');
    const used = new Set();
    const boards = raw.boards.map((input, index) => normalizeBoard(input, index, used, { legacy }));
    const brands = brandInputs.map(input => normalizeBrand(input, used));
    const templates = templateInputs.map(input => {
      if (!object(input)) throw new Error('Kayıtlı şablon bilgileri okunamadı.');
      return {
        id: uniqueId(input.id, 'template', used),
        name: text(input.name, 'Yeni şablon', 100).trim() || 'Yeni şablon',
        category: text(input.category, '', 60).trim(), board: normalizeBoard(input.board, 0, used, { legacy })
      };
    });
    mediaPixels([...boards.flatMap(boardImages), ...templates.flatMap(template => boardImages(template.board)), ...brands.map(brand => brand.logo)], MAX_PROJECT_PIXELS);
    const activeBoardIndex = raw.boards.findIndex(board => object(board) && board.id === raw.activeId);
    const activeBrandIndex = brandInputs.findIndex(brand => object(brand) && brand.id === raw.activeBrandId);
    const project = {
      schema: SCHEMA, version: VERSION,
      name: text(raw.name, 'Yeni haber projesi', 160).trim() || 'Yeni haber projesi',
      updated: number(raw.updated, Date.now(), 0, 8640000000000000),
      activeId: boards[activeBoardIndex >= 0 ? activeBoardIndex : 0].id,
      boards, brands, activeBrandId: activeBrandIndex >= 0 ? brands[activeBrandIndex].id : null, templates
    };
    let contentLength = 0;
    const count = value => {
      if (typeof value === 'string') contentLength += value.length;
      else if (Array.isArray(value)) value.forEach(count);
      else if (object(value)) Object.values(value).forEach(count);
    };
    count(project);
    if (contentLength > MAX_PROJECT_BYTES) throw new Error('Proje dosyası 100 MB sınırını aşıyor. Fotoğraf, şablon veya tasarım sayısını azaltın.');
    return project;
  }
  function serialize(project) {
    const output = JSON.stringify(normalizeProject(project));
    if (output.length > MAX_PROJECT_BYTES || byteLength(output) > MAX_PROJECT_BYTES) throw new Error('Proje dosyası 100 MB sınırını aşıyor. Fotoğraf veya tasarım sayısını azaltın.');
    return output;
  }
  function byteLength(value) {
    if (typeof root.TextEncoder === 'function') return new root.TextEncoder().encode(value).length;
    return unescape(encodeURIComponent(value)).length;
  }
  function parse(source) {
    if (typeof source !== 'string') throw new Error('Proje dosyası metin biçiminde okunamadı.');
    if (source.length > MAX_PROJECT_BYTES || byteLength(source) > MAX_PROJECT_BYTES) throw new Error('Proje dosyası en fazla 100 MB olabilir.');
    let raw;
    // UTF-8 text editors may prefix JSON with a byte-order mark. FileReader
    // removes it, while native/Android text readers may preserve it.
    try { raw = JSON.parse(source.charCodeAt(0) === 0xfeff ? source.slice(1) : source); } catch (_) { throw new Error('Proje dosyası bozuk veya geçerli JSON içermiyor.'); }
    return normalizeProject(raw);
  }

  const mediaCache = new Map();
  let decodeTail = Promise.resolve();
  function trimDecodedCache(incomingPixels) {
    let pixels = incomingPixels;
    for (const entry of mediaCache.values()) if (entry.ready) pixels += entry.pixels;
    for (const [key, entry] of mediaCache) {
      if (pixels <= MAX_IMAGE_PIXELS) break;
      if (entry.ready) { pixels -= entry.pixels; mediaCache.delete(key); }
    }
  }
  function decodeImage(source, pixels) {
    const pending = decodeTail.then(() => {
      // Thumbnail, grid and active-board requests share one decoder. Drop cached
      // decoded surfaces before the next compressed image is submitted.
      trimDecodedCache(pixels || 0);
      return decodeImageNow(source);
    });
    decodeTail = pending.catch(() => {});
    return pending;
  }
  function decodeImageNow(source) {
    return new Promise((resolve, reject) => {
      if (!source) { resolve(null); return; }
      if (typeof root.Image !== 'function') { reject(new Error('Görsel çözücü kullanılamıyor.')); return; }
      const image = new root.Image();
      let timer = setTimeout(() => finish(new Error('Görsel açılırken zaman aşımı oluştu.')), 30000);
      function finish(error) {
        if (!timer) return;
        clearTimeout(timer); timer = null;
        image.onload = image.onerror = null;
        if (error) { image.src = ''; reject(error); return; }
        if (!(image.naturalWidth || image.width) || !(image.naturalHeight || image.height)) reject(new Error('Görselin boyutları okunamadı.'));
        else if ((image.naturalWidth || image.width) * (image.naturalHeight || image.height) > MAX_IMAGE_PIXELS) { image.src = ''; reject(new Error('Bu görselin çözünürlüğü çok büyük. Önce daha küçük bir kopya oluşturun.')); }
        else resolve(image);
      }
      image.onload = () => finish();
      image.onerror = () => finish(new Error('Görsel dosyası açılamadı.'));
      image.src = source;
    });
  }
  function cachedImage(source) {
    if (!source) return Promise.resolve(null);
    if (mediaCache.has(source)) {
      const existing = mediaCache.get(source);
      mediaCache.delete(source); mediaCache.set(source, existing);
      return existing.promise;
    }
    const info = embeddedImageInfo(source);
    const entry = { pixels: info ? info.pixels : 0, promise: null, ready: false };
    entry.promise = decodeImage(source, entry.pixels).then(image => { entry.ready = true; trimDecodedCache(0); return image; }).catch(error => { if (mediaCache.get(source) === entry) mediaCache.delete(source); throw error; });
    mediaCache.set(source, entry);
    while (mediaCache.size > 12) mediaCache.delete(mediaCache.keys().next().value);
    return entry.promise;
  }
  async function loadMedia(board) {
    const input = object(board) ? board : {};
    const state = normalizeState(input.state);
    const result = { photo: null, second: null, logo: null, cropRef: state.photo === LEGACY_PHOTO, layers: Object.create(null), errors: [] };
    const sources = ['photo', 'second', 'logo'].map(key => ({ key, src: state[key], layer: false }));
    for (const layer of Array.isArray(input.layers) ? input.layers.slice(0, MAX_LAYERS) : []) {
      if (object(layer) && layer.type === 'image' && layer.src) sources.push({ key: layer.id, src: safeImage(layer.src, ''), layer: true });
    }
    mediaPixels(sources.map(entry => entry.src), MAX_IMAGE_PIXELS);
    await Promise.all(sources.map(async entry => {
      try {
        const image = await cachedImage(entry.src);
        if (entry.layer) result.layers[entry.key] = image; else result[entry.key] = image;
      } catch (error) {
        result.errors.push({ key: entry.key, message: error.message || 'Görsel açılamadı.' });
        if (entry.layer) result.layers[entry.key] = null;
      }
    }));
    return result;
  }
  async function importImage(file, options) {
    const opts = object(options) ? options : {};
    if (!file || typeof file.size !== 'number') throw new Error('Bir görsel dosyası seçin.');
    if (file.size > MAX_IMAGE_BYTES) throw new Error('Görsel dosyası en fazla 20 MB olabilir.');
    const type = typeof file.type === 'string' ? file.type.toLowerCase() : '';
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(type) && (type || !/\.(?:jpe?g|png|webp)$/i.test(file.name || ''))) {
      throw new Error('JPG, PNG veya WebP biçiminde bir görsel seçin.');
    }
    const maxEdge = Math.round(number(opts.maxEdge, 3000, 128, 6000));
    const transparent = opts.transparent === true;
    if (!root.URL || typeof root.URL.createObjectURL !== 'function' || !root.document) throw new Error('Bu ortamda görsel dosyası açılamıyor.');
    let originalPixels = 0;
    let originalBytes;
    if (typeof file.arrayBuffer === 'function') originalBytes = await file.arrayBuffer();
    else if (typeof root.FileReader === 'function') originalBytes = await new Promise((resolve, reject) => {
      const reader = new root.FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Görsel dosyası okunamadı.'));
      reader.onabort = () => reject(new Error('Görsel dosyası okunamadı.'));
      reader.readAsArrayBuffer(file);
    });
    else if (typeof file.slice === 'function') throw new Error('Görsel dosyası bu ortamda güvenli biçimde okunamıyor.');
    if (originalBytes) {
      const bytes = new Uint8Array(originalBytes);
      const info = imageInfo(bytes.length, index => bytes[index]);
      originalPixels = info ? info.pixels : 0;
    }
    const source = root.URL.createObjectURL(file);
    let canvas;
    try {
      const image = await decodeImage(source, originalPixels);
      const width = image.naturalWidth || image.width, height = image.naturalHeight || image.height;
      if (width * height > MAX_IMAGE_PIXELS) throw new Error('Bu görselin çözünürlüğü çok büyük. Önce daha küçük bir kopya oluşturun.');
      const ratio = Math.min(1, maxEdge / Math.max(width, height));
      canvas = root.document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(width * ratio));
      canvas.height = Math.max(1, Math.round(height * ratio));
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Görsel işleme başlatılamadı.');
      if (!transparent) { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      const output = canvas.toDataURL(transparent ? 'image/png' : 'image/jpeg', 0.92);
      if (!/^data:image\//.test(output)) throw new Error('Görsel dosyası dönüştürülemedi.');
      return safeImage(output, '');
    } finally {
      root.URL.revokeObjectURL(source);
      if (canvas) canvas.width = canvas.height = 1;
    }
  }

  function storageError(error) {
    const name = error && error.name;
    if (name === 'QuotaExceededError') return new Error('Cihaz depolaması dolu. Eski projeleri silin veya proje dosyanızı bilgisayara kaydedin.');
    if (name === 'SecurityError' || name === 'InvalidStateError') return new Error('Yerel depolamaya erişilemiyor. Proje dosyanızı bilgisayara kaydedin.');
    return new Error('Proje depolama işlemi tamamlanamadı. Proje dosyanızı bilgisayara kaydedin.');
  }
  function storageKey(key) {
    if (typeof key !== 'string' || !key || key.length > 200) throw new Error('Geçerli bir proje kayıt anahtarı gerekli.');
    return key;
  }
  function localDatabase() {
    const key = 'bulten-studio-v3';
    function read() {
      try {
        const value = root.localStorage.getItem(key);
        if (!value) return [];
        const records = JSON.parse(value);
        if (!Array.isArray(records)) throw new Error('invalid-records');
        return records;
      } catch (error) { throw storageError(error); }
    }
    function write(records) {
      try { root.localStorage.setItem(key, JSON.stringify(records)); }
      catch (error) { throw storageError(error); }
    }
    return {
      mode: 'localStorage',
      async get(recordKey) { storageKey(recordKey); const record = read().find(row => row.key === recordKey); return record ? clone(record.value) : undefined; },
      async put(recordKey, value) {
        storageKey(recordKey);
        const records = read().filter(row => row.key !== recordKey);
        records.push({ key: recordKey, value: clone(value) }); write(records);
      },
      async remove(recordKey) { storageKey(recordKey); write(read().filter(row => row.key !== recordKey)); },
      async all() { return read().map(row => clone(row.value)); }
    };
  }
  async function openDatabase() {
    let factory;
    try { factory = root.indexedDB; } catch (_) { return localDatabase(); }
    if (!factory) return localDatabase();
    let db;
    try {
      db = await new Promise((resolve, reject) => {
        const request = factory.open('bulten-studio-v3', 1);
        let settled = false;
        const fail = () => { if (!settled) { settled = true; reject(request.error || new Error('storage-blocked')); } };
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains('records')) request.result.createObjectStore('records', { keyPath: 'key' });
        };
        request.onsuccess = () => { if (settled) request.result.close(); else { settled = true; resolve(request.result); } };
        request.onerror = fail;
        request.onblocked = fail;
      });
    } catch (_) { return localDatabase(); }
    db.onversionchange = () => db.close();
    function run(operation, key, value) {
      if (operation !== 'all') storageKey(key);
      return new Promise((resolve, reject) => {
        let tx, result;
        try {
          tx = db.transaction('records', operation === 'get' || operation === 'all' ? 'readonly' : 'readwrite');
          const store = tx.objectStore('records');
          const request = operation === 'get' ? store.get(key) : operation === 'all' ? store.getAll() : operation === 'put' ? store.put({ key, value }) : store.delete(key);
          request.onsuccess = () => { result = request.result; };
          request.onerror = () => reject(storageError(request.error));
          tx.oncomplete = () => resolve(operation === 'all' ? result.map(row => row.value) : operation === 'get' ? result && result.value : undefined);
          tx.onerror = () => reject(storageError(tx.error));
          tx.onabort = () => reject(storageError(tx.error));
        } catch (error) { reject(storageError(error)); }
      });
    }
    return {
      mode: 'indexedDB',
      get: key => run('get', key), put: (key, value) => run('put', key, value),
      remove: key => run('remove', key), all: () => run('all')
    };
  }

  class History {
    constructor(initial) { this.past = []; this.future = []; }
    checkpoint(project) {
      this.past.push(clone(project));
      if (this.past.length > 40) this.past.shift();
      this.future = [];
    }
    undo(current) {
      if (!this.past.length) return null;
      this.future.push(clone(current));
      return clone(this.past.pop());
    }
    redo(current) {
      if (!this.future.length) return null;
      this.past.push(clone(current));
      if (this.past.length > 40) this.past.shift();
      return clone(this.future.pop());
    }
    get canUndo() { return this.past.length > 0; }
    get canRedo() { return this.future.length > 0; }
  }

  const api = Object.freeze({
    SCHEMA, VERSION, DEFAULTS, DEFAULT_PHOTO, LEGACY_PHOTO, FORMATS, TEMPLATES, FONTS,
    MAX_BOARDS, MAX_LAYERS, MAX_BRANDS, MAX_TEMPLATES, MAX_PROJECT_BYTES, POST_DEFAULTS, BRAND_FIELDS,
    projectExtension: 'inkreel',
    createProject, normalizeProject, normalizeState, normalizePost, clone, id, dimensions, createBoard, createLayer,
    createBrand, applyBrand, createTemplate, boardFromTemplate,
    loadMedia, importImage, openDatabase, serialize, parse, History
  });
  root.StudioCore = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
