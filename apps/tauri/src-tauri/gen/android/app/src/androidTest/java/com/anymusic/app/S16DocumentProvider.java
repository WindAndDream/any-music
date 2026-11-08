package com.anymusic.app;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import java.io.FileNotFoundException;

/** Test APK only. Java keeps this independent provider process free of target-app libraries. */
public final class S16DocumentProvider extends ContentProvider {
    @Override public boolean onCreate() { return true; }
    @Override public String getType(Uri uri) { return "application/octet-stream"; }
    @Override public Cursor query(Uri uri, String[] projection, String selection, String[] args, String order) {
        String[] columns = projection == null ? new String[] {OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE} : projection;
        MatrixCursor cursor = new MatrixCursor(columns);
        Object[] row = new Object[columns.length];
        for (int i = 0; i < columns.length; i++) {
            row[i] = OpenableColumns.DISPLAY_NAME.equals(columns[i]) ? uri.getLastPathSegment() + ".amplugin" : 3;
        }
        cursor.addRow(row);
        return cursor;
    }
    @Override public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        if (!"r".equals(mode) || "denied".equals(uri.getLastPathSegment())) throw new FileNotFoundException("Access expired");
        try {
            if ("stall-open".equals(uri.getLastPathSegment())) Thread.sleep(6000);
            ParcelFileDescriptor[] pipe = ParcelFileDescriptor.createPipe();
            new Thread(() -> {
                try (ParcelFileDescriptor.AutoCloseOutputStream output = new ParcelFileDescriptor.AutoCloseOutputStream(pipe[1])) {
                    switch (uri.getLastPathSegment()) {
                        case "small": case "stall-open": output.write(new byte[] {1, 2, 3}); break;
                        case "valid-package":
                            try (java.io.InputStream input = getContext().getAssets().open("fixture.amplugin")) {
                                byte[] buffer = new byte[8192];
                                int count;
                                while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
                            }
                            break;
                        case "oversize": for (int i = 0; i < 2049; i++) output.write(new byte[8192]); break;
                        case "stall": Thread.sleep(6000); output.write(1); break;
                        default: throw new IllegalArgumentException("Unknown fixture");
                    }
                } catch (Exception ignored) { /* Reader cancellation closes the pipe. */ }
            }, "s16-test-provider").start();
            return pipe[0];
        } catch (Exception error) { throw new FileNotFoundException("Fixture unavailable"); }
    }
    @Override public Uri insert(Uri uri, ContentValues values) { throw new UnsupportedOperationException(); }
    @Override public int delete(Uri uri, String selection, String[] args) { throw new UnsupportedOperationException(); }
    @Override public int update(Uri uri, ContentValues values, String selection, String[] args) { throw new UnsupportedOperationException(); }
}
