/* Bülten Studio — local, deterministic Canvas renderer. No startup or network work. */
(function (global) {
  'use strict';
  var WIDTH = 1080;
  var HEIGHTS = { portrait: 1350, square: 1080, story: 1920 };
  var DEFAULTS = {
    template: 'odak', format: 'portrait', headline: 'Haber başlığını\nburaya yaz',
    highlight: '', subtitle: 'GÜNCEL GELİŞMELER', category: 'GÜNDEM',
    brandName: 'MARKANIZ', brandLabel: 'HABER', tagline: 'GÜNCEL VE GÜVENİLİR', brandMark: 'M',
    source: '', location: '', handle: '@hesabiniz', photo: '', accent: '#a294ff',
    background: '#152136', showBrand: true, showFooter: true, showQuote: false,
    quoteOpacity: 0.10, fontSize: 108, fontFamily: 'Barlow Condensed', photoZoom: 1,
    photoX: 0, photoY: 0, fit: 'cover', brightness: 0, contrast: 0, bw: false,
    showSecond: false, secondZoom: 1, secondX: 0, secondY: 0
  };

  function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }
  function number(n, fallback) { n = Number(n); return isFinite(n) ? n : fallback; }
  function color(value, fallback) { return /^#[0-9a-f]{6}$/i.test(value || '') ? value : fallback; }
  function rgba(hex, alpha) {
    var n = parseInt(hex.slice(1), 16);
    return 'rgba(' + [(n >> 16) & 255, (n >> 8) & 255, n & 255, alpha].join(',') + ')';
  }
  function luminance(hex) {
    var n=parseInt(hex.slice(1),16);
    return [n>>16&255,n>>8&255,n&255].map(function(v){v/=255;return v<=0.04045?v/12.92:Math.pow((v+0.055)/1.055,2.4);})
      .reduce(function(sum,v,i){return sum+v*[0.2126,0.7152,0.0722][i];},0);
  }
  function lightBackground(hex) { return luminance(hex)>0.45; }
  function contrastInk(hex) { return lightBackground(hex)?'#172336':'#faf9f5'; }
  function darkInk(hex) { return lightBackground(hex)?'#172336':hex; }
  function readableAccent(accent,background,ink) {
    var a=luminance(accent),b=luminance(background),ratio=(Math.max(a,b)+0.05)/(Math.min(a,b)+0.05);
    return ratio>=2.0?accent:ink;
  }
  function fill(c, ink, x, y, w, h) { c.fillStyle = ink; c.fillRect(x, y, w, h); }
  function roundPath(c, x, y, w, h, radius) {
    var r = Math.max(0, Math.min(radius, w / 2, h / 2));
    c.beginPath();
    if (typeof c.roundRect === 'function') { c.roundRect(x, y, w, h, r); return; }
    c.moveTo(x + r, y); c.lineTo(x + w - r, y);
    c.quadraticCurveTo(x + w, y, x + w, y + r); c.lineTo(x + w, y + h - r);
    c.quadraticCurveTo(x + w, y + h, x + w - r, y + h); c.lineTo(x + r, y + h);
    c.quadraticCurveTo(x, y + h, x, y + h - r); c.lineTo(x, y + r);
    c.quadraticCurveTo(x, y, x + r, y); c.closePath();
  }
  function rounded(c, x, y, w, h, radius, ink) { roundPath(c, x, y, w, h, radius); c.fillStyle = ink; c.fill(); }
  function font(c, size, family, weight) { c.font = (weight || 700) + ' ' + size + 'px "' + family + '",Arial,sans-serif'; }
  function smallText(c, text, x, y, maxWidth, size, ink, weight, family) {
    if (!text) return;
    text = String(text).replace(/[\r\n]+/g, ' ');
    family = family || 'Manrope'; weight = weight || 700;
    var fs = size;
    font(c, fs, family, weight);
    while (fs > 10 && c.measureText(text).width > maxWidth) { fs--; font(c, fs, family, weight); }
    c.fillStyle = ink; c.fillText(text, x, y, maxWidth);
  }
  function imageDimensions(image) {
    return { w: image ? (image.naturalWidth || image.videoWidth || image.width || 0) : 0,
      h: image ? (image.naturalHeight || image.videoHeight || image.height || 0) : 0 };
  }
  function photo(c, image, rect, options) {
    var d = imageDimensions(image), crop = options.cropRef && d.w === 1215 && d.h === 609;
    var sx = crop ? 148 : 0, sw = crop ? 914 : d.w, sh = d.h;
    c.save(); c.beginPath(); c.rect(rect.x, rect.y, rect.w, rect.h); c.clip();
    fill(c, options.background, rect.x, rect.y, rect.w, rect.h);
    var result = { x: rect.x, y: rect.y, w: rect.w, h: rect.h, image: null };
    if (sw && sh) {
      var base = (options.fit === 'contain' ? Math.min : Math.max)(rect.w / sw, rect.h / sh);
      var scale = base * clamp(number(options.zoom, 1), 0.1, 6);
      var dw = sw * scale, dh = sh * scale;
      var dx = rect.x + (rect.w - dw) / 2 + number(options.x, 0);
      // The supplied landscape photograph has a face close to the top edge.
      // Preserve that headroom in short photo windows; user offsets stay in pixels.
      var dy = rect.y + (rect.h - dh) * (crop ? 0.2 : 0.5) + number(options.y, 0);
      if (options.clampCover) {
        dx = clamp(dx, rect.x + rect.w - dw, rect.x);
        dy = clamp(dy, rect.y + rect.h - dh, rect.y);
      }
      if ('filter' in c) c.filter = 'brightness(' + (1 + clamp(number(options.brightness, 0), -50, 50) / 100) + ') contrast(' + (1 + clamp(number(options.contrast, 0), -50, 50) / 100) + ')' + (options.bw ? ' grayscale(1)' : '');
      c.drawImage(image, sx, 0, sw, sh, dx, dy, dw, dh);
      if ('filter' in c) c.filter = 'none';
      result.image = { x: dx, y: dy, w: dw, h: dh };
    } else {
      var gradient = c.createLinearGradient(rect.x, rect.y, rect.x + rect.w, rect.y + rect.h);
      gradient.addColorStop(0, '#263d59'); gradient.addColorStop(1, options.background);
      fill(c, gradient, rect.x, rect.y, rect.w, rect.h);
    }
    c.restore();
    return result;
  }
  function brand(c, s, logo, x, y, ink) {
    if (!s.showBrand) return;
    var d = imageDimensions(logo);
    if (d.w && d.h) {
      var sc = Math.min(360 / d.w, 96 / d.h);
      c.drawImage(logo, x, y + (96 - d.h * sc) / 2, d.w * sc, d.h * sc); return;
    }
    var name=String(s.brandName==null?'':s.brandName).replace(/[\r\n]+/g,' '), size=68;
    font(c,size,'Manrope',800);
    while(size>12&&c.measureText(name).width>342){size--;font(c,size,'Manrope',800);}
    c.fillStyle=ink;c.fillText(name,x,y+62,342);
    var w=Math.min(342,c.measureText(name).width);
    if(name){c.fillStyle=s.accent;c.beginPath();c.arc(x+w+12,y+54,6,0,Math.PI*2);c.fill();}
    smallText(c,s.brandLabel,x+3,y+91,360,17,ink,700);
  }
  function category(c, s, right, y, light) {
    if (!s.category) return;
    var text = String(s.category).replace(/[\r\n]+/g, ' ');
    font(c, 20, 'Manrope', 700);
    var w = Math.min(395, c.measureText(text).width + 38), x = right - w;
    rounded(c, x, y, w, 43, 5, light ? '#ffffffee' : '#111d31c9');
    smallText(c, text, x + 19, y + 29, w - 38, 20, light ? '#283441' : '#ffffff', 700);
  }
  function footer(c, s, H, x, ink, story) {
    if (!s.showFooter) return;
    var y = H - (story ? 149 : 69);
    c.strokeStyle = rgba(ink, 0.24); c.lineWidth = 1;
    c.beginPath(); c.moveTo(x, y - 55); c.lineTo(1016, y - 55); c.stroke();
    smallText(c, s.handle, x, y + 2, 500, 23, ink, 700);
    c.save(); c.textAlign = 'right';
    smallText(c, s.tagline, 1016, y + 1, 330, 17, ink, 600); c.restore();
    fill(c, s.accent, 1010, H - 8, 70, 8);
  }
  function quote(c, s, x, top, ink) {
    if (!s.showQuote) return;
    c.save(); c.globalAlpha = clamp(number(s.quoteOpacity, 0.10), 0.01, 0.5);
    c.fillStyle = ink;
    // Draw the quotation mark as a vector so it never relies on a remote font.
    c.translate(x, top); c.scale(9, 9);
    [0, 15].forEach(function (dx) {
      c.beginPath(); c.moveTo(dx + 1, 12); c.bezierCurveTo(dx + 1, 6, dx + 5, 2, dx + 12, 0);
      c.lineTo(dx + 12, 3); c.bezierCurveTo(dx + 8, 5, dx + 7, 7, dx + 8, 9);
      c.bezierCurveTo(dx + 14, 14, dx + 9, 21, dx + 4, 18);
      c.bezierCurveTo(dx + 1, 17, dx + 1, 14, dx + 1, 12); c.closePath(); c.fill();
    }); c.restore();
  }
  function headlineCharacters(text, highlight) {
    text = String(text || 'Haber başlığını yaz').replace(/\r\n?/g, '\n');
    var result = [], bold = false, hasMarkers = text.indexOf('**') !== -1;
    for (var i = 0; i < text.length;) {
      if (text.slice(i, i + 2) === '**') { bold = !bold; i += 2; continue; }
      var codepoint = text.codePointAt(i), ch = String.fromCodePoint(codepoint);
      result.push({ ch: ch, bold: hasMarkers ? bold : true, accent: false }); i += ch.length;
    }
    var plain = result.map(function (g) { return g.ch; }).join('');
    if (highlight) {
      var needle = String(highlight).toLocaleLowerCase('tr'), haystack = plain.toLocaleLowerCase('tr');
      var start = 0, found;
      while (needle && (found = haystack.indexOf(needle, start)) >= 0) {
        var offset = 0;
        result.forEach(function (g) { if (offset >= found && offset < found + needle.length) g.accent = true; offset += g.ch.length; });
        start = found + needle.length;
      }
    }
    return { chars: result, plain: plain, mixed: hasMarkers };
  }
  function weight(glyph, mixed) { return mixed ? (glyph.bold ? 800 : 600) : 700; }
  function measure(c, chars, size, family, mixed) {
    var total = 0, run = '', previous = -1;
    function flush() { if (run) { font(c, size, family, previous); total += c.measureText(run).width; run = ''; } }
    chars.forEach(function (g) { var w = weight(g, mixed); if (previous !== w) { flush(); previous = w; } run += g.ch; }); flush();
    return total;
  }
  function trimEnd(chars) { while (chars.length && /[\t ]/.test(chars[chars.length - 1].ch)) chars.pop(); return chars; }
  function wrap(c, chars, size, family, mixed, maxWidth) {
    var lines = [], line = [], word = [];
    function pushLine() { lines.push(trimEnd(line)); line = []; }
    function appendWord() {
      if (!word.length) return;
      if (line.length && measure(c, line.concat(word), size, family, mixed) > maxWidth) pushLine();
      if (measure(c, word, size, family, mixed) <= maxWidth) line = line.concat(word);
      else {
        // Long URLs or words break by Unicode code point rather than escape the canvas.
        word.forEach(function (glyph) {
          if (line.length && measure(c, line.concat([glyph]), size, family, mixed) > maxWidth) pushLine();
          line.push(glyph);
        });
      }
      word = [];
    }
    chars.forEach(function (g) {
      if (g.ch === '\n') { appendWord(); pushLine(); }
      else if (/[\t ]/.test(g.ch)) { appendWord(); if (line.length) line.push({ ch: ' ', bold: g.bold, accent: g.accent }); }
      else word.push(g);
    }); appendWord(); if (line.length || !lines.length || (chars.length && chars[chars.length - 1].ch === '\n')) pushLine();
    return lines;
  }
  function drawHeadline(c, s, rect, ink) {
    var parsed = headlineCharacters(s.headline, s.highlight);
    var size = clamp(number(s.fontSize, 108), 22, 240), lines, lineHeight;
    do {
      lines = wrap(c, parsed.chars, size, s.fontFamily, parsed.mixed, rect.w);
      lineHeight = size * 1.08;
      if (lines.length * lineHeight <= rect.h || size <= 22) break;
      size = Math.max(22, size - 2);
    } while (true);
    var overflow = lines.length * lineHeight > rect.h + 0.5;
    var top = Math.max(rect.y, rect.y + rect.h - lines.length * lineHeight);
    quote(c, s, rect.x - 5, top - 72, ink);
    c.save(); c.beginPath(); c.rect(rect.x - 1, rect.y - 3, rect.w + 3, rect.h + 8); c.clip();
    var y = top + size * 0.88;
    lines.forEach(function (line) {
      var x = rect.x, run = '', runBold, runAccent;
      function flush() {
        if (!run) return;
        font(c, size, s.fontFamily, runBold); c.fillStyle = runAccent ? s.accent : ink;
        c.fillText(run, x, y); x += c.measureText(run).width; run = '';
      }
      line.forEach(function (g) {
        var b = weight(g, parsed.mixed);
        if (b !== runBold || g.accent !== runAccent) { flush(); runBold = b; runAccent = g.accent; }
        run += g.ch;
      }); flush(); y += lineHeight;
    }); c.restore();
    return { overflow: overflow, fontSize: size, lineCount: lines.length, top: top, plainHeadline: parsed.plain,
      lines: lines.map(function (line) { return line.map(function (g) { return g.ch; }).join(''); }) };
  }
  function secondPhoto(c, s, media, rect) {
    if (!s.showSecond || !imageDimensions(media.second).w) return null;
    var side = Math.min(268, rect.w * 0.29), x = rect.x + 34, y = rect.y + Math.min(206, rect.h * 0.31);
    if (s.template === 'sade') { side = Math.min(230, rect.h * 0.65); x = rect.x + 22; y = rect.y + rect.h - side - 22; }
    if (s.template === 'serit') x = 130;
    c.save(); c.shadowColor = '#00000066'; c.shadowBlur = 22; c.shadowOffsetY = 7;
    rounded(c, x - 4, y - 4, side + 8, side + 8, 20, '#ffffff'); c.restore();
    c.save(); roundPath(c, x, y, side, side, 16); c.clip();
    photo(c, media.second, { x: x, y: y, w: side, h: side }, {
      background: s.background, fit: 'cover', zoom: Math.max(1, number(s.secondZoom, 1)),
      x: s.secondX, y: s.secondY, clampCover: true
    }); c.restore();
    return { x: x, y: y, w: side, h: side };
  }
  function rail(c, s, media, H, top, bottom) {
    if (!s.showBrand) return;
    var center = 58, y = top + 54;
    c.save(); c.shadowColor = '#00000033'; c.shadowBlur = 18; c.shadowOffsetY = 4;
    rounded(c, 28, y, 60, bottom - y, 30, '#f9fafb');
    c.fillStyle = '#ffffff'; c.beginPath(); c.arc(center, y, 51, 0, Math.PI * 2); c.fill(); c.restore();
    c.save(); c.beginPath(); c.arc(center, y, 44, 0, Math.PI * 2); c.clip();
    fill(c, s.accent, center - 44, y - 44, 88, 88);
    var d = imageDimensions(media.logo);
    if (d.w && d.h) {
      var scale = Math.min(78 / d.w, 78 / d.h);
      c.drawImage(media.logo, center - d.w * scale / 2, y - d.h * scale / 2, d.w * scale, d.h * scale);
    } else { c.textAlign = 'center'; smallText(c,s.brandMark,center,y+15,70,49,contrastInk(s.accent),800); }
    c.restore();
    c.save(); c.translate(center, bottom - 35); c.rotate(-Math.PI / 2);
    c.textAlign = 'left';
    var available = bottom - y - 95;
    var text = String(s.brandName||'') + (s.location ? '   /   ' + String(s.location).toLocaleUpperCase('tr') : '');
    smallText(c, text, 0, 8, available, 24, '#263240', 800); c.restore();
  }
  function render(canvas, state, media, options) {
    options = options || {}; media = media || {};
    var s = Object.assign({}, DEFAULTS, state || {});
    s.accent = color(s.accent, DEFAULTS.accent); s.background = color(s.background, DEFAULTS.background);
    s.fontFamily = ['Barlow Condensed','Manrope','Arial','Georgia'].indexOf(s.fontFamily)>=0 ? s.fontFamily : 'Barlow Condensed';
    var H = HEIGHTS[s.format] || HEIGHTS.portrait, story = H === 1920, square = H === 1080;
    var scale = clamp(number(options.scale, 1), 0.25, 3);
    var pixelW=Math.round(WIDTH*scale),pixelH=Math.round(H*scale);
    if(canvas.width!==pixelW)canvas.width=pixelW;
    if(canvas.height!==pixelH)canvas.height=pixelH;
    var c = canvas.getContext('2d');
    c.setTransform(scale, 0, 0, scale, 0, 0); c.textBaseline = 'alphabetic'; c.textAlign = 'left';
    c.globalAlpha=1;c.globalCompositeOperation='source-over';c.shadowColor='transparent';c.shadowBlur=0;c.shadowOffsetX=0;c.shadowOffsetY=0;
    if('filter'in c)c.filter='none';c.lineWidth=1;c.setLineDash([]);
    c.imageSmoothingEnabled = true; if ('imageSmoothingQuality' in c) c.imageSmoothingQuality = 'high';
    if ('letterSpacing' in c) c.letterSpacing = '0px';
    var footerSpace = s.showFooter ? (story ? 220 : 140) : (story ? 130 : 52);
    var headlineBottom = H - footerSpace - (s.source ? 52 : 22), ink = contrastInk(s.background);
    var muted=lightBackground(s.background)?'#526174':'#b7c1d0';
    var photoRect, headRect, result, secondRect, x = 65, brandTop = story ? 150 : 49;
    fill(c, s.background, 0, 0, WIDTH, H);
    if (s.template === 'manset') {
      var split = square ? H * 0.48 : H * 0.53;
      photoRect = { x: 0, y: 0, w: WIDTH, h: split };
      headRect = { x: 65, y: split + 155, w: 950, h: Math.max(80, headlineBottom - split - 155) };
    } else if (s.template === 'sade') {
      ink = darkInk(s.background);
      fill(c, '#f6f2e9', 0, 0, WIDTH, H);
      var photoY = story ? 300 : 195, photoH = square ? 365 : story ? 805 : 550;
      photoRect = { x: 64, y: photoY, w: 952, h: photoH };
      headRect = { x: 65, y: photoY + photoH + 92, w: 950, h: Math.max(80, headlineBottom - photoY - photoH - 92) };
    } else {
      var ph = story ? 1440 : square ? 805 : 1005;
      photoRect = { x: 0, y: 0, w: WIDTH, h: ph };
      if (s.template === 'serit' && s.showBrand) x = 134;
      var maxHead = square ? 340 : story ? 650 : 490;
      headRect = { x: x, y: headlineBottom - maxHead, w: 1015 - x, h: maxHead };
    }
    var photoInfo = photo(c, media.photo, photoRect, {
      background: s.background, cropRef: media.cropRef, fit: s.fit, zoom: s.photoZoom,
      x: s.photoX, y: s.photoY, brightness: s.brightness, contrast: s.contrast, bw: s.bw
    });
    if (s.template === 'manset') {
      var topGradient = c.createLinearGradient(0, 0, 0, brandTop + 190);
      topGradient.addColorStop(0, rgba(s.background, 0.58)); topGradient.addColorStop(1, rgba(s.background, 0));
      fill(c, topGradient, 0, 0, WIDTH, brandTop + 190);
      brand(c, s, media.logo, 65, brandTop, '#ffffff');
      fill(c, s.accent, 0, photoRect.h - 8, WIDTH, 8);
      rounded(c, 65, photoRect.h + 42, 10, 27, 2, s.accent);
      smallText(c, s.category, 94, photoRect.h + 64, 900, 21, readableAccent(s.accent,s.background,ink), 700);
      smallText(c, s.subtitle, 65, photoRect.h + 114, 950, 21, muted, 700);
    } else if (s.template === 'sade') {
      brand(c, s, media.logo, 65, brandTop, darkInk(s.background));
      category(c, s, 1016, brandTop + 22, true);
      fill(c, s.accent, 64, photoRect.y + photoRect.h - 8, 110, 8);
      smallText(c, s.subtitle, 65, photoRect.y + photoRect.h + 57, 950, 21, '#687587', 700);
    } else {
      var gradient = c.createLinearGradient(0, photoRect.h * 0.27, 0, photoRect.h + 80);
      gradient.addColorStop(0, rgba(s.background, 0)); gradient.addColorStop(0.4, rgba(s.background, 0.20));
      gradient.addColorStop(0.75, rgba(s.background, 0.93)); gradient.addColorStop(1, s.background);
      fill(c, gradient, 0, photoRect.h * 0.27, WIDTH, H - photoRect.h * 0.27);
      if (s.template !== 'serit') brand(c, s, media.logo, 65, brandTop, '#ffffff');
      category(c, s, 1016, brandTop + 17, false);
    }
    secondRect = secondPhoto(c, s, media, photoRect);
    var headlineState=Object.assign({},s,{accent:readableAccent(s.accent,s.template==='sade'?'#f6f2e9':s.background,ink)});
    result = drawHeadline(c, headlineState, headRect, ink);
    if (s.template !== 'manset' && s.template !== 'sade') {
      fill(c, s.accent, x, result.top - 67, 29, 4);
      smallText(c, s.subtitle, x + 45, result.top - 58, 970 - x, 21, muted, 700);
      c.strokeStyle = s.accent; c.lineWidth = 3;
      c.beginPath(); c.moveTo(1014, headlineBottom - 65); c.lineTo(1014, headlineBottom); c.lineTo(958, headlineBottom); c.stroke();
    }
    if (s.source) smallText(c, s.source, x, headlineBottom + 43, 1015 - x, 23, s.template === 'sade' ? '#617084' : muted, 500);
    if (s.template === 'serit') rail(c, s, media, H, story ? 185 : 67, H - footerSpace + 10);
    footer(c, s, H, x, s.template === 'sade' ? '#405064' : contrastInk(s.background), story);
    return { width: WIDTH, height: H, scale: scale, overflow: result.overflow, fontSize: result.fontSize,
      lineCount: result.lineCount, plainHeadline: result.plainHeadline, lines: result.lines,
      headlineRect: headRect, photoRect: photoRect, photoImageRect: photoInfo.image, secondRect: secondRect };
  }
  // The desktop compositor shares typography, crops and brand fields with exports.
  global.StudioBaseRenderer = { render: render, formats: HEIGHTS, defaults: DEFAULTS,
    drawing: {clamp: clamp, number: number, color: color, rgba: rgba, fill: fill,
      rounded: rounded, roundPath: roundPath, font: font, smallText: smallText, photo: photo, brand: brand,
      category: category, quote: quote, drawHeadline: drawHeadline, rail: rail,
      lightBackground:lightBackground,contrastInk:contrastInk,darkInk:darkInk,readableAccent:readableAccent} };
  global.NeticeRenderer=global.StudioBaseRenderer;
})(typeof window !== 'undefined' ? window : globalThis);
