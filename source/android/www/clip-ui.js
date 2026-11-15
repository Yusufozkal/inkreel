/* Local video editing controls. Files stay in the current editing session. */
(function (global) {
  'use strict';
  const $ = id => document.getElementById(id);
  const dialog = $('clipDialog'), button = $('clipButton'), engine = global.StudioClip;
  if (!dialog || !button || !engine) return;
  let session = null, operation = '', controller = null, releaseOperation = null;
  let previewFrame = 0, lastPreview = 0, ticket = 0, playVersion = 0, disposed = false;
  const controls = ['clipChooseButton', 'clipForgetButton', 'clipPlayButton', 'clipSeek', 'clipStart', 'clipEnd', 'clipMarkStart', 'clipMarkEnd', 'clipSelection', 'clipStartHandle', 'clipEndHandle', 'clipPlayhead', 'clipRatio', 'clipFit', 'clipRotateButton', 'clipVolume', 'clipMuted', 'clipText', 'clipTextPosition', 'clipFormat', 'clipWidth'];
  let rotation = 0, capabilities = { supported: false, formats: [], audioSupported: false }, valid = false;
  let timelineDrag = null;

  function message(text, error) {
    $('clipMessage').textContent = String(text || '');
    $('clipMessage').classList.toggle('is-error', !!error);
  }
  function clock(value) {
    const seconds = Math.max(0, Number.isFinite(value) ? value : 0);
    return Math.floor(seconds / 60) + ':' + String(Math.floor(seconds % 60)).padStart(2, '0') + '.' + Math.floor(seconds % 1 * 10);
  }
  const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
  const roundedTime = value => Math.round(value * 100) / 100;
  function timelineRange() {
    const duration = session ? session.duration : 0;
    if (!duration) return { duration: 0, start: 0, end: 0 };
    const rawStart = Number($('clipStart').value), rawEnd = Number($('clipEnd').value);
    const start = clamp(Number.isFinite(rawStart) ? rawStart : 0, 0, Math.max(0, duration - 0.25));
    const end = clamp(Number.isFinite(rawEnd) ? rawEnd : Math.min(duration, start + 60), start + 0.25, Math.min(duration, start + 60));
    return { duration, start, end };
  }
  function timelineAria(id, value, minimum, maximum, prefix) {
    const el = $(id);
    el.setAttribute('aria-valuemin', String(roundedTime(minimum)));
    el.setAttribute('aria-valuemax', String(roundedTime(maximum)));
    el.setAttribute('aria-valuenow', String(roundedTime(value)));
    el.setAttribute('aria-valuetext', prefix + ' ' + clock(value));
  }
  function syncTimeline() {
    const range = timelineRange(), d = range.duration;
    const play = d ? clamp(Number(session.video.currentTime) || 0, 0, d) : 0;
    const percent = n => d ? (n / d * 100) + '%' : '0%';
    $('clipSelection').style.left = percent(range.start);
    $('clipSelection').style.width = percent(range.end - range.start);
    $('clipStartHandle').style.left = percent(range.start);
    $('clipEndHandle').style.left = percent(range.end);
    $('clipPlayhead').style.left = percent(play);
    $('clipTimelineStartTime').textContent = clock(0);
    $('clipTimelineEndTime').textContent = clock(d);
    timelineAria('clipStartHandle', range.start, Math.max(0, range.end - 60), Math.max(0, range.end - 0.25), 'Başlangıç');
    timelineAria('clipEndHandle', range.end, d ? range.start + 0.25 : 0, d ? Math.min(d, range.start + 60) : 0, 'Bitiş');
    timelineAria('clipSelection', range.start, 0, Math.max(0, d - (range.end - range.start)), 'Seçimin başlangıcı');
    timelineAria('clipPlayhead', play, 0, d, 'Konum');
  }
  function seekTimeline(value) {
    if (!session || operation) return;
    stopPreview();
    try { session.video.currentTime = clamp(value, 0, session.duration); updateTime(); }
    catch (error) { message(error.message || 'Videoda bu konuma gidilemedi.', true); }
  }
  function setTimelineRange(start, end) {
    $('clipStart').value = String(roundedTime(start));
    $('clipEnd').value = String(roundedTime(end));
    renderPreview();
  }
  function setTimelineHandle(kind, value) {
    if (!session || operation) return;
    const { duration, start, end } = timelineRange();
    if (kind === 'start') { setTimelineRange(clamp(value, Math.max(0, end - 60), end - 0.25), end); seekTimeline(Number($('clipStart').value)); }
    else if (kind === 'end') { setTimelineRange(start, clamp(value, start + 0.25, Math.min(duration, start + 60))); seekTimeline(Number($('clipEnd').value)); }
    else seekTimeline(value);
  }
  function moveTimelineSelection(value) {
    if (!session || operation) return;
    const { duration, start, end } = timelineRange(), span = end - start;
    const moved = clamp(value, 0, duration - span);
    setTimelineRange(moved, moved + span);
  }
  function endTimelineDrag() {
    if (!timelineDrag) return;
    timelineDrag = null;
    document.removeEventListener('pointermove', moveTimelineDrag);
    document.removeEventListener('pointerup', finishTimelineDrag);
    document.removeEventListener('pointercancel', endTimelineDrag);
  }
  function timelineAt(clientX, raw) {
    const rect = $('clipTimelineInner').getBoundingClientRect();
    if (!session || !rect.width) return 0;
    const ratio = (clientX - rect.left) / rect.width;
    return (raw ? ratio : clamp(ratio, 0, 1)) * session.duration;
  }
  function moveTimelineDrag(event) {
    if (!timelineDrag || event.pointerId !== timelineDrag.pointerId || !session || operation) return;
    event.preventDefault();
    if (Math.abs(event.clientX - timelineDrag.originX) > 3) timelineDrag.moved = true;
    const value = timelineAt(event.clientX, true), delta = value - timelineDrag.originTime;
    if (timelineDrag.kind === 'selection') {
      if (timelineDrag.moved) moveTimelineSelection(timelineDrag.start + delta);
    } else setTimelineHandle(timelineDrag.kind, timelineDrag.value + delta);
  }
  function startTimelineDrag(event, kind) {
    if (!session || operation || (event.pointerType === 'mouse' && event.button !== 0)) return;
    event.preventDefault(); event.stopPropagation();
    endTimelineDrag();
    const range = timelineRange(), value = kind === 'start' ? range.start : kind === 'end' ? range.end : kind === 'play' ? Number(session.video.currentTime) || 0 : range.start;
    timelineDrag = { kind, pointerId: event.pointerId, originX: event.clientX, originTime: timelineAt(event.clientX, true), start: range.start, value, moved: false };
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch (_) { /* Document listeners still handle the drag. */ }
    document.addEventListener('pointermove', moveTimelineDrag);
    document.addEventListener('pointerup', finishTimelineDrag);
    document.addEventListener('pointercancel', endTimelineDrag);
  }
  function finishTimelineDrag(event) {
    if (!timelineDrag || event.pointerId !== timelineDrag.pointerId) return;
    if (timelineDrag.kind === 'selection') seekTimeline(timelineDrag.moved ? timelineRange().start : timelineAt(event.clientX));
    endTimelineDrag();
  }
  function timelineKeyboard(event, kind) {
    if (!session || operation || !['ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    const { duration, start, end } = timelineRange();
    const minimum = kind === 'start' ? Math.max(0, end - 60) : kind === 'end' ? start + 0.25 : 0;
    const maximum = kind === 'start' ? end - 0.25 : kind === 'end' ? Math.min(duration, start + 60) : kind === 'selection' ? duration - (end - start) : duration;
    const current = kind === 'start' || kind === 'selection' ? start : kind === 'end' ? end : Number(session.video.currentTime) || 0;
    const direction = event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -1 : 1;
    const next = event.key === 'Home' ? minimum : event.key === 'End' ? maximum : clamp(current + direction * (event.shiftKey ? 1 : 0.1), minimum, maximum);
    if (kind === 'selection') moveTimelineSelection(next); else setTimelineHandle(kind, next);
  }
  function slug(value) {
    return String(value || 'video').replace(/\.[^.]*$/, '').replace(/ı/g, 'i').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 65) || 'video';
  }
  function abortError() { const error = Error('İşlem iptal edildi.'); error.name = 'AbortError'; return error; }
  function options() {
    return {
      start: Number($('clipStart').value), end: Number($('clipEnd').value),
      ratio: $('clipRatio').value, fit: $('clipFit').value, rotation,
      volume: Number($('clipVolume').value) / 100, muted: $('clipMuted').checked,
      text: $('clipText').value, textPosition: $('clipTextPosition').value,
      format: $('clipFormat').value || 'webm', width: Number($('clipWidth').value)
    };
  }
  function normalize() {
    if (!$('clipStart').value.trim() || !$('clipEnd').value.trim()) throw Error('Başlangıç ve bitiş zamanını yazın.');
    return engine.normalizeOptions(session, options());
  }
  function setEnabled() {
    if (operation || !session) endTimelineDrag();
    for (const id of controls) $(id).disabled = !!operation || (!session && id !== 'clipChooseButton');
    $('clipTimeline').setAttribute('aria-disabled', operation || !session ? 'true' : 'false');
    $('clipExportButton').disabled = !!operation || !session || !valid || !capabilities.supported;
    $('clipCancelButton').classList.toggle('hidden', !operation);
    $('clipCancelButton').disabled = operation === 'save' || !!controller?.signal.aborted;
    $('clipProgress').classList.toggle('hidden', !operation);
    $('clipDialog').setAttribute('aria-busy', operation ? 'true' : 'false');
  }
  function updateTime() {
    const position = session ? Number(session.video.currentTime) || 0 : 0;
    $('clipSeek').value = String(position);
    $('clipTime').textContent = clock(position) + ' / ' + clock(session ? session.duration : 0);
    syncTimeline();
  }
  function syncAudio() {
    if (!session) return;
    session.video.volume = Math.max(0, Math.min(1, Number($('clipVolume').value) / 100 || 0));
    session.video.muted = $('clipMuted').checked;
    $('clipVolumeValue').textContent = Math.round(session.video.volume * 100) + '%';
  }
  function renderPreview(quiet) {
    if (!session) return false;
    try {
      const normalized = normalize();
      engine.draw($('clipCanvas'), session, normalized);
      $('clipSummary').textContent = clock(normalized.duration === undefined ? normalized.end - normalized.start : normalized.duration) + ' seçili · ' + normalized.width + ' × ' + normalized.height + ' piksel · ' + (normalized.muted || normalized.volume === 0 ? 'Sessiz' : 'Kaynak sesi');
      valid = true;
      if (!quiet && !operation) {
        if (!capabilities.supported) message(capabilities.reason || 'Bu cihaz video dışa aktarmayı desteklemiyor.', true);
        else message('Kesilecek bölümü ve görünümü düzenle. Sonra videoyu dışa aktar.');
      }
    } catch (error) {
      valid = false;
      if (!operation) message(error.message || 'Video ayarlarını kontrol edin.', true);
    }
    $('clipTextCount').textContent = $('clipText').value.length + ' / 300';
    updateTime(); setEnabled(); return valid;
  }
  function stopPreview() {
    ++playVersion;
    if (previewFrame) global.cancelAnimationFrame(previewFrame);
    previewFrame = 0; lastPreview = 0;
    if (session) session.video.pause();
    $('clipPlayButton').textContent = '▶ Oynat';
  }
  function previewLoop(time) {
    previewFrame = 0;
    if (!session || session.video.paused || operation || !dialog.open) return;
    if (session.video.currentTime >= Number($('clipEnd').value)) { stopPreview(); renderPreview(true); return; }
    if (!lastPreview || time - lastPreview > 40) { renderPreview(true); lastPreview = time; }
    previewFrame = global.requestAnimationFrame(previewLoop);
  }
  async function playPreview() {
    if (!session || operation) return;
    if (!session.video.paused) { stopPreview(); return; }
    if (!renderPreview(true)) return;
    const playing = session, version = ++playVersion;
    try {
      const o = normalize(); syncAudio();
      if (session.video.currentTime < o.start || session.video.currentTime >= o.end) session.video.currentTime = o.start;
      await playing.video.play();
      if (version !== playVersion || session !== playing || operation || !dialog.open) { playing.video.pause(); return; }
      $('clipPlayButton').textContent = 'Ⅱ Duraklat';
      previewFrame = global.requestAnimationFrame(previewLoop);
    } catch (error) { if (session === playing && version === playVersion) { message(error.message || 'Önizleme oynatılamadı.', true); stopPreview(); } }
  }
  function disposeSession(value) { if (value) { try { value.dispose(); } catch (_) { /* Disposal is best effort. */ } } }
  function clearSession() {
    stopPreview(); disposeSession(session); session = null; valid = false; rotation = 0;
    $('clipFileName').textContent = 'Henüz video seçilmedi'; $('clipMetadata').textContent = 'MP4 veya WebM · En fazla 120 MB, 5 dakika ve 4K';
    $('clipEmpty').classList.remove('hidden'); $('clipCanvas').classList.add('hidden');
    $('clipCanvas').width = 1; $('clipCanvas').height = 1;
    $('clipSummary').textContent = 'En fazla 60 saniyelik bir bölümü dışa aktarabilirsin.';
    $('clipFileInput').value = ''; $('clipText').value = ''; $('clipTextCount').textContent = '0 / 300';
    updateTime(); setEnabled();
  }
  function acquire(name) {
    if (typeof global.StudioApp?.beginExternalOperation !== 'function') throw Error('Düzenleyici hazır değil. Biraz bekleyip yeniden deneyin.');
    controller = new AbortController();
    releaseOperation = global.StudioApp.beginExternalOperation(name, cancel);
    operation = name === 'Video açılıyor' ? 'import' : 'export';
    $('clipProgress').removeAttribute('value'); setEnabled();
    return controller;
  }
  function finish() {
    const release = releaseOperation; releaseOperation = null; controller = null; operation = '';
    if (release) release();
    $('clipProgress').value = 0; setEnabled();
  }
  function refreshCapabilities() {
    capabilities = engine.inspectCapabilities();
    const select = $('clipFormat'), previous = select.value; select.textContent = '';
    for (const format of capabilities.formats || []) {
      const option = document.createElement('option'); option.value = format.id; option.textContent = format.label || format.id.toUpperCase(); select.append(option);
    }
    if ((capabilities.formats || []).some(f => f.id === previous)) select.value = previous;
    else if ((capabilities.formats || []).some(f => f.id === 'webm')) select.value = 'webm';
    if (!capabilities.supported) message(capabilities.reason || 'Bu cihaz video dışa aktarmayı desteklemiyor. Güncel Chrome veya Edge ile deneyin.', true);
    setEnabled();
  }
  function setupSession(next) {
    session = next; rotation = 0;
    $('clipFileName').textContent = next.name || 'Seçilen video';
    $('clipMetadata').textContent = next.width + ' × ' + next.height + ' piksel · ' + clock(next.duration) + ' kaynak';
    $('clipStart').value = '0'; $('clipEnd').value = String(Math.min(60, next.duration));
    $('clipStart').max = String(next.duration); $('clipEnd').max = String(next.duration);
    $('clipSeek').max = String(next.duration); $('clipSeek').value = '0';
    $('clipRatio').value = 'original'; $('clipFit').value = 'contain'; $('clipRotateButton').textContent = '↻ 0°';
    $('clipVolume').value = '100'; $('clipMuted').checked = !capabilities.audioSupported;
    $('clipText').value = ''; $('clipTextPosition').value = 'bottom';
    $('clipEmpty').classList.add('hidden'); $('clipCanvas').classList.remove('hidden');
    const current = next;
    for (const event of ['loadeddata', 'canplay']) next.video.addEventListener(event, () => { if (session === current && !operation) renderPreview(true); });
    next.video.addEventListener('seeked', () => { if (session === current && !operation) renderPreview(true); });
    next.video.addEventListener('ended', () => { if (session === current) { stopPreview(); renderPreview(true); } });
    next.video.addEventListener('error', () => { if (session === current && !operation) message('Video okunamadı. Başka bir dosya seçin.', true); });
    // Metadata-only loading is enough for validation, but the preview also
    // needs a decoded first frame. Request it only after open() succeeded.
    next.video.preload = 'auto';
    // Chromium can keep a detached metadata-only video at readyState 1 even
    // after changing preload. A tiny paused seek requests the first frame
    // without autoplaying the source or starting audio.
    try { next.video.currentTime = Math.min(0.001, next.duration); } catch (_) { /* Play remains available if seeking is unsupported. */ }
    syncAudio(); renderPreview();
    if (!capabilities.supported) message(capabilities.reason || 'Bu cihaz video dışa aktarmayı desteklemiyor.', true);
    else if (!capabilities.audioSupported) message('Bu cihazda sesli çıktı kullanılamıyor. Sessiz seçeneğiyle dışa aktarabilirsin.');
  }
  async function importFile(file) {
    if (!file || operation || disposed) return;
    const serial = ++ticket; let next = null, acquired = false;
    stopPreview();
    try {
      const token = acquire('Video açılıyor'); acquired = true;
      message('Video cihazında açılıyor ve denetleniyor…');
      next = await engine.open(file, { signal: token.signal });
      if (token.signal.aborted || serial !== ticket || !dialog.open) throw abortError();
      const previous = session; setupSession(next); next = null; disposeSession(previous);
    } catch (error) { message(error.name === 'AbortError' ? 'Video açma iptal edildi. Önceki klip korundu.' : error.message || 'Video açılamadı.', error.name !== 'AbortError'); }
    finally { disposeSession(next); if (acquired) finish(); if (session) renderPreview(true); }
  }
  function download(blob, name) {
    const url = URL.createObjectURL(blob), anchor = document.createElement('a');
    anchor.href = url; anchor.download = name; document.body.append(anchor); anchor.click(); anchor.remove();
    global.setTimeout(() => URL.revokeObjectURL(url), 15000);
  }
  async function exportVideo() {
    if (!session || operation || !renderPreview(true) || !capabilities.supported) return;
    stopPreview(); let acquired = false;
    try {
      const snapshot = session; normalize();
      // Keep the selected resolution, rather than the derived canvas width:
      // very tall source videos may be scaled below 720 to stay within limits.
      const o = options(), token = acquire('Video dışa aktarılıyor'); acquired = true;
      $('clipProgress').value = 0; message('Video oluşturuluyor. Bu pencereyi açık ve görünür tut.');
      const result = await engine.exportClip(snapshot, { ...o, signal: token.signal, onProgress(value) {
        if (operation !== 'export' || token.signal.aborted) return;
        $('clipProgress').value = Math.max(0, Math.min(1, Number(value) || 0));
        message(Math.round($('clipProgress').value * 100) + '% · Video oluşturuluyor…');
      } });
      if (token.signal.aborted || !dialog.open || session !== snapshot) throw abortError();
      const name = slug(snapshot.name) + '-duzenlendi.' + (result.mime.startsWith('video/mp4') ? 'mp4' : 'webm');
      if (global.StudioDesktop && typeof global.StudioDesktop.saveVideo === 'function') {
        operation = 'save'; setEnabled(); message('Videonun kaydedileceği konumu seç. İptal etmek için kaydetme penceresini kapat.');
        const saved = await global.StudioDesktop.saveVideo(result.dataUrl, name);
        if (saved?.canceled) { message('Kaydetme iptal edildi. Klibin açık kalıyor.'); return; }
        if (!saved?.ok) throw Error(saved?.error || 'Video kaydedilemedi.');
      } else download(result.blob, name);
      message('Video kaydedildi. Kaynak dosyan değişmedi.');
    } catch (error) { message(error.name === 'AbortError' ? 'Video oluşturma iptal edildi. Klibini düzenlemeye devam edebilirsin.' : error.message || 'Video oluşturulamadı.', error.name !== 'AbortError'); }
    finally { if (acquired) finish(); if (session) renderPreview(true); }
  }
  function cancel() {
    stopPreview();
    if (!operation) return false;
    if (operation === 'save') { message('İptal etmek için açık kaydetme penceresini kapat.'); return true; }
    if (controller && !controller.signal.aborted) { controller.abort(); message('İşlem iptal ediliyor…'); setEnabled(); }
    return true;
  }
  function close() {
    if (operation) { cancel(); return false; }
    if (dialog.open) dialog.close();
    clearSession(); return true;
  }
  async function open() {
    if (disposed || global.document.getElementById('app')?.dataset.busy === 'true') return;
    await global.StudioApp.ready;
    if (disposed || $('app').dataset.busy === 'true') return;
    refreshCapabilities();
    if (!dialog.open) dialog.showModal();
    if (!session && capabilities.supported) message('Cihazından bir video seçerek başla. Dosyan internete yüklenmez.');
  }
  function pause() {
    stopPreview();
    if (operation && operation !== 'save') cancel();
  }
  function dispose() {
    ++ticket; cancel(); clearSession(); disposed = true;
    if (dialog.open) dialog.close();
  }
  function handleBack() {
    if (!dialog.open) return false;
    if (operation) cancel(); else close(); return true;
  }

  button.onclick = open;
  $('clipCloseButton').onclick = close;
  $('clipChooseButton').onclick = () => { if (!operation) $('clipFileInput').click(); };
  $('clipFileInput').onchange = event => { const file = event.target.files && event.target.files[0]; event.target.value = ''; importFile(file); };
  $('clipForgetButton').onclick = () => { if (!operation) { clearSession(); message('Klip temizlendi. Yeni bir video seçebilirsin.'); } };
  $('clipPlayButton').onclick = playPreview;
  $('clipSeek').addEventListener('input', () => { if (session && !operation) seekTimeline(Number($('clipSeek').value) || 0); });
  for (const [id, kind] of [['clipStartHandle', 'start'], ['clipEndHandle', 'end'], ['clipPlayhead', 'play'], ['clipSelection', 'selection']]) {
    $(id).addEventListener('pointerdown', event => startTimelineDrag(event, kind));
    $(id).addEventListener('keydown', event => timelineKeyboard(event, kind));
  }
  $('clipTimeline').addEventListener('pointerdown', event => {
    if (session && !operation && event.target !== $('clipSelection') && !event.target.closest('button')) { event.preventDefault(); seekTimeline(timelineAt(event.clientX)); }
  });
  $('clipMarkStart').onclick = () => { if (session && !operation) { $('clipStart').value = (Number(session.video.currentTime) || 0).toFixed(1); renderPreview(); } };
  $('clipMarkEnd').onclick = () => { if (session && !operation) { $('clipEnd').value = (Number(session.video.currentTime) || 0).toFixed(1); renderPreview(); } };
  $('clipRotateButton').onclick = () => { if (session && !operation) { rotation = (rotation + 90) % 360; $('clipRotateButton').textContent = '↻ ' + rotation + '°'; renderPreview(); } };
  for (const id of ['clipStart', 'clipEnd', 'clipRatio', 'clipFit', 'clipVolume', 'clipText', 'clipTextPosition', 'clipFormat', 'clipWidth']) $(id).addEventListener('input', () => { if (!operation) { syncAudio(); renderPreview(); } });
  $('clipMuted').addEventListener('change', () => { if (!operation) { syncAudio(); renderPreview(); } });
  $('clipExportButton').onclick = exportVideo; $('clipCancelButton').onclick = cancel;
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  dialog.addEventListener('close', () => { if (dialog.open) return; ++ticket; if (operation) cancel(); clearSession(); });
  global.addEventListener('studio-command', event => { if (event.detail === 'clip-editor') open(); });
  global.addEventListener('studio-pause', pause);
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
  // The main editor may refuse closing after a failed project autosave. Keep
  // the video session until the page actually exits or the user closes it.
  global.addEventListener('studio-before-close', pause);
  global.addEventListener('pagehide', dispose);
  global.addEventListener('pageshow', event => { if (event.persisted) disposed = false; });
  clearSession();
  global.StudioClipUI = Object.freeze({ open, close, cancel, pause, dispose, handleBack, getState: () => ({ hasClip: !!session, operation, filename: session?.name || '' }) });
})(window);
