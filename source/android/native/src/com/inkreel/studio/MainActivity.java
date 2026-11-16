package com.inkreel.studio;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.ContentValues;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.provider.MediaStore;
import android.provider.OpenableColumns;
import android.database.Cursor;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

/** Offline editor. Only bundled local UI can invoke bounded user-initiated exports. */
public final class MainActivity extends Activity {
    private static final int PICK_FILES = 1001, CREATE_DOCUMENT = 1002, OPEN_PROJECT = 1003;
    private static final int MAX_PAYLOAD_CHARS = 144 * 1024 * 1024;
    private static final String ASSET_HOST = "appassets.androidplatform.net";
    private static final String EDITOR_URL = "https://" + ASSET_HOST + "/assets/index.html";
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final AtomicBoolean busy = new AtomicBoolean(false);
    private final Handler handler = new Handler(Looper.getMainLooper());
    private WebView webView;
    private FrameLayout root;
    private ValueCallback<Uri[]> fileCallback;
    private volatile boolean destroyed;
    private volatile boolean trustedPage;
    private final CloseRequest closeRequest = new CloseRequest();
    private AlertDialog closeDialog;
    private Runnable closeTimeout;
    private Pending pending;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
        root = new FrameLayout(this);
        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(21, 33, 54));
        root.addView(webView, new FrameLayout.LayoutParams(-1, -1));
        setContentView(root);
        configureInsets(); configureWebView();
        if (state == null || webView.restoreState(state) == null || !isEditorUrl(webView.getUrl())) webView.loadUrl(EDITOR_URL);
        final boolean restoringActivity = state != null;
        worker.execute(() -> {
            cleanExportCache();
            // A cold launch cannot receive the former Activity's picker result.
            // Retaining its operation would keep every new export locked forever.
            if (!restoringActivity) { clearPending(); return; }
            try { Pending restored = restorePending(); if (restored != null) { pending = restored; busy.set(true); } }
            catch (IOException error) { clearPending(); }
        });
    }
    private void configureInsets() {
        int background = Color.rgb(21, 33, 54);
        root.setBackgroundColor(background); getWindow().setStatusBarColor(background); getWindow().setNavigationBarColor(background);
        if (Build.VERSION.SDK_INT >= 29) { getWindow().setStatusBarContrastEnforced(false); getWindow().setNavigationBarContrastEnforced(false); }
        if (Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(false);
            WindowInsetsController controller = getWindow().getInsetsController();
            if (controller != null) controller.setSystemBarsAppearance(0, WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS);
            root.setOnApplyWindowInsetsListener((view, insets) -> {
                android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                android.graphics.Insets keyboard = insets.getInsets(WindowInsets.Type.ime());
                view.setPadding(bars.left, bars.top, bars.right, Math.max(bars.bottom, keyboard.bottom)); return insets;
            });
        } else {
            getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
            root.setOnApplyWindowInsetsListener((view, insets) -> { view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(), insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom()); return insets; });
        }
        root.requestApplyInsets();
    }
    private void configureWebView() {
        WebView.setWebContentsDebuggingEnabled(false);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true); settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false); settings.setAllowContentAccess(true);
        settings.setAllowFileAccessFromFileURLs(false); settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW); settings.setBlockNetworkLoads(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(false); settings.setSupportMultipleWindows(false);
        settings.setMediaPlaybackRequiresUserGesture(true); settings.setSafeBrowsingEnabled(true);
        settings.setBuiltInZoomControls(false);
        webView.addJavascriptInterface(new NativeBridge(), "KarevoAndroid");
        webView.setWebViewClient(new WebViewClient() {
            @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap icon) { trustedPage = isEditorUrl(url); }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) { return !request.isForMainFrame() || !isEditorUrl(request.getUrl().toString()); }
            @Override public boolean shouldOverrideUrlLoading(WebView view, String url) { return !isEditorUrl(url); }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl(); String asset = assetPath(uri);
                if (asset != null && "GET".equals(request.getMethod())) {
                    try { return new WebResourceResponse(assetMime(asset), "UTF-8", 200, "OK", assetHeaders(), getAssets().open(asset)); }
                    catch (IOException missing) { return blockedResponse(404, "Not Found"); }
                }
                String scheme = uri.getScheme();
                if ("data".equalsIgnoreCase(scheme) || "blob".equalsIgnoreCase(scheme)) return null;
                return blockedResponse(403, "Offline");
            }
            @Override public void onPageFinished(WebView view, String url) {
                trustedPage = isEditorUrl(url);
                if (trustedPage) view.evaluateJavascript("window.dispatchEvent(new Event('studio-native-ready'));", null);
            }
        });
        webView.setDownloadListener((url, userAgent, disposition, mime, length) -> toast("Kaydetmek için uygulamanın dışa aktarma düğmelerini kullanın."));
        webView.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (destroyed || !trustedPage) { callback.onReceiveValue(null); return true; }
                // A result belongs to the chooser that opened it. Replacing the
                // callback here would deliver an older selection to a new input.
                if (fileCallback != null) { callback.onReceiveValue(null); return true; }
                fileCallback = callback;
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("*/*");
                ArrayList<String> types = new ArrayList<>();
                for (String accept : params.getAcceptTypes()) {
                    if (accept == null) continue;
                    for (String part : accept.split(",")) {
                        String type = part.trim();
                        if (type.matches("[a-zA-Z0-9.+-]+/[a-zA-Z0-9.*+-]+")) types.add(type);
                        else if (type.equalsIgnoreCase(".csv")) { types.add("text/csv"); types.add("text/plain"); types.add("application/csv"); }
                        else if (type.equalsIgnoreCase(".json")) types.add("application/json");
                        // Custom project extensions are not assigned a consistent MIME by document providers.
                        else if (type.equalsIgnoreCase(".inkreel") || type.equalsIgnoreCase(".karevo") || type.equalsIgnoreCase(".bulten") || type.equalsIgnoreCase(".netice")) { types.clear(); types.add("*/*"); }
                    }
                }
                if (types.size() == 1 && !types.contains("*/*")) intent.setType(types.get(0));
                else if (!types.isEmpty() && !types.contains("*/*")) intent.putExtra(Intent.EXTRA_MIME_TYPES, types.toArray(new String[0]));
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE);
                try { startActivityForResult(intent, PICK_FILES); }
                catch (ActivityNotFoundException error) { fileCallback.onReceiveValue(null); fileCallback = null; toast("Dosya seçici bulunamadı."); }
                return true;
            }
        });
    }
    private static boolean isEditorUrl(String url) { return url != null && (EDITOR_URL.equals(url) || url.startsWith(EDITOR_URL + "#")); }
    /** No remote resources, query strings, encoded separators, or traversal are served. */
    private static String assetPath(Uri uri) {
        if (!"https".equalsIgnoreCase(uri.getScheme()) || !ASSET_HOST.equalsIgnoreCase(uri.getHost()) || (uri.getPort() != -1 && uri.getPort() != 443)
                || uri.getUserInfo() != null || uri.getQuery() != null || uri.getFragment() != null) return null;
        String encoded = uri.getEncodedPath();
        if (encoded == null || !encoded.startsWith("/assets/") || encoded.indexOf('%') >= 0 || encoded.indexOf('\\') >= 0) return null;
        String path = encoded.substring(8);
        for (String segment : path.split("/", -1)) if (!segment.matches("[A-Za-z0-9][A-Za-z0-9._-]*")) return null;
        if (!(path.equals("index.html") || path.equals("app.css") || path.equals("fonts.css") || path.equals("mobile.css")
                || path.equals("base-render.js") || path.equals("desktop-render.js") || path.equals("core.js") || path.equals("workflow.js")
                || path.equals("video.js") || path.equals("clip-editor.js") || path.equals("clip-ui.js") || path.equals("app.js") || path.equals("android-bridge.js") || path.equals("mobile.js") || path.startsWith("assets/"))) return null;
        return path;
    }
    private static String assetMime(String path) {
        if (path.endsWith(".html")) return "text/html"; if (path.endsWith(".css")) return "text/css"; if (path.endsWith(".js")) return "text/javascript";
        if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg"; if (path.endsWith(".png")) return "image/png"; if (path.endsWith(".svg")) return "image/svg+xml";
        if (path.endsWith(".woff2") || path.endsWith(".ttf")) return "font/ttf"; return "application/octet-stream";
    }
    private static Map<String, String> assetHeaders() {
        Map<String, String> headers = new HashMap<>();
        headers.put("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; media-src blob:; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
        headers.put("X-Content-Type-Options", "nosniff"); headers.put("Cache-Control", "no-store"); return headers;
    }
    private static WebResourceResponse blockedResponse(int code, String reason) { return new WebResourceResponse("text/plain", "UTF-8", code, reason, assetHeaders(), new ByteArrayInputStream(new byte[0])); }

    public final class NativeBridge {
        @JavascriptInterface public void request(String action, String payload, String id) {
            if (destroyed || !trustedPage || id == null || !id.matches("[A-Za-z0-9_.:-]{1,120}")) return;
            if (action == null || payload == null || payload.length() > MAX_PAYLOAD_CHARS) { notifyResult(id, object("ok", false, "error", "İstek çok büyük veya geçersiz.")); return; }
            if (action.equals("info")) { notifyResult(id, object("ok", true, "platform", "android", "version", "3.3.0")); return; }
            if (!busy.compareAndSet(false, true)) { notifyResult(id, object("ok", false, "error", "Önceki dosya işleminin bitmesini bekleyin.")); return; }
            worker.execute(() -> {
                try { handleRequest(action, new JSONObject(payload), id); }
                catch (OutOfMemoryError error) { complete(id, object("ok", false, "error", "Bellek yetersiz. Daha az tuval veya daha düşük çözünürlük deneyin.")); }
                catch (Exception error) { complete(id, object("ok", false, "error", safeMessage(error))); }
            });
        }
        @JavascriptInterface public void finishClose(boolean saved, int requestId) {
            runOnUiThread(() -> {
                if (destroyed || !trustedPage || !closeRequest.complete(requestId)) return;
                cancelCloseTimeout();
                if (closeDialog != null) { closeDialog.dismiss(); closeDialog = null; }
                if (saved) finish();
            });
        }
    }
    private void handleRequest(String action, JSONObject payload, String id) throws Exception {
        switch (action) {
            case "save-project": {
                String json = payload.getString("json");
                if (json.length() > ExportData.MAX_PROJECT) throw new IOException("Proje en fazla 100 MB olabilir.");
                byte[] bytes = json.getBytes(StandardCharsets.UTF_8);
                if (bytes.length > ExportData.MAX_PROJECT || !json.trim().startsWith("{")) throw new IOException("Proje dosyası geçersiz veya çok büyük.");
                stageDocument(new ExportData(bytes, "application/json", ExportData.filename(payload.optString("name"), ".inkreel"), 1), id, action); break;
            }
            case "open-project": {
                Pending item = new Pending(id, action, "application/json", "", 1);
                persistPending(item, null); pending = item;
                runOnUiThread(() -> {
                    if (destroyed) return;
                    Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*");
                    intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    try { startActivityForResult(intent, OPEN_PROJECT); }
                    catch (ActivityNotFoundException error) { clearPending(); pending = null; complete(id, object("ok", false, "error", "Dosya seçici bulunamadı.")); }
                }); break;
            }
            case "save-image": {
                ExportData image = ExportData.image(payload.getString("dataUrl"), payload.optString("name"));
                if (Build.VERSION.SDK_INT >= 29) saveToGallery(image, id); else stageDocument(image, id, action); break;
            }
            case "share-image": shareImage(ExportData.image(payload.getString("dataUrl"), payload.optString("name")), id); break;
            case "save-video": stageDocument(ExportData.video(payload.getString("dataUrl"), payload.optString("name")), id, action); break;
            case "save-text": stageDocument(ExportData.text(payload.getString("text"), payload.optString("name")), id, action); break;
            case "copy-text": {
                String text = payload.getString("text");
                if (text.length() > 10000) throw new IOException("Panoya en fazla 10.000 karakter kopyalanabilir.");
                runOnUiThread(() -> { try { ClipboardManager clipboard = (ClipboardManager) getSystemService(CLIPBOARD_SERVICE); if (clipboard == null) throw new IllegalStateException(); clipboard.setPrimaryClip(ClipData.newPlainText("Inkreel", text)); complete(id, object("ok", true)); } catch (Exception error) { complete(id, object("ok", false, "error", "Metin panoya kopyalanamadı.")); } }); break;
            }
            case "export-images": createImageZip(payload.getJSONArray("items"), id); break;
            default: throw new IOException("Bu işlem desteklenmiyor.");
        }
    }
    private void stageDocument(ExportData data, String id, String action) throws IOException {
        Pending item = new Pending(id, action, data.mime, data.name, data.count);
        persistPending(item, data.bytes); pending = item;
        runOnUiThread(() -> requestDocument(item));
    }
    private void createImageZip(JSONArray items, String id) throws Exception {
        if (items.length() < 1 || items.length() > 24) throw new IOException("Bir ZIP dosyası 1–24 görsel içerebilir.");
        clearPending(); File directory = pendingDirectory();
        if (!directory.isDirectory() && !directory.mkdirs()) throw new IOException("Dışa aktarma hazırlanamadı.");
        File archive = new File(directory, "document.bin");
        Set<String> names = new HashSet<>(); long total = 0;
        try (ZipOutputStream zip = new ZipOutputStream(new FileOutputStream(archive))) {
            for (int i = 0; i < items.length(); i++) {
                JSONObject item = items.getJSONObject(i); ExportData image = ExportData.image(item.getString("dataUrl"), item.optString("name"));
                total += image.bytes.length;
                if (total > ExportData.MAX_PROJECT) throw new IOException("Toplu çıktı en fazla 100 MB olabilir. Daha az tuval seçin.");
                String name = image.name; int number = 2, dot = name.lastIndexOf('.'); String base = name.substring(0, dot), ext = name.substring(dot);
                while (!names.add(name.toLowerCase(Locale.US))) name = base + "-" + number++ + ext;
                zip.putNextEntry(new ZipEntry(name)); zip.write(image.bytes); zip.closeEntry();
            }
        } catch (Exception | OutOfMemoryError error) { clearPending(); throw error; }
        if (archive.length() > ExportData.MAX_PROJECT + 65536) { clearPending(); throw new IOException("ZIP dosyası çok büyük."); }
        Pending item = new Pending(id, "export-images", "application/zip", "Inkreel-Gorseller.zip", items.length());
        persistMetadata(item); pending = item; runOnUiThread(() -> requestDocument(item));
    }
    private void requestDocument(Pending item) {
        if (destroyed) return;
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType(item.mime);
        intent.putExtra(Intent.EXTRA_TITLE, item.name); intent.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        try { startActivityForResult(intent, CREATE_DOCUMENT); }
        catch (ActivityNotFoundException error) { clearPending(); pending = null; complete(item.id, object("ok", false, "error", "Kaydetme konumu seçilemedi.")); }
    }
    private void saveToGallery(ExportData image, String id) throws IOException {
        ContentValues values = new ContentValues(); values.put(MediaStore.Images.Media.DISPLAY_NAME, image.name); values.put(MediaStore.Images.Media.MIME_TYPE, image.mime);
        values.put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/Inkreel"); values.put(MediaStore.Images.Media.IS_PENDING, 1);
        Uri uri = getContentResolver().insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
        if (uri == null) throw new IOException("Galeri dosyası oluşturulamadı.");
        boolean saved = false;
        try {
            try (OutputStream stream = getContentResolver().openOutputStream(uri, "w")) { if (stream == null) throw new IOException("Galeri açılamadı."); stream.write(image.bytes); stream.flush(); }
            ContentValues published = new ContentValues(); published.put(MediaStore.Images.Media.IS_PENDING, 0);
            if (getContentResolver().update(uri, published, null, null) < 1) throw new IOException("Galeri kaydı tamamlanamadı.");
            saved = true; complete(id, object("ok", true, "name", image.name, "folder", "Pictures/Inkreel", "count", 1));
        } finally { if (!saved) try { getContentResolver().delete(uri, null, null); } catch (Exception ignored) {} }
    }
    private void shareImage(ExportData image, String id) throws IOException {
        cleanExportCache(); File directory = new File(getCacheDir(), "exports");
        if (!directory.isDirectory() && !directory.mkdirs()) throw new IOException("Paylaşım dosyası hazırlanamadı.");
        int dot = image.name.lastIndexOf('.'); File file = File.createTempFile(image.name.substring(0, dot) + "_", image.name.substring(dot), directory);
        try (OutputStream stream = new FileOutputStream(file)) { stream.write(image.bytes); stream.flush(); }
        catch (IOException error) { file.delete(); throw error; }
        Uri uri = ExportProvider.uriFor(this, file);
        runOnUiThread(() -> {
            if (destroyed) return;
            Intent send = new Intent(Intent.ACTION_SEND).setType(image.mime).putExtra(Intent.EXTRA_STREAM, uri);
            send.setClipData(ClipData.newUri(getContentResolver(), "Inkreel görseli", uri)); send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            try { startActivity(Intent.createChooser(send, "Görseli paylaş").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)); complete(id, object("ok", true, "name", image.name, "count", 1)); }
            catch (ActivityNotFoundException error) { complete(id, object("ok", false, "error", "Paylaşım yapacak uygulama bulunamadı.")); }
        });
    }
    private File pendingDirectory() { return new File(getCacheDir(), "pending-export"); }
    private void persistPending(Pending item, byte[] bytes) throws IOException {
        clearPending(); File directory = pendingDirectory();
        if (!directory.isDirectory() && !directory.mkdirs()) throw new IOException("Dosya işlemi hazırlanamadı.");
        try {
            if (bytes != null) try (OutputStream stream = new FileOutputStream(new File(directory, "document.bin"))) { stream.write(bytes); stream.flush(); }
            persistMetadata(item);
        } catch (IOException error) { clearPending(); throw error; }
    }
    private void persistMetadata(Pending item) throws IOException {
        File directory = pendingDirectory();
        if (!directory.isDirectory() && !directory.mkdirs()) throw new IOException("Dosya işlemi hazırlanamadı.");
        byte[] metadata = object("id", item.id, "action", item.action, "mime", item.mime, "name", item.name, "count", item.count).toString().getBytes(StandardCharsets.UTF_8);
        File temporary = new File(directory, "metadata.tmp");
        try (OutputStream stream = new FileOutputStream(temporary)) { stream.write(metadata); stream.flush(); }
        if (!temporary.renameTo(new File(directory, "metadata.json"))) throw new IOException("Dosya bilgileri saklanamadı.");
    }
    private Pending restorePending() throws IOException {
        File metadata = new File(pendingDirectory(), "metadata.json");
        if (!metadata.isFile()) return null;
        try (InputStream stream = new FileInputStream(metadata)) {
            JSONObject data = new JSONObject(decodeUtf8(readBounded(stream, 4096)));
            String id = data.getString("id"), action = data.getString("action"), mime = data.getString("mime"), name = data.getString("name"); int count = data.getInt("count");
            if (!id.matches("[A-Za-z0-9_.:-]{1,120}") || !action.matches("open-project|save-project|save-image|save-video|save-text|export-images")
                    || !mime.matches("application/(json|zip)|image/(png|jpeg)|video/(mp4|webm)|text/(csv|calendar|plain)")
                    || (!name.isEmpty() && !name.matches("[A-Za-z0-9._-]{1,110}")) || count < 1 || count > 24) throw new IOException("Bekleyen dosya bilgisi geçersiz.");
            if (!action.equals("open-project")) { File bytes = new File(pendingDirectory(), "document.bin"); if (!bytes.isFile() || bytes.length() > ExportData.MAX_PROJECT + 65536) throw new IOException("Bekleyen dosya bulunamadı."); }
            return new Pending(id, action, mime, name, count);
        } catch (JSONException error) { throw new IOException("Bekleyen dosya bilgisi okunamadı.", error); }
    }
    private void clearPending() {
        File directory = pendingDirectory(); new File(directory, "metadata.tmp").delete(); new File(directory, "metadata.json").delete(); new File(directory, "document.bin").delete();
    }
    private void cleanExportCache() {
        File directory = new File(getCacheDir(), "exports"); File[] files = directory.listFiles(); if (files == null) return;
        Arrays.sort(files, Comparator.comparingLong(File::lastModified).reversed());
        long cutoff = System.currentTimeMillis() - 30L * 24 * 60 * 60 * 1000; int kept = 0;
        for (File file : files) try { if (file.isFile() && directory.getCanonicalFile().equals(file.getCanonicalFile().getParentFile()) && file.getName().matches("[A-Za-z0-9._-]+\\.(png|jpg|jpeg)")) { if (file.lastModified() < cutoff || kept++ >= 40) file.delete(); } } catch (IOException ignored) {}
    }
    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == PICK_FILES) {
            ValueCallback<Uri[]> callback = fileCallback; fileCallback = null; if (callback == null) return;
            if (destroyed || !trustedPage) { callback.onReceiveValue(null); return; }
            ArrayList<Uri> files = new ArrayList<>();
            if (resultCode == RESULT_OK && data != null) { ClipData clip = data.getClipData(); if (clip != null) { for (int i = 0; i < Math.min(clip.getItemCount(), 24); i++) addContentUri(files, clip.getItemAt(i).getUri()); } else addContentUri(files, data.getData()); }
            callback.onReceiveValue(files.isEmpty() ? null : files.toArray(new Uri[0])); return;
        }
        if (requestCode != CREATE_DOCUMENT && requestCode != OPEN_PROJECT) return;
        Uri uri = data == null ? null : data.getData(); busy.set(true);
        worker.execute(() -> {
            Pending item = pending; pending = null;
            try {
                if (item == null) item = restorePending();
                if (item == null) { busy.set(false); runOnUiThread(() -> toast("Bekleyen dosya bulunamadı. İşlemi yeniden başlatın.")); return; }
                if (resultCode != RESULT_OK || uri == null || !"content".equals(uri.getScheme())) { complete(item.id, object("ok", false, "canceled", true)); return; }
                if (requestCode == OPEN_PROJECT && item.action.equals("open-project")) {
                    byte[] bytes; try (InputStream stream = getContentResolver().openInputStream(uri)) { if (stream == null) throw new IOException("Proje dosyası açılamadı."); bytes = readBounded(stream, ExportData.MAX_PROJECT); }
                    String json = decodeUtf8(bytes); if (json.startsWith("\uFEFF")) json = json.substring(1);
                    if (!json.trim().startsWith("{")) throw new IOException("Bu dosya bir Inkreel projesi değil.");
                    String name = displayName(uri); if (!name.toLowerCase(Locale.US).matches(".*\\.(inkreel|karevo|bulten|netice|json)$")) throw new IOException(".inkreel, .karevo, .bulten, .netice veya .json proje dosyası seçin.");
                    complete(item.id, object("ok", true, "json", json, "name", name));
                } else if (requestCode == CREATE_DOCUMENT && !item.action.equals("open-project")) {
                    File file = new File(pendingDirectory(), "document.bin");
                    if (!file.isFile() || file.length() > ExportData.MAX_PROJECT + 65536) throw new IOException("Kaydedilecek dosya bulunamadı.");
                    try (InputStream input = new FileInputStream(file); OutputStream output = getContentResolver().openOutputStream(uri, "w")) { if (output == null) throw new IOException("Kaydetme konumu açılamadı."); copyBounded(input, output, ExportData.MAX_PROJECT + 65536L); output.flush(); }
                    complete(item.id, object("ok", true, "name", item.name, "count", item.count));
                } else throw new IOException("Dosya işlemi uyuşmuyor. Yeniden deneyin.");
            } catch (OutOfMemoryError error) { complete(item == null ? "orphan" : item.id, object("ok", false, "error", "Bellek yetersiz. Daha küçük proje deneyin.")); }
            catch (Exception error) { if (requestCode == CREATE_DOCUMENT && uri != null) try { android.provider.DocumentsContract.deleteDocument(getContentResolver(), uri); } catch (Exception ignored) {} complete(item == null ? "orphan" : item.id, object("ok", false, "error", safeMessage(error))); }
            finally { clearPending(); }
        });
    }
    private static void addContentUri(ArrayList<Uri> files, Uri uri) { if (uri != null && "content".equals(uri.getScheme()) && !files.contains(uri)) files.add(uri); }
    private String displayName(Uri uri) {
        try (Cursor cursor = getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) { String name = cursor.getString(0); if (name != null && name.length() <= 255) return name; }
        } catch (Exception ignored) {}
        return "Proje.inkreel";
    }
    private static byte[] readBounded(InputStream input, int max) throws IOException {
        ByteArrayOutputStream output = new ByteArrayOutputStream(Math.min(max, 65536)); copyBounded(input, output, max); return output.toByteArray();
    }
    private static void copyBounded(InputStream input, OutputStream output, long max) throws IOException {
        byte[] buffer = new byte[65536]; long total = 0; int count;
        while ((count = input.read(buffer)) != -1) { total += count; if (total > max) throw new IOException("Dosya izin verilen boyuttan büyük."); output.write(buffer, 0, count); }
    }
    private static String decodeUtf8(byte[] bytes) throws IOException {
        try { return StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString(); }
        catch (CharacterCodingException error) { throw new IOException("Proje UTF-8 biçiminde olmalı."); }
    }
    private static JSONObject object(Object... pairs) {
        JSONObject result = new JSONObject();
        try { for (int i = 0; i < pairs.length; i += 2) result.put((String) pairs[i], pairs[i + 1]); }
        catch (JSONException error) { throw new IllegalArgumentException(error); }
        return result;
    }
    private static String safeMessage(Exception error) { return error instanceof IOException && error.getMessage() != null ? error.getMessage() : "Dosya işlemi tamamlanamadı. Yeniden deneyin."; }
    private void complete(String id, JSONObject result) { busy.set(false); notifyResult(id, result); }
    private void notifyResult(String id, JSONObject result) {
        try { result.put("id", id); } catch (JSONException ignored) { return; }
        final String json = result.toString().replace("\u2028", "\\u2028").replace("\u2029", "\\u2029");
        runOnUiThread(() -> { if (!destroyed && trustedPage && webView != null) webView.evaluateJavascript("if(typeof window.StudioAndroidResult==='function'){window.StudioAndroidResult(" + json + ");}", null); });
    }
    private void toast(String message) { Toast.makeText(this, message, Toast.LENGTH_LONG).show(); }
    private void cancelCloseTimeout() { if (closeTimeout != null) handler.removeCallbacks(closeTimeout); closeTimeout = null; }
    private void confirmUnsavedClose(int token) {
        if (destroyed || !closeRequest.matches(token)) return;
        closeDialog = new AlertDialog.Builder(this)
            .setTitle("Çalışma henüz kaydedilmedi")
            .setMessage("Otomatik kayıt tamamlanamadı. Düzenleyiciye dönüp Kaydet düğmesiyle proje dosyanızı saklayabilirsiniz.")
            .setPositiveButton("Düzenlemeye dön", (dialog, which) -> closeRequest.complete(token))
            .setNegativeButton("Kaydetmeden çık", (dialog, which) -> { if (closeRequest.complete(token)) finish(); })
            .setOnCancelListener(dialog -> closeRequest.complete(token))
            .create();
        closeDialog.setOnDismissListener(dialog -> closeDialog = null);
        closeDialog.show();
        closeDialog.getButton(AlertDialog.BUTTON_POSITIVE).requestFocus();
    }
    @Override public void onBackPressed() {
        if (webView == null || destroyed) { finish(); return; }
        webView.evaluateJavascript("(function(){try{return typeof window.StudioHandleBack==='function'&&window.StudioHandleBack()===true;}catch(e){return false;}})();", handled -> {
            if (destroyed || "true".equals(handled)) return;
            int token = closeRequest.begin(); if (token == 0) return;
            webView.evaluateJavascript("window.dispatchEvent(new CustomEvent('studio-before-close',{detail:{requestId:" + token + "}}));", null);
            closeTimeout = () -> confirmUnsavedClose(token);
            handler.postDelayed(closeTimeout, 5000);
        });
    }
    @Override protected void onSaveInstanceState(Bundle state) { if (webView != null) webView.saveState(state); super.onSaveInstanceState(state); }
    @Override protected void onPause() {
        if (webView != null && trustedPage) webView.evaluateJavascript("window.dispatchEvent(new Event('studio-pause'));", null);
        // Keep WebView timers alive long enough for the asynchronous IndexedDB autosave to commit.
        super.onPause();
    }
    @Override protected void onResume() { super.onResume(); closeRequest.reset(); cancelCloseTimeout(); if (closeDialog != null) { closeDialog.dismiss(); closeDialog = null; } if (webView != null) webView.onResume(); if (root != null) root.requestApplyInsets(); }
    @Override protected void onDestroy() {
        destroyed = true; trustedPage = false; handler.removeCallbacksAndMessages(null);
        closeRequest.reset(); if (closeDialog != null) { closeDialog.dismiss(); closeDialog = null; }
        if (fileCallback != null) fileCallback.onReceiveValue(null); fileCallback = null; pending = null;
        worker.shutdown();
        if (webView != null) { webView.removeJavascriptInterface("KarevoAndroid"); webView.stopLoading(); root.removeView(webView); webView.destroy(); webView = null; }
        super.onDestroy();
    }
    private static final class Pending {
        final String id, action, mime, name; final int count;
        Pending(String id, String action, String mime, String name, int count) { this.id = id; this.action = action; this.mime = mime; this.name = name; this.count = count; }
    }
}
