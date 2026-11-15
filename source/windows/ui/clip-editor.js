/* Karevo — bounded local-file video editing. No uploads or external URLs. */
(function (global) {
  'use strict';
  const LIMITS = Object.freeze({ MAX_INPUT_BYTES: 120 * 1024 * 1024, MAX_INPUT_DURATION: 300, MAX_PIXELS: 8294400, MAX_EDGE: 4096, MAX_OUTPUT_DURATION: 60, MAX_OUTPUT_BYTES: 40 * 1024 * 1024, FPS: 24 });
  const sessions = new WeakMap();
  const normalized = new WeakMap();
  const visualEntries = ['avc1', 'avc3', 'hvc1', 'hev1', 'vp08', 'vp09', 'av01', 'mp4v'];
  let exporting = false;
  function error(message) { return new Error(message); }
  function abortError() { const e = error('Video işlemi iptal edildi.'); e.name = 'AbortError'; return e; }
  function aborted(signal) { if (signal && signal.aborted) throw abortError(); }
  function wait(promise, signal, milliseconds, message) {
    return new Promise((resolve, reject) => {
      let done = false;
      const timer = global.setTimeout(() => finish(error(message || 'Video işlemi zamanında tamamlanamadı.')), milliseconds || 30000);
      function finish(e, value) { if (done) return; done = true; global.clearTimeout(timer); if (signal) signal.removeEventListener('abort', cancel); e ? reject(e) : resolve(value); }
      function cancel() { finish(abortError()); }
      if (signal) { if (signal.aborted) return cancel(); signal.addEventListener('abort', cancel, { once: true }); }
      Promise.resolve(promise).then(value => finish(null, value), finish);
    });
  }
  function read(blob, dataUrl, signal) {
    if (!dataUrl && typeof blob.arrayBuffer === 'function') return wait(blob.arrayBuffer(), signal, 15000, 'Video başlığı okunamadı.');
    return new Promise((resolve, reject) => {
      const reader = new global.FileReader(); let done = false;
      const timer = global.setTimeout(() => finish(error('Video dosyası okunurken zaman aşımı oluştu.')), 30000);
      function finish(e, value) { if (done) return; done = true; global.clearTimeout(timer); if (signal) signal.removeEventListener('abort', cancel); reader.onload = reader.onerror = reader.onabort = null; if (e) { try { reader.abort(); } catch (_) {} reject(e); } else resolve(value); }
      function cancel() { finish(abortError()); }
      reader.onload = () => finish(null, reader.result); reader.onerror = () => finish(error('Video dosyası okunamadı.')); reader.onabort = cancel;
      if (signal) { if (signal.aborted) return cancel(); signal.addEventListener('abort', cancel, { once: true }); }
      try { reader[dataUrl ? 'readAsDataURL' : 'readAsArrayBuffer'](blob); } catch (e) { finish(e); }
    });
  }
  function unsigned(bytes, offset, count) { let n = 0; if (offset < 0 || offset + count > bytes.length) throw error('Video başlığı eksik.'); for (let i = 0; i < count; i++) n = n * 256 + bytes[offset + i]; if (!Number.isSafeInteger(n)) throw error('Video başlık değeri çok büyük.'); return n; }
  function ascii(bytes, offset, count) { return String.fromCharCode.apply(null, Array.from(bytes.slice(offset, offset + count))); }
  function checkDimensions(width, height) { if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > LIMITS.MAX_EDGE || height > LIMITS.MAX_EDGE || width * height > LIMITS.MAX_PIXELS) throw error('Video çözünürlüğü çok büyük veya geçersiz. En fazla 4K ve 8,3 milyon piksel kullanın.'); }
  async function inspectFile(file, signal) {
    if (!global.Blob || !(file instanceof global.Blob) || !Number.isSafeInteger(file.size) || file.size < 20 || file.size > LIMITS.MAX_INPUT_BYTES) throw error('Cihazınızdan en fazla 120 MB büyüklüğünde MP4 veya WebM video seçin.');
    const type = String(file.type || '').toLowerCase(), name = String(file.name || 'Video');
    if (type && !['video/mp4', 'video/webm', 'application/octet-stream'].includes(type)) throw error('Yalnızca MP4 veya WebM video seçin.');
    if ((!type || type === 'application/octet-stream') && file.name && !/\.(mp4|webm)$/i.test(name)) throw error('MP4 veya WebM uzantılı bir dosya seçin.');
    let count = 0, bytesRead = 0; const began = Date.now();
    async function part(offset, length) { aborted(signal); if (++count > 65536 || Date.now() - began > 15000 || offset < 0 || length < 0 || offset + length > file.size || (bytesRead += length) > 1024 * 1024) throw error('Video kapsayıcısı çok karmaşık veya geçersiz.'); return new Uint8Array(await read(file.slice(offset, offset + length), false, signal)); }
    const first = await part(0, Math.min(64, file.size));
    if (ascii(first, 4, 4) === 'ftyp') {
      const length = unsigned(first, 0, 4);
      if (length < 16 || length > 4096 || length > file.size) throw error('MP4 dosya başlığı geçersiz.');
      const head = await part(0, length);
      if (!/^(?:isom|iso[2-9]|mp4[12]|avc1|M4V |dash|cmfc|cmfs|msdh|msix)$/.test(ascii(head, 8, 4))) throw error('Bu MP4 türü desteklenmiyor. Standart MP4 veya WebM seçin.');
      let moov = false, media = false, duration = 0; const tracks = [];
      async function box(offset, end) { const b = await part(offset, Math.min(16, end - offset)); if (b.length < 8) throw error('MP4 kutusu eksik.'); let size = unsigned(b, 0, 4), header = 8; if (size === 1) { size = unsigned(b, 8, 8); header = 16; } else if (size === 0) size = end - offset; if (size < header || size > end - offset) throw error('MP4 kutu boyutu geçersiz.'); return { offset, size, header, content: offset + header, end: offset + size, type: ascii(b, 4, 4) }; }
      async function walk(start, end, depth, track) {
        if (depth > 8) throw error('MP4 iç içe kutu sınırını aşıyor.');
        for (let offset = start; offset < end;) {
          const b = await box(offset, end), payload = b.size - b.header;
          if (b.type === 'moov') { moov = true; await walk(b.content, b.end, depth + 1, track); }
          else if (b.type === 'trak') { const t = { handler: '', entries: [], selfContained: false }; tracks.push(t); if (tracks.length > 16) throw error('Videoda çok fazla iz var.'); await walk(b.content, b.end, depth + 1, t); }
          else if (['mdia', 'minf', 'stbl', 'dinf'].includes(b.type)) await walk(b.content, b.end, depth + 1, track);
          else if (b.type === 'mdat' && payload > 0) media = true;
          else if (b.type === 'mvhd') {
            const v = await part(b.content, Math.min(payload, 40)), version = v[0]; if (![0, 1].includes(version)) throw error('MP4 zaman bilgisi geçersiz.');
            const scale = unsigned(v, version ? 20 : 12, 4), ticks = unsigned(v, version ? 24 : 16, version ? 8 : 4);
            if (!scale || ticks / scale > LIMITS.MAX_INPUT_DURATION) throw error('Video en fazla 5 dakika olabilir.'); duration = ticks / scale;
          } else if (b.type === 'hdlr' && track) { const v = await part(b.content, Math.min(payload, 12)); track.handler = ascii(v, 8, 4); }
          else if (b.type === 'tkhd' && track) { const v = await part(b.content, Math.min(payload, 96)), at = v[0] === 1 ? 88 : 76; if (v.length >= at + 8) { const w = unsigned(v, at, 4) / 65536, h = unsigned(v, at + 4, 4) / 65536; if (w && h) checkDimensions(Math.ceil(w), Math.ceil(h)); } }
          else if (b.type === 'dref' && track) {
            const v = await part(b.content, Math.min(payload, 8)); if (unsigned(v, 4, 4) !== 1) throw error('Harici video kaynakları desteklenmiyor.');
            const item = await box(b.content + 8, b.end), length = item.size - item.header;
            if (item.type !== 'url ' || length < 4 || length > 260 || item.end !== b.end) throw error('Harici video bağlantıları güvenlik nedeniyle açılmaz.');
            const reference = await part(item.content, length);
            // Chromium may serialize an empty NUL-terminated location even
            // with the self-contained flag. Nonempty locations stay blocked.
            if (unsigned(reference, 0, 4) !== 1 || reference.slice(4).some(byte => byte !== 0)) throw error('Harici video bağlantıları güvenlik nedeniyle açılmaz.'); track.selfContained = true;
          } else if (b.type === 'stsd' && track) {
            const v = await part(b.content, Math.min(payload, 8)), entries = unsigned(v, 4, 4); if (!entries || entries > 16) throw error('MP4 iz bilgisi geçersiz.'); let cursor = b.content + 8;
            for (let n = 0; n < entries; n++) { const item = await box(cursor, b.end), info = await part(item.content, Math.min(32, item.size - item.header)); if (unsigned(info, 6, 2) !== 1) throw error('Harici video kaynakları desteklenmiyor.'); const visual = visualEntries.includes(item.type); if (visual) checkDimensions(unsigned(info, 24, 2), unsigned(info, 26, 2)); track.entries.push({ visual }); cursor = item.end; }
            if (cursor !== b.end) throw error('MP4 iz bilgisi eksik.');
          }
          offset = b.end;
        }
      }
      await walk(0, file.size, 0, null);
      const videoTracks = tracks.filter(t => t.handler === 'vide');
      if (!moov || !media || !videoTracks.length || videoTracks.some(t => !t.selfContained || !t.entries.length || t.entries.some(e => !e.visual))) throw error('MP4 içinde güvenli bir görüntü izi bulunamadı.');
      if (tracks.some(t => (t.handler === 'vide' || t.handler === 'soun') && !t.selfContained)) throw error('Harici video kaynakları desteklenmiyor.');
      return { kind: 'mp4', name, duration };
    }
    if (unsigned(first, 0, 4) !== 0x1a45dfa3) throw error('Dosya gerçek bir MP4 veya WebM videosu değil.');
    async function element(offset, end) {
      const v = await part(offset, Math.min(12, end - offset)); let width = 1, mask = 128;
      while (width <= 4 && !(v[0] & mask)) { width++; mask >>= 1; } if (width > 4 || width >= v.length) throw error('WebM öğesi geçersiz.');
      const id = unsigned(v, 0, width); let length = 1; mask = 128; while (length <= 8 && !(v[width] & mask)) { length++; mask >>= 1; }
      if (length > 8 || width + length > v.length) throw error('WebM uzunluğu geçersiz.'); let size = v[width] & (mask - 1), unknown = size === mask - 1;
      for (let n = 1; n < length; n++) { size = size * 256 + v[width + n]; unknown = unknown && v[width + n] === 255; }
      const content = offset + width + length; if (!unknown && (!Number.isSafeInteger(size) || size > end - content)) throw error('WebM öğesi eksik.');
      return { id, content, end: unknown ? end : content + size, size, unknown };
    }
    const header = await element(0, file.size); if (header.unknown || header.end > 4096) throw error('WebM başlığı geçersiz.'); let doc = false;
    for (let offset = header.content; offset < header.end;) { const e = await element(offset, header.end); if (e.unknown) throw error('WebM başlığı geçersiz.'); if (e.id === 0x4282) doc = ascii(await part(e.content, e.end - e.content), 0, e.end - e.content) === 'webm'; offset = e.end; }
    const segment = await element(header.end, file.size); if (!doc || segment.id !== 0x18538067 || segment.end !== file.size) throw error('WebM video bölümü geçersiz.');
    const tracks = []; let scale = 1000000, ticks = 0;
    const segmentIds = [0x1654ae6b, 0x1549a966, 0x1f43b675, 0x1c53bb6b, 0x114d9b74, 0x1254c367, 0x1941a469, 0x1043a770];
    async function unknownClusterEnd(start, end) {
      // Streaming WebM has unknown-sized clusters. Inspect their bounded child
      // headers so a later Tracks element cannot hide from dimension checks.
      for (let offset = start; offset < end;) {
        const child = await element(offset, end);
        if (segmentIds.includes(child.id)) return offset;
        if (child.unknown) throw error('WebM küme öğesi geçersiz.');
        offset = child.end;
      }
      return end;
    }
    async function walk(start, end, depth, track) {
      if (depth > 6) throw error('WebM öğe sınırı aşıldı.');
      for (let offset = start; offset < end;) {
        const e = await element(offset, end);
        if (e.unknown && e.id !== 0x1f43b675) throw error('WebM öğesi geçersiz.');
        if ([0x1654ae6b, 0xe0, 0x1549a966].includes(e.id)) await walk(e.content, e.end, depth + 1, track);
        else if (e.id === 0xae) { const t = {}; tracks.push(t); if (tracks.length > 16) throw error('Videoda çok fazla iz var.'); await walk(e.content, e.end, depth + 1, t); }
        else if (track && [0x83, 0xb0, 0xba, 0x54b0, 0x54ba].includes(e.id)) { const value = unsigned(await part(e.content, e.end - e.content), 0, e.end - e.content); track[e.id] = value; }
        else if (track && e.id === 0x86) { if (e.end - e.content > 32) throw error('WebM kodlayıcısı geçersiz.'); track.codec = ascii(await part(e.content, e.end - e.content), 0, e.end - e.content); }
        else if (e.id === 0x2ad7b1) scale = unsigned(await part(e.content, e.end - e.content), 0, e.end - e.content);
        else if (e.id === 0x4489) { const b = await part(e.content, e.end - e.content); if (![4, 8].includes(b.length)) throw error('WebM süre bilgisi geçersiz.'); const view = new DataView(b.buffer, b.byteOffset, b.byteLength); ticks = b.length === 4 ? view.getFloat32(0) : view.getFloat64(0); }
        offset = e.unknown && e.id === 0x1f43b675 ? await unknownClusterEnd(e.content, e.end) : e.end;
      }
    }
    await walk(segment.content, segment.end, 0, null);
    if (!tracks.some(t => t[0x83] === 1)) throw error('WebM görüntü izi bulunamadı.');
    for (const t of tracks.filter(t => t[0x83] === 1)) { if (!['V_VP8', 'V_VP9', 'V_AV1'].includes(t.codec)) throw error('Bu WebM kodlayıcısı desteklenmiyor.'); checkDimensions(t[0xb0], t[0xba]); if (t[0x54b0] || t[0x54ba]) checkDimensions(t[0x54b0] || t[0xb0], t[0x54ba] || t[0xba]); }
    if (!Number.isFinite(ticks) || ticks < 0 || ticks * scale / 1e9 > LIMITS.MAX_INPUT_DURATION) throw error('Video en fazla 5 dakika olabilir.');
    return { kind: 'webm', name };
  }
  function mediaEvent(video, event, signal, action) {
    return new Promise((resolve, reject) => {
      let done = false; const timer = global.setTimeout(() => finish(error('Video okunurken zaman aşımı oluştu.')), 30000);
      function finish(e) { if (done) return; done = true; global.clearTimeout(timer); video.removeEventListener(event, success); video.removeEventListener('error', failed); if (signal) signal.removeEventListener('abort', cancel); e ? reject(e) : resolve(); }
      function success() { finish(); } function failed() { finish(error('Video bu cihazda açılamadı. MP4 (H.264) veya WebM deneyin.')); } function cancel() { finish(abortError()); }
      video.addEventListener(event, success); video.addEventListener('error', failed); if (signal) { if (signal.aborted) return cancel(); signal.addEventListener('abort', cancel, { once: true }); }
      try { action(); } catch (e) { finish(e); }
    });
  }
  function clearVideo(video) { if (!video) return; try { video.pause(); video.removeAttribute('src'); video.load(); } catch (_) {} }
  async function loadVideo(url, signal) {
    const video = global.document.createElement('video'); video.preload = 'metadata'; video.playsInline = true; video.muted = true; video.loop = false;
    try {
      await mediaEvent(video, 'loadedmetadata', signal, () => { video.src = url; video.load(); }); checkDimensions(video.videoWidth, video.videoHeight);
      // MediaRecorder WebM may omit its Duration field. A bounded paused seek
      // lets the demuxer discover EOF; never seek to an arbitrary huge value.
      if (video.duration === Infinity) {
        await mediaEvent(video, 'seeked', signal, () => { video.currentTime = LIMITS.MAX_INPUT_DURATION + 1; });
        if (!Number.isFinite(video.duration) || video.duration > LIMITS.MAX_INPUT_DURATION) throw error('Video süresi belirlenemedi veya 5 dakikadan uzun.');
        await mediaEvent(video, 'seeked', signal, () => { video.currentTime = 0; });
      }
      if (!Number.isFinite(video.duration) || video.duration < 0.25 || video.duration > LIMITS.MAX_INPUT_DURATION) throw error('Video süresi geçersiz veya 5 dakikadan uzun.');
      return video;
    } catch (e) { clearVideo(video); throw e; }
  }
  async function open(file, options) {
    const signal = options && options.signal; aborted(signal); const checked = await inspectFile(file, signal); aborted(signal);
    if (!global.URL || !global.URL.createObjectURL || !global.document) throw error('Bu ortam video dosyası açamıyor.');
    const url = global.URL.createObjectURL(file); let video;
    try {
      video = await loadVideo(url, signal); aborted(signal);
      const session = Object.freeze({ video, width: video.videoWidth, height: video.videoHeight, duration: video.duration, name: checked.name.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 180), dispose() { dispose(session); } });
      sessions.set(session, { url, disposed: false, controller: null }); return session;
    } catch (e) { clearVideo(video); global.URL.revokeObjectURL(url); throw e; }
  }
  function requireSession(session) { const state = sessions.get(session); if (!state || state.disposed) throw error('Önce cihazınızdan bir video açın.'); return state; }
  function dispose(session) { const state = sessions.get(session); if (!state || state.disposed) return; state.disposed = true; if (state.controller) state.controller.abort(); clearVideo(session.video); global.URL.revokeObjectURL(state.url); }
  function finite(value, fallback, minimum, maximum) { if (value === undefined) return fallback; if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) throw error('Video düzenleme değeri geçersiz.'); return value; }
  function normalizeOptions(session, raw) {
    requireSession(session); if (raw && normalized.get(raw) === session) return raw;
    const o = raw || {}, start = finite(o.start, 0, 0, session.duration), end = finite(o.end, Math.min(session.duration, start + LIMITS.MAX_OUTPUT_DURATION), 0, session.duration), duration = end - start;
    if (duration < 0.25 || duration > LIMITS.MAX_OUTPUT_DURATION + 0.000001) throw error('Kesilecek bölüm 0,25–60 saniye arasında olmalı.');
    const rotation = o.rotation === undefined ? 0 : o.rotation; if (![0, 90, 180, 270].includes(rotation)) throw error('Video döndürme değeri geçersiz.');
    const ratio = o.ratio === undefined ? 'original' : o.ratio, fit = o.fit === undefined ? 'contain' : o.fit, textPosition = o.textPosition === undefined ? 'bottom' : o.textPosition;
    if (!['original', 'portrait', 'story', 'square', 'landscape'].includes(ratio) || !['contain', 'cover'].includes(fit) || !['top', 'middle', 'bottom'].includes(textPosition)) throw error('Video kadrajı veya yazı konumu geçersiz.');
    const volume = finite(o.volume, 1, 0, 1), muted = o.muted === undefined ? false : o.muted;
    if (typeof muted !== 'boolean') throw error('Video ses seçimi geçersiz.');
    const text = o.text === undefined ? '' : o.text; if (typeof text !== 'string' || text.length > 300) throw error('Video yazısı en fazla 300 karakter olabilir.');
    const format = o.format === undefined ? 'webm' : o.format, selectedWidth = o.presetWidth === undefined ? (o.width === undefined ? 720 : o.width) : o.presetWidth; if (!['mp4', 'webm'].includes(format) || ![720, 1080].includes(selectedWidth)) throw error('Video çıktı biçimi veya çözünürlüğü geçersiz.');
    const swapped = rotation === 90 || rotation === 270, sourceRatio = swapped ? session.height / session.width : session.width / session.height, aspect = { original: sourceRatio, portrait: 4 / 5, story: 9 / 16, square: 1, landscape: 16 / 9 }[ratio];
    const scale = Math.min(selectedWidth, 1920 * aspect), width = Math.max(2, Math.floor(scale / 2) * 2), height = Math.max(2, Math.round(width / aspect / 2) * 2);
    if (o.presetWidth !== undefined && o.width !== undefined && o.width !== width && o.width !== selectedWidth) throw error('Video çıktı çözünürlüğü geçersiz.');
    if (width * height > 2073600 || height > 1920) throw error('Video çıktı çözünürlüğü çok büyük.');
    const result = Object.freeze({ start, end, duration, ratio, fit, rotation, volume, muted, text: text.replace(/\u0000/g, ''), textPosition, format, presetWidth: selectedWidth, width, height }); normalized.set(result, session); return result;
  }
  function draw(canvas, session, options, frame) {
    const o = normalizeOptions(session, options), video = frame || session.video; if (!canvas || typeof canvas.getContext !== 'function') throw error('Video önizlemesi açılamadı.');
    if (canvas.width !== o.width) canvas.width = o.width; if (canvas.height !== o.height) canvas.height = o.height;
    const c = canvas.getContext('2d', { alpha: false }); if (!c) throw error('Video çizim alanı açılamadı.');
    c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = 1; c.fillStyle = '#101923'; c.fillRect(0, 0, o.width, o.height);
    const swapped = o.rotation === 90 || o.rotation === 270, w = swapped ? session.height : session.width, h = swapped ? session.width : session.height, scale = (o.fit === 'cover' ? Math.max : Math.min)(o.width / w, o.height / h);
    c.beginPath(); c.rect(0, 0, o.width, o.height); c.clip(); c.translate(o.width / 2, o.height / 2); c.rotate(o.rotation * Math.PI / 180);
    if (video.readyState >= 2) { checkDimensions(video.videoWidth, video.videoHeight); c.drawImage(video, -session.width * scale / 2, -session.height * scale / 2, session.width * scale, session.height * scale); } c.restore();
    if (o.text) {
      c.save(); c.textAlign = 'center'; c.textBaseline = 'top'; let size = Math.max(18, Math.round(o.width * 0.042)), lines; const maxWidth = o.width * 0.88;
      do { c.font = '700 ' + size + 'px Manrope,Arial,sans-serif'; lines = []; for (const paragraph of o.text.replace(/\r\n?/g, '\n').split('\n')) { let line = ''; for (const ch of Array.from(paragraph)) { if (line && c.measureText(line + ch).width > maxWidth) { lines.push(line); line = ''; } line += ch; } lines.push(line); } if (lines.length * size * 1.25 + size <= o.height * 0.45) break; size--; } while (size >= 12);
      if (size < 12) { c.restore(); throw error('Video yazısı kadraja sığmıyor. Metni veya satır sonlarını kısaltın.'); }
      const lineHeight = size * 1.25, height = lines.length * lineHeight + size, top = o.textPosition === 'top' ? o.height * 0.06 : o.textPosition === 'middle' ? (o.height - height) / 2 : o.height * 0.94 - height;
      c.fillStyle = 'rgba(0,0,0,0.68)'; c.fillRect(o.width * 0.04, Math.max(0, top), o.width * 0.92, height); c.fillStyle = '#ffffff'; lines.forEach((line, i) => c.fillText(line, o.width / 2, Math.max(0, top) + size * 0.5 + i * lineHeight, maxWidth)); c.restore();
    }
    return o;
  }
  const candidates = { mp4: { silent: ['video/mp4;codecs=avc1.42E01E', 'video/mp4'], audio: ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4'] }, webm: { silent: ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'], audio: ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'] } };
  function supported(types) { if (!global.MediaRecorder || typeof global.MediaRecorder.isTypeSupported !== 'function') return null; return types.find(type => { try { return global.MediaRecorder.isTypeSupported(type); } catch (_) { return false; } }) || null; }
  function inspectCapabilities() {
    const canvas = global.document && global.document.createElement('canvas'), audioSupported = !!(global.AudioContext || global.webkitAudioContext), formats = [];
    if (!canvas || typeof canvas.captureStream !== 'function') return { supported: false, formats, audioSupported, reason: 'Bu cihaz video dışa aktarmayı desteklemiyor. Güncel Chrome/Edge veya masaüstü uygulamasını kullanın.' };
    for (const id of ['mp4', 'webm']) { const mime = supported(candidates[id].silent); if (mime) formats.push({ id, mime, label: id === 'mp4' ? 'MP4' : 'WebM', audioSupported: audioSupported && !!supported(candidates[id].audio) }); }
    return { supported: !!formats.length, formats, audioSupported, reason: formats.length ? undefined : 'Bu cihazda kullanılabilir MP4/WebM kodlayıcısı yok.' };
  }
  async function seek(video, time, signal) { if (Math.abs(video.currentTime - time) < 0.001 && video.readyState >= 2) return; await mediaEvent(video, 'seeked', signal, () => { video.currentTime = time; }); }
  async function exportClip(session, raw) {
    const state = requireSession(session), o = normalizeOptions(session, raw), external = raw && raw.signal, capability = inspectCapabilities(); aborted(external);
    if (exporting) throw error('Önce devam eden video dışa aktarmasını bitirin.');
    const audible = !o.muted && o.volume > 0, encoding = supported(candidates[o.format][audible ? 'audio' : 'silent']);
    if (!capability.supported || !encoding) throw error('Seçilen video biçimi bu cihazda kodlanamıyor. Diğer biçimi deneyin.');
    if (audible && !capability.audioSupported) throw error('Bu cihaz sesli video aktaramıyor. Sessize al seçeneğini kullanın.');
    const controller = new global.AbortController(), signal = controller.signal; function cancel() { controller.abort(); } if (external) { external.addEventListener('abort', cancel, { once: true }); if (external.aborted) controller.abort(); } state.controller = controller; exporting = true;
    let video, canvas, stream, recorder, audio, destination, source, gain, raf = null, frameTimer = null; const progress = raw && typeof raw.onProgress === 'function' ? raw.onProgress : function () {};
    function report(n) { try { progress(Math.max(0, Math.min(1, n))); } catch (_) {} }
    function stopFrames() { if (raf !== null && global.cancelAnimationFrame) global.cancelAnimationFrame(raf); if (frameTimer !== null) global.clearTimeout(frameTimer); raf = frameTimer = null; }
    try {
      if (o.text && global.document.fonts && global.document.fonts.ready) await wait(global.document.fonts.ready, signal, 10000, 'Yazı tipleri hazırlanamadı. Yeniden deneyin veya video yazısını kaldırın.');
      session.video.pause(); video = await loadVideo(state.url, signal); video.preload = 'auto'; await seek(video, o.start, signal); aborted(signal);
      canvas = global.document.createElement('canvas'); draw(canvas, session, o, video); stream = canvas.captureStream(LIMITS.FPS); if (!stream || !stream.getVideoTracks || !stream.getVideoTracks().length) throw error('Video kayıt akışı oluşturulamadı.');
      if (audible) {
        try { audio = new (global.AudioContext || global.webkitAudioContext)(); source = audio.createMediaElementSource(video); gain = audio.createGain(); gain.gain.value = o.volume; destination = audio.createMediaStreamDestination(); source.connect(gain); gain.connect(destination); if (audio.state === 'suspended') await wait(audio.resume(), signal, 10000, 'Ses işleme başlatılamadı. Sessize al seçeneğini deneyin.'); const tracks = destination.stream.getAudioTracks(); if (!tracks.length || typeof stream.addTrack !== 'function') throw error('Ses kayıt akışı oluşturulamadı.'); tracks.forEach(track => stream.addTrack(track)); video.muted = false; video.volume = 1; }
        catch (e) { if (e.name === 'AbortError') throw e; throw error('Ses işleme başlatılamadı. Sessize al seçeneğini deneyin.'); }
      } else { video.muted = true; video.volume = 0; }
      aborted(signal); recorder = new global.MediaRecorder(stream, { mimeType: encoding, videoBitsPerSecond: Math.min(6000000, Math.max(2000000, Math.round(o.width * o.height * 24 * 0.12))), ...(audible ? { audioBitsPerSecond: 128000 } : {}) });
      const blob = await new Promise((resolve, reject) => {
        let settled = false, stopping = false, problem = null, bytes = 0, chunks = [], stopTimer = null, deadline = null;
        function finish(e, value) { if (settled) return; settled = true; stopFrames(); global.clearTimeout(stopTimer); global.clearTimeout(deadline); signal.removeEventListener('abort', abort); video.removeEventListener('ended', ended); video.removeEventListener('error', failed); recorder.ondataavailable = recorder.onerror = recorder.onstop = null; e ? reject(e) : resolve(value); }
        function stop(e) { if (settled) return; if (e && !problem) problem = e; if (stopping) return; stopping = true; stopFrames(); try { video.pause(); } catch (_) {} stopTimer = global.setTimeout(() => finish(problem || error('Video kodlayıcısı yanıt vermedi.')), 5000); try { if (recorder.state !== 'inactive') recorder.stop(); else finish(problem || error('Video kaydı başlayamadı.')); } catch (failure) { finish(problem || failure); } }
        function abort() { stop(abortError()); } function failed() { stop(error('Video oynatılamadı.')); } function ended() { if (video.currentTime < o.end - 0.12) stop(error('Video seçilen bölüm bitmeden durdu.')); else stop(); }
        function tick() { if (settled || stopping) return; try { draw(canvas, session, o, video); stream.getVideoTracks().forEach(track => { if (typeof track.requestFrame === 'function') track.requestFrame(); }); report((video.currentTime - o.start) / o.duration); if (video.currentTime >= o.end - 0.02 || video.ended) { stop(); return; } if (global.requestAnimationFrame) raf = global.requestAnimationFrame(tick); else frameTimer = global.setTimeout(tick, 1000 / LIMITS.FPS); } catch (e) { stop(e); } }
        recorder.ondataavailable = event => { if (settled || !event.data || !event.data.size) return; bytes += event.data.size; if (bytes > LIMITS.MAX_OUTPUT_BYTES) { stop(error('Çıktı 40 MB sınırını aştı. Daha kısa bölüm veya 720 px seçin.')); return; } chunks.push(event.data); };
        recorder.onerror = () => stop(error('Video kodlaması başarısız oldu. Diğer biçimi deneyin.')); recorder.onstop = () => { if (problem) return finish(problem); if (!bytes) return finish(error('Kodlayıcı boş video üretti.')); finish(null, new global.Blob(chunks, { type: 'video/' + o.format })); };
        signal.addEventListener('abort', abort, { once: true }); video.addEventListener('ended', ended); video.addEventListener('error', failed);
        try { aborted(signal); recorder.start(500); deadline = global.setTimeout(() => stop(error('Video zamanında tamamlanamadı. Pencereyi açık ve görünür tutup yeniden deneyin.')), o.duration * 1000 + 15000); report(0); wait(video.play(), signal, 10000, 'Video oynatılamadı.').then(tick, stop); } catch (e) { finish(e); }
      });
      aborted(signal); const head = new Uint8Array(await read(blob.slice(0, 64), false, signal)); if (o.format === 'mp4' ? ascii(head, 4, 4) !== 'ftyp' : unsigned(head, 0, 4) !== 0x1a45dfa3) throw error('Kodlayıcı geçerli video üretmedi. Diğer biçimi deneyin.');
      const dataUrl = await read(blob, true, signal); aborted(signal); report(1); return { blob, dataUrl, mime: 'video/' + o.format, width: o.width, height: o.height, duration: o.duration, name: 'Karevo-Video.' + o.format };
    } finally {
      if (external) external.removeEventListener('abort', cancel); stopFrames();
      if (recorder && recorder.state !== 'inactive') { try { recorder.stop(); } catch (_) {} }
      if (stream && stream.getTracks) stream.getTracks().forEach(track => { try { track.stop(); } catch (_) {} });
      if (destination && destination.stream) destination.stream.getTracks().forEach(track => { try { track.stop(); } catch (_) {} });
      for (const node of [source, gain, destination]) if (node && node.disconnect) { try { node.disconnect(); } catch (_) {} }
      if (audio && audio.close) { try { Promise.resolve(audio.close()).catch(() => {}); } catch (_) {} }
      clearVideo(video); if (canvas) canvas.width = canvas.height = 1; if (state.controller === controller) state.controller = null; exporting = false;
    }
  }
  global.StudioClip = Object.freeze({ LIMITS, inspectCapabilities, open, normalizeOptions, draw, exportClip, dispose });
})(typeof window !== 'undefined' ? window : globalThis);
