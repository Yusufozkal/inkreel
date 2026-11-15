/* Karevo — local CSV production lists and calendar planning. */
(function (root) {
  'use strict';

  const MAX_CSV_BYTES = 2 * 1024 * 1024;
  const MAX_RECORDS = 100;
  const POST_KEYS = ['caption', 'altText', 'sourceUrl', 'publishAt', 'status'];
  const LIMITS = { headline: 500, subtitle: 200, category: 80, source: 300, caption: 5000, altText: 2000, sourceUrl: 2000, boardName: 100, photo: 255 };
  const EXPORT_KEYS = ['boardName', 'headline', 'subtitle', 'category', 'source', 'photo', 'caption', 'altText', 'sourceUrl', 'publishAt', 'status'];
  const EXPORT_HEADERS = ['çalışma_adı', 'başlık', 'üst_bilgi', 'kategori', 'kaynak', 'fotoğraf', 'açıklama', 'alternatif_metin', 'kaynak_bağlantısı', 'yayın_tarihi', 'durum'];
  const aliases = new Map();
  function key(value) { return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ı/g, 'i').toLowerCase().replace(/[^a-z0-9]/g, ''); }
  const aliasLists = {
    headline: ['headline', 'title', 'başlık', 'baslik', 'haber başlığı'],
    subtitle: ['subtitle', 'üst_bilgi', 'üst bilgi', 'alt_metni', 'alt metni', 'alt başlık'],
    category: ['category', 'kategori'], source: ['source', 'kaynak'],
    photo: ['photo', 'image', 'fotoğraf', 'fotograf', 'görsel'],
    caption: ['caption', 'açıklama', 'aciklama', 'paylaşım metni'],
    altText: ['altText', 'alt_text', 'alternatif_metin', 'alternatif metin'],
    sourceUrl: ['sourceUrl', 'source_url', 'kaynak_bağlantısı', 'kaynak bağlantısı', 'kaynak_url'],
    publishAt: ['publishAt', 'publish_at', 'yayın_tarihi', 'yayin_tarihi', 'yayın zamanı'],
    status: ['status', 'durum'], boardName: ['boardName', 'board_name', 'çalışma_adı', 'calisma_adi', 'tasarım adı']
  };
  for (const [canonical, names] of Object.entries(aliasLists)) for (const name of names) aliases.set(key(name), canonical);
  const own = (value, name) => Object.prototype.hasOwnProperty.call(value, name);
  const byteLength = value => typeof root.TextEncoder === 'function' ? new root.TextEncoder().encode(value).length : unescape(encodeURIComponent(value)).length;
  const rowError = (row, message) => new Error('CSV satır ' + row + ': ' + message);
  function core() {
    if (!root.StudioCore) throw new Error('Proje çekirdeği yüklenemedi. Uygulamayı yeniden açın.');
    return root.StudioCore;
  }
  function localDate(value, row) {
    if (!value) return '';
    const normalized = value.replace(/^(\d{4}-\d{2}-\d{2}) /, '$1T');
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(normalized);
    let valid = false;
    if (match) {
      const [year, month, day, hour, minute, second] = match.slice(1).map(part => Number(part || 0));
      const d = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
      valid = year >= 1000 && d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day && d.getUTCHours() === hour && d.getUTCMinutes() === minute && d.getUTCSeconds() === second;
    }
    if (!valid) throw rowError(row, 'Yayın tarihi YYYY-MM-DDTHH:mm biçiminde geçerli bir tarih ve saat olmalı (örnek: 2026-10-20T14:30).');
    return normalized;
  }
  function statusValue(value, row) {
    if (!value) return '';
    const names = { draft: 'draft', taslak: 'draft', ready: 'ready', hazir: 'ready', published: 'published', yayinda: 'published', yayimlandi: 'published', yayinlandi: 'published' };
    const normalized = key(value), result = own(names, normalized) ? names[normalized] : '';
    if (!result) throw rowError(row, 'Durum taslak/draft, hazır/ready veya yayımlandı/published olmalı.');
    return result;
  }
  function sourceUrl(value, row) {
    if (!value) return '';
    let valid = false;
    try {
      const url = new root.URL(value);
      valid = url.protocol === 'https:' && !!url.hostname && !url.username && !url.password && !/[\u0000-\u0020\u007f\\]/.test(value);
    } catch (_) { /* A single readable error is enough. */ }
    if (!valid) throw rowError(row, 'Kaynak bağlantısı https:// ile başlayan geçerli bir adres olmalı.');
    return value;
  }
  function validateRecord(record, row) {
    for (const [name, limit] of Object.entries(LIMITS)) if (own(record, name) && record[name].length > limit) throw rowError(row, '“' + name + '” alanı en fazla ' + limit + ' karakter olabilir.');
    if (!record.headline || !record.headline.trim()) throw rowError(row, 'Başlık boş olamaz.');
    if (own(record, 'status')) record.status = statusValue(record.status, row);
    if (own(record, 'publishAt')) record.publishAt = localDate(record.publishAt, row);
    if (own(record, 'sourceUrl')) record.sourceUrl = sourceUrl(record.sourceUrl, row);
    if (record.photo && (/^[a-z][a-z\d+.-]*:/i.test(record.photo) || /[/\\]/.test(record.photo))) throw rowError(row, 'Fotoğraf alanına internet adresi veya dosya yolu yerine seçilen yerel dosyanın adını yazın.');
  }
  function delimiterFor(text) {
    const counts = new Map([[',', 0], [';', 0], ['\t', 0]]);
    let quoted = false;
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (char === '"') {
        if (quoted && text[i + 1] === '"') i++; else quoted = !quoted;
      } else if (!quoted && (char === '\r' || char === '\n')) break;
      else if (!quoted && counts.has(char)) counts.set(char, counts.get(char) + 1);
    }
    return Array.from(counts).sort((a, b) => b[1] - a[1])[0][0];
  }
  function parseCsv(source) {
    if (typeof source !== 'string') throw new Error('CSV dosyası metin olarak okunamadı.');
    if (source.length > MAX_CSV_BYTES || byteLength(source) > MAX_CSV_BYTES) throw new Error('CSV dosyası en fazla 2 MB olabilir.');
    if (/\u0000/.test(source)) throw new Error('CSV dosyası geçersiz kontrol karakterleri içeriyor. UTF-8 CSV olarak kaydedin.');
    let text = source.replace(/^\ufeff/, '');
    // Blank lines before the header are harmless, including Windows line endings.
    text = text.replace(/^(?:[ \t]*(?:\r\n|\r|\n))+/, '');
    if (!text.trim()) throw new Error('CSV dosyası boş.');
    const delimiter = delimiterFor(text), rows = [];
    let fields = [], field = '', mode = 'plain', line = 1, rowStart = 1, touched = false;
    function finishField() { fields.push(field); field = ''; mode = 'plain'; }
    function finishRow() {
      finishField();
      if (fields.some(value => value.trim() !== '')) rows.push({ fields, line: rowStart });
      fields = []; touched = false;
      if (rows.length > MAX_RECORDS + 1) throw new Error('CSV dosyasında en fazla 100 dolu veri satırı olabilir.');
    }
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (mode === 'quoted') {
        if (char === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; } else mode = 'closed';
        } else if (char === '\r' || char === '\n') {
          if (char === '\r' && text[i + 1] === '\n') i++;
          field += '\n'; line++;
        } else field += char;
        touched = true; continue;
      }
      if (char === delimiter) { finishField(); touched = true; continue; }
      if (char === '\r' || char === '\n') {
        if (char === '\r' && text[i + 1] === '\n') i++;
        finishRow(); line++; rowStart = line; continue;
      }
      if (mode === 'closed') {
        if (char === ' ' || char === '\t') continue;
        throw rowError(line, 'Kapanan tırnaktan sonra yalnızca ayırıcı veya satır sonu gelebilir.');
      }
      if (char === '"') {
        if (field !== '') throw rowError(line, 'Tırnaklı bir alan tırnak ile başlamalı; metin içindeki tırnakları çift yazın.');
        mode = 'quoted'; touched = true; continue;
      }
      field += char; touched = true;
    }
    if (mode === 'quoted') throw rowError(rowStart, 'Tırnaklı alan kapanmamış.');
    if (touched || field || fields.length) finishRow();
    if (!rows.length) throw new Error('CSV dosyasında sütun başlığı bulunamadı.');
    const headerRow = rows.shift(), seen = new Set();
    const headers = headerRow.fields.map((header, index) => {
      const normalized = key(header.trim());
      if (!normalized) return '';
      const name = aliases.get(normalized) || normalized;
      if (seen.has(name)) throw rowError(headerRow.line, '“' + header.trim() + '” sütunu birden fazla kez kullanılmış.');
      seen.add(name); return name;
    });
    if (!headers.includes('headline')) throw new Error('CSV dosyasında “başlık” veya “headline” sütunu bulunmalı.');
    const records = rows.map(entry => {
      if (entry.fields.length > headers.length) throw rowError(entry.line, 'Veri sütunu sayısı başlık sütunu sayısını aşıyor. Virgüllü metinleri çift tırnak içine alın.');
      const record = Object.create(null);
      headers.forEach((name, index) => { if (name) record[name] = (entry.fields[index] || '').trim(); });
      Object.defineProperty(record, '$row', { value: entry.line });
      validateRecord(record, entry.line);
      return record;
    });
    return { headers, records, delimiter };
  }
  function photoEntries(photos) {
    if (photos instanceof Map) return Array.from(photos.entries());
    if (!photos || typeof photos !== 'object' || Array.isArray(photos)) return [];
    return Object.keys(photos).map(name => [name, photos[name]]);
  }
  function findPhoto(filename, entries) {
    const nfc = filename.normalize('NFC');
    const exact = entries.filter(([name]) => typeof name === 'string' && name.normalize('NFC') === nfc);
    if (exact.length) return { value: exact[0][1] };
    const folded = nfc.toLocaleLowerCase('tr-TR'), plain = nfc.toLowerCase();
    const matches = entries.filter(([name]) => typeof name === 'string' && (name.normalize('NFC').toLocaleLowerCase('tr-TR') === folded || name.normalize('NFC').toLowerCase() === plain));
    return matches.length === 1 ? { value: matches[0][1] } : { ambiguous: matches.length > 1 };
  }
  function prepareCsv(source, baseBoard, options) {
    const C = core(), parsed = parseCsv(source), opts = options || {};
    if (!baseBoard || !baseBoard.state) throw new Error('CSV için temel bir tasarım seçin.');
    const maximum = Number.isInteger(opts.maxCount) ? Math.max(0, Math.min(C.MAX_BOARDS, opts.maxCount)) : C.MAX_BOARDS;
    if (!parsed.records.length) throw new Error('CSV dosyasında içe aktarılacak veri satırı yok.');
    if (parsed.records.length > maximum) throw new Error('Bu projeye en fazla ' + maximum + ' tasarım daha eklenebilir; CSV dosyasında ' + parsed.records.length + ' satır var. Satır sayısını azaltın.');
    const entries = photoEntries(opts.photos), warnings = [], preview = [];
    const boards = parsed.records.map(record => {
      const row = record.$row, board = C.clone(baseBoard);
      board.id = C.id('board');
      board.name = record.boardName || record.headline.replace(/\s+/g, ' ').slice(0, 100);
      board.layers = (board.layers || []).map(layer => ({ ...layer, id: C.id('layer') }));
      for (const name of ['headline', 'subtitle', 'category', 'source']) if (own(record, name)) board.state[name] = record[name];
      // A new article starts a new publication record; only the visual identity is inherited.
      board.post = { caption: '', altText: '', sourceUrl: '', publishAt: '', status: 'draft' };
      for (const name of POST_KEYS) if (own(record, name) && record[name]) board.post[name] = record[name];
      if (own(record, 'photo')) {
        board.state.photo = ''; board.state.photoX = board.state.photoY = 0; board.state.photoZoom = 1;
        if (record.photo) {
          const match = findPhoto(record.photo, entries);
          if (typeof match.value === 'string' && match.value) board.state.photo = match.value;
          else warnings.push('Satır ' + row + ': “' + record.photo + '” ' + (match.ambiguous ? 'birden fazla seçili dosyayla eşleşiyor' : 'seçilen fotoğraflar arasında bulunamadı') + '; tasarım fotoğrafsız oluşturulacak.');
        }
      }
      preview.push({ row, title: record.headline, category: board.state.category, photo: own(record, 'photo') ? record.photo : (board.state.photo ? 'Mevcut tasarım fotoğrafı' : ''), status: board.post.status });
      return board;
    });
    let normalized;
    try {
      normalized = C.normalizeProject({ schema: C.SCHEMA, version: C.VERSION, name: 'CSV aktarımı', updated: Date.now(), activeId: boards[0].id, boards }).boards;
    } catch (error) { throw new Error('CSV tasarımları doğrulanamadı: ' + (error.message || 'Geçersiz tasarım verisi.')); }
    return { boards: normalized, preview, warnings };
  }
  function csvCell(value) {
    let text = value === undefined || value === null ? '' : String(value);
    if (/^[\s\uFEFF]*[=+\-@]/.test(text) || /^[\t\r]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  }
  function exportPlanCsv(project) {
    const value = core().normalizeProject(project);
    const lines = [EXPORT_HEADERS.map(csvCell).join(',')];
    for (const board of value.boards) {
      const record = { boardName: board.name, ...board.state, ...board.post, photo: '' };
      // Embedded image data stays in the project file, never in the planning spreadsheet.
      lines.push(EXPORT_KEYS.map(name => csvCell(record[name])).join(','));
    }
    return '\ufeff' + lines.join('\r\n') + '\r\n';
  }
  function icsEscape(value) { return String(value || '').replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,'); }
  function foldLine(line) {
    const lines = []; let current = '', length = 0;
    for (const char of line) {
      const bytes = byteLength(char);
      if (length + bytes > 75) { lines.push(current); current = ' '; length = 1; }
      current += char; length += bytes;
    }
    lines.push(current); return lines.join('\r\n');
  }
  function calendarTime(value) { return value.replace(/[-:]/g, '') + (value.length === 16 ? '00' : ''); }
  function endTime(value) {
    const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value).slice(1).map(n => Number(n || 0));
    const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], parts[3], parts[4] + 30, parts[5]));
    if (date.getUTCFullYear() > 9999) return null;
    return date.toISOString().slice(0, 19).replace(/[-:]/g, '');
  }
  function exportIcs(project) {
    const value = core().normalizeProject(project);
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Karevo//Offline Publication Planner//TR', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Karevo yayın planı'];
    for (const board of value.boards) {
      if (!board.post.publishAt) continue;
      const end = endTime(board.post.publishAt);
      const description = [board.post.caption, board.post.sourceUrl ? 'Kaynak: ' + board.post.sourceUrl : '', 'Durum: ' + ({ draft: 'Taslak', ready: 'Hazır', published: 'Yayımlandı' })[board.post.status]].filter(Boolean).join('\n');
      lines.push('BEGIN:VEVENT', 'UID:' + board.id + '@bultenstudio.local', 'DTSTAMP:' + stamp, 'DTSTART:' + calendarTime(board.post.publishAt), end ? 'DTEND:' + end : 'DURATION:PT30M', 'SUMMARY:' + icsEscape(board.state.headline.replace(/\*\*/g, '')), 'DESCRIPTION:' + icsEscape(description));
      if (board.state.category) lines.push('CATEGORIES:' + icsEscape(board.state.category));
      if (board.post.sourceUrl) lines.push('URL:' + board.post.sourceUrl);
      lines.push('STATUS:' + (board.post.status === 'draft' ? 'TENTATIVE' : 'CONFIRMED'), 'TRANSP:TRANSPARENT', 'END:VEVENT');
    }
    lines.push('END:VCALENDAR');
    return lines.map(foldLine).join('\r\n') + '\r\n';
  }
  function exampleCsv() {
    const lines = [EXPORT_HEADERS, ['Duyuru', 'Şehirde kültür buluşması', 'KÜLTÜR SANAT', 'KÜLTÜR', '', 'kultur.jpg', 'Etkinlikten gelişmeleri bu alana yazın.', 'Etkinlik alanından bir fotoğraf.', 'https://example.com/etkinlik', '', 'taslak'], ['Bilgilendirme', 'Haftanın teknoloji notları', 'HAFTALIK SEÇKİ', 'TEKNOLOJİ', '', '', 'Öne çıkan başlıkları bu alana yazın.', '', '', '', 'hazır']];
    return '\ufeff' + lines.map(values => values.map(csvCell).join(',')).join('\r\n') + '\r\n';
  }
  const api = Object.freeze({ parseCsv, prepareCsv, exportPlanCsv, exportIcs, exampleCsv });
  root.StudioWorkflow = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
