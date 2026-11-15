package com.karevo.studio;

import android.graphics.BitmapFactory;
import android.util.Base64;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.text.Normalizer;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Bounded, format-checked payloads accepted by the offline editor bridge. */
final class ExportData {
    static final int MAX_PROJECT = 100 * 1024 * 1024;
    static final int MAX_IMAGE = 48 * 1024 * 1024;
    static final int MAX_VIDEO = 40 * 1024 * 1024;
    static final int MAX_TEXT = 10 * 1024 * 1024;
    final byte[] bytes;
    final String mime, name;
    final int count;
    ExportData(byte[] bytes, String mime, String name, int count) {
        this.bytes = bytes; this.mime = mime; this.name = name; this.count = count;
    }

    static ExportData image(String url, String name) throws IOException {
        if (url == null || url.length() > ((MAX_IMAGE + 2L) / 3L) * 4L + 100L) throw invalid("Görsel en fazla 48 MB olabilir.");
        String mime; int offset;
        if (url.startsWith("data:image/png;base64,")) { mime = "image/png"; offset = 22; }
        else if (url.startsWith("data:image/jpeg;base64,")) { mime = "image/jpeg"; offset = 23; }
        else throw invalid("Yalnızca PNG ve JPEG görsel kaydedilebilir.");
        byte[] bytes = decode(url.substring(offset), MAX_IMAGE);
        boolean png = bytes.length >= 24 && uint32(bytes, 0) == 0x89504e47L && uint32(bytes, 4) == 0x0d0a1a0aL;
        boolean jpeg = bytes.length >= 4 && (bytes[0] & 255) == 255 && (bytes[1] & 255) == 216 && (bytes[2] & 255) == 255;
        if (!(mime.equals("image/png") ? png : jpeg)) throw invalid("Görsel dosya başlığı geçersiz.");
        BitmapFactory.Options dimensions = new BitmapFactory.Options();
        dimensions.inJustDecodeBounds = true;
        BitmapFactory.decodeByteArray(bytes, 0, bytes.length, dimensions);
        if (dimensions.outWidth < 1 || dimensions.outHeight < 1 || dimensions.outWidth > 20000 || dimensions.outHeight > 20000
                || (long) dimensions.outWidth * dimensions.outHeight > 48_000_000L) throw invalid("Görsel en fazla 48 milyon piksel olabilir.");
        return new ExportData(bytes, mime, filename(name, png ? ".png" : ".jpg"), 1);
    }

    static ExportData video(String url, String name) throws IOException {
        if (url == null || url.length() > ((MAX_VIDEO + 2L) / 3L) * 4L + 512L) throw invalid("Video en fazla 40 MB olabilir.");
        int comma = url.indexOf(',');
        if (comma < 0 || comma > 256) throw invalid("Video verisi geçersiz.");
        Matcher header = Pattern.compile("^data:video/(mp4|webm)(?:;codecs=[A-Za-z0-9., _\"=-]+)?;base64$", Pattern.CASE_INSENSITIVE).matcher(url.substring(0, comma));
        if (!header.matches()) throw invalid("Yalnızca MP4 veya WebM video kaydedilebilir.");
        byte[] bytes = decode(url.substring(comma + 1), MAX_VIDEO);
        String kind = header.group(1).toLowerCase(Locale.US);
        if (kind.equals("mp4")) validateMp4(bytes); else validateWebm(bytes);
        return new ExportData(bytes, "video/" + kind, filename(name, "." + kind), 1);
    }

    static ExportData text(String text, String name) throws IOException {
        if (text == null || text.length() > MAX_TEXT) throw invalid("Metin çıktısı en fazla 10 MB olabilir.");
        Matcher ext = Pattern.compile("\\.(csv|ics|txt)$", Pattern.CASE_INSENSITIVE).matcher(name == null ? "" : name);
        if (!ext.find()) throw invalid("Yalnızca CSV, ICS veya TXT dosyası kaydedilebilir.");
        String kind = ext.group(1).toLowerCase(Locale.US);
        byte[] bytes = text.getBytes(StandardCharsets.UTF_8);
        if (bytes.length > MAX_TEXT) throw invalid("Metin çıktısı en fazla 10 MB olabilir.");
        return new ExportData(bytes, kind.equals("csv") ? "text/csv" : kind.equals("ics") ? "text/calendar" : "text/plain", filename(name, "." + kind), 1);
    }

    static String filename(String value, String extension) {
        String name = value == null ? "Karevo" : value;
        name = name.replace('\\', '/'); name = name.substring(name.lastIndexOf('/') + 1);
        name = name.replaceAll("(?i)\\.(png|jpe?g|mp4|webm|karevo|bulten|netice|json|csv|ics|txt|zip)$", "");
        name = Normalizer.normalize(name.replace('ı', 'i').replace('İ', 'I'), Normalizer.Form.NFD).replaceAll("\\p{M}", "");
        name = name.replaceAll("[^A-Za-z0-9._-]", "_").replaceAll("^\\.+", "").replaceAll("[. ]+$", "");
        if (name.length() > 90) name = name.substring(0, 90);
        if (name.isEmpty()) name = "Karevo";
        return name + extension;
    }

    private static byte[] decode(String encoded, int max) throws IOException {
        if (encoded.isEmpty() || encoded.length() % 4 != 0 || encoded.length() > ((max + 2L) / 3L) * 4L) throw invalid("Dosya verisi eksik veya çok büyük.");
        int padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;
        for (int i = 0; i < encoded.length() - padding; i++) {
            char c = encoded.charAt(i);
            if (!((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '+' || c == '/')) throw invalid("Dosya kodlaması geçersiz.");
        }
        try {
            byte[] bytes = Base64.decode(encoded, Base64.NO_WRAP);
            if (bytes.length < 1 || bytes.length > max) throw invalid("Dosya çok büyük veya boş.");
            return bytes;
        } catch (IllegalArgumentException error) { throw invalid("Dosya kodlaması geçersiz."); }
    }

    private static long uint32(byte[] bytes, int offset) throws IOException {
        if (offset < 0 || offset + 4 > bytes.length) throw invalid("Dosya başlığı eksik.");
        return ((bytes[offset] & 255L) << 24) | ((bytes[offset + 1] & 255L) << 16) | ((bytes[offset + 2] & 255L) << 8) | (bytes[offset + 3] & 255L);
    }
    private static void validateMp4(byte[] bytes) throws IOException {
        long offset = 0; int count = 0; boolean moov = false, data = false;
        while (offset < bytes.length) {
            if (offset + 8 > bytes.length || ++count > 100000) throw invalid("MP4 kutu yapısı geçersiz.");
            int position = (int) offset, header = 8;
            long length = uint32(bytes, position);
            String type = new String(bytes, position + 4, 4, StandardCharsets.US_ASCII);
            if (length == 1) {
                if (offset + 16 > bytes.length || uint32(bytes, position + 8) != 0) throw invalid("MP4 kutu boyutu geçersiz.");
                length = uint32(bytes, position + 12); header = 16;
            } else if (length == 0) length = bytes.length - offset;
            if (length < header || offset + length > bytes.length || !type.matches("[\\x20-\\x7e]{4}")) throw invalid("MP4 dosyası eksik veya bozuk.");
            if (offset == 0 && (!type.equals("ftyp") || length < header + 8 || length > 4096)) throw invalid("MP4 dosya başlığı geçersiz.");
            if (type.equals("moov") && length > header) moov = true;
            if (type.equals("mdat") && length > header) data = true;
            offset += length;
        }
        if (!moov || !data) throw invalid("MP4 video bilgisi veya görüntü verisi bulunamadı.");
    }
    private static final class Ebml {
        final int width; final long value; final boolean unknown;
        Ebml(int width, long value, boolean unknown) { this.width = width; this.value = value; this.unknown = unknown; }
    }
    private static Ebml ebml(byte[] bytes, int offset) throws IOException {
        if (offset < 0 || offset >= bytes.length || bytes[offset] == 0) throw invalid("WebM öğesi geçersiz.");
        int width = 1, mask = 128;
        while (((bytes[offset] & 255) & mask) == 0) { width++; mask >>= 1; }
        if (width > 8 || offset + width > bytes.length) throw invalid("WebM başlığı eksik.");
        long value = bytes[offset] & (mask - 1);
        for (int i = 1; i < width; i++) value = value * 256 + (bytes[offset + i] & 255);
        return new Ebml(width, value, value == (1L << (width * 7)) - 1L);
    }
    private static void validateWebm(byte[] bytes) throws IOException {
        if (bytes.length < 20 || uint32(bytes, 0) != 0x1a45dfa3L) throw invalid("WebM dosya başlığı geçersiz.");
        Ebml length = ebml(bytes, 4);
        if (length.unknown || length.value > 4096) throw invalid("WebM başlığı geçersiz.");
        int start = 4 + length.width, end = start + (int) length.value;
        if (end > bytes.length) throw invalid("WebM başlığı eksik.");
        boolean docType = false; int offset = start;
        while (offset < end) {
            int width = 1, mask = 128;
            while (width <= 4 && ((bytes[offset] & 255) & mask) == 0) { width++; mask >>= 1; }
            if (width > 4 || offset + width > end) throw invalid("WebM başlık öğesi geçersiz.");
            boolean isDocType = width == 2 && (bytes[offset] & 255) == 0x42 && (bytes[offset + 1] & 255) == 0x82;
            Ebml size = ebml(bytes, offset + width);
            int content = offset + width + size.width;
            if (size.unknown || size.value > end - content || content > end) throw invalid("WebM başlık öğesi eksik.");
            if (isDocType && size.value == 4 && new String(bytes, content, 4, StandardCharsets.US_ASCII).equals("webm")) docType = true;
            offset = content + (int) size.value;
        }
        if (!docType || end + 5 >= bytes.length || uint32(bytes, end) != 0x18538067L) throw invalid("WebM video bölümü bulunamadı.");
        Ebml segment = ebml(bytes, end + 4);
        int dataOffset = end + 4 + segment.width;
        if (dataOffset >= bytes.length || (!segment.unknown && segment.value != bytes.length - dataOffset)) throw invalid("WebM video bölümü eksik.");
    }
    private static IOException invalid(String message) { return new IOException(message); }
}
