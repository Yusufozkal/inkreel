package com.inkreel.studio;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;

import java.io.File;
import java.io.FileNotFoundException;
import java.io.IOException;
import java.util.List;
import java.util.Locale;

/** Shares completed image exports through temporary, read-only URI grants. */
public final class ExportProvider extends ContentProvider {
    public static final String AUTHORITY = "com.inkreel.studio.exports";

    @Override
    public boolean onCreate() {
        return true;
    }

    /** Returns a URI only for an existing supported image in the export cache. */
    public static Uri uriFor(Context context, File file) {
        if (context == null || file == null) {
            throw new IllegalArgumentException("An export context and file are required");
        }
        Uri uri = new Uri.Builder()
                .scheme("content")
                .authority(AUTHORITY)
                .appendPath("exports")
                .appendPath(file.getName())
                .build();
        File allowed = resolveFile(context, uri);
        try {
            if (!allowed.equals(file.getCanonicalFile()) || !allowed.isFile()) {
                throw new IllegalArgumentException("File is not an available image export");
            }
        } catch (IOException error) {
            throw new IllegalArgumentException("Cannot resolve export file", error);
        }
        return uri;
    }

    @Override
    public Cursor query(Uri uri, String[] projection, String selection,
                        String[] selectionArgs, String sortOrder) {
        File file = resolveFile(getContext(), uri);
        if (!file.isFile()) {
            throw new IllegalArgumentException("Export does not exist");
        }
        String[] columns = projection == null
                ? new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE}
                : projection.clone();
        Object[] values = new Object[columns.length];
        for (int i = 0; i < columns.length; i++) {
            if (OpenableColumns.DISPLAY_NAME.equals(columns[i])) {
                values[i] = file.getName();
            } else if (OpenableColumns.SIZE.equals(columns[i])) {
                values[i] = file.length();
            } else {
                // Some sharing apps request legacy metadata alongside OpenableColumns.
                // A null value preserves compatibility without exposing local paths.
                values[i] = null;
            }
        }
        MatrixCursor cursor = new MatrixCursor(columns, 1);
        cursor.addRow(values);
        return cursor;
    }

    @Override
    public String getType(Uri uri) {
        File file = resolveFile(getContext(), uri);
        return file.getName().toLowerCase(Locale.US).endsWith(".png")
                ? "image/png" : "image/jpeg";
    }

    @Override
    public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        if (!"r".equals(mode)) {
            throw new SecurityException("Image exports are read-only");
        }
        File file = resolveFile(getContext(), uri);
        if (!file.isFile()) {
            throw new FileNotFoundException("Export does not exist");
        }
        return ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY);
    }

    @Override
    public Uri insert(Uri uri, ContentValues values) {
        throw new SecurityException("Image exports are read-only");
    }

    @Override
    public int update(Uri uri, ContentValues values, String selection, String[] selectionArgs) {
        throw new SecurityException("Image exports are read-only");
    }

    @Override
    public int delete(Uri uri, String selection, String[] selectionArgs) {
        throw new SecurityException("Image exports are read-only");
    }

    private static File resolveFile(Context context, Uri uri) {
        if (context == null || uri == null || !"content".equals(uri.getScheme())
                || !AUTHORITY.equals(uri.getAuthority())
                || uri.getQuery() != null || uri.getFragment() != null) {
            throw new SecurityException("Invalid export URI");
        }
        List<String> segments = uri.getPathSegments();
        if (segments.size() != 2 || !"exports".equals(segments.get(0))) {
            throw new SecurityException("Invalid export path");
        }
        String name = segments.get(1);
        String lowerName = name.toLowerCase(Locale.US);
        if (!name.matches("[A-Za-z0-9._-]+") || ".".equals(name) || "..".equals(name)
                || !(lowerName.endsWith(".png") || lowerName.endsWith(".jpg")
                || lowerName.endsWith(".jpeg"))) {
            throw new SecurityException("Invalid export filename");
        }
        try {
            File exportDirectory = new File(context.getCacheDir(), "exports").getCanonicalFile();
            File file = new File(exportDirectory, name).getCanonicalFile();
            if (!exportDirectory.equals(file.getParentFile())) {
                throw new SecurityException("Export is outside the export cache");
            }
            return file;
        } catch (IOException error) {
            throw new SecurityException("Cannot resolve export path", error);
        }
    }
}
