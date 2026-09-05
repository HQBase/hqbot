package com.hqbot.app;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.webkit.CookieManager;
import android.webkit.URLUtil;
import android.widget.Toast;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

final class DownloadExport {
    private final Activity activity;
    private final int requestCode;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private Uri pending;
    private String cookie;
    DownloadExport(Activity activity, int requestCode) { this.activity = activity; this.requestCode = requestCode; }
    void choose(Uri uri, String disposition, String type) {
        pending = uri; cookie = CookieManager.getInstance().getCookie(uri.toString());
        Intent pick = new Intent(Intent.ACTION_CREATE_DOCUMENT); pick.addCategory(Intent.CATEGORY_OPENABLE);
        pick.setType(type == null ? "application/octet-stream" : type);
        pick.putExtra(Intent.EXTRA_TITLE, URLUtil.guessFileName(uri.toString(), disposition, type));
        activity.startActivityForResult(pick, requestCode);
    }
    void save(Uri target) {
        Uri source = pending; String auth = cookie; pending = null; cookie = null;
        if (source == null || target == null) return;
        worker.execute(() -> {
            HttpURLConnection connection = null;
            try {
                connection = (HttpURLConnection)new URL(source.toString()).openConnection();
                connection.setInstanceFollowRedirects(false); connection.setConnectTimeout(15000); connection.setReadTimeout(30000);
                if (auth != null) connection.setRequestProperty("Cookie", auth);
                if (connection.getResponseCode() != 200) throw new java.io.IOException("Download unavailable");
                try (InputStream input = connection.getInputStream(); OutputStream output = activity.getContentResolver().openOutputStream(target)) {
                    if (output == null) throw new java.io.IOException("Destination unavailable");
                    byte[] buffer = new byte[8192]; int count; long total = 0;
                    while ((count = input.read(buffer)) != -1) {
                        total += count; if (total > 50_000_000 || Thread.currentThread().isInterrupted()) throw new java.io.IOException("Download stopped");
                        output.write(buffer, 0, count);
                    }
                }
                show("File saved");
            } catch (Exception error) { show("The file could not be saved. Try again in HQBot."); }
            finally { if (connection != null) connection.disconnect(); }
        });
    }
    private void show(String value) { activity.runOnUiThread(() -> Toast.makeText(activity, value, Toast.LENGTH_LONG).show()); }
    void close() { worker.shutdownNow(); }
}
