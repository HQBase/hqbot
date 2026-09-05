package com.hqbot.app;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Bundle;
import android.text.InputType;
import android.webkit.CookieManager;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

public class MainActivity extends Activity {
    private WebView web;
    private Uri origin;
    private SharedPreferences preferences;
    private ValueCallback<Uri[]> fileCallback;
    private DownloadExport downloads;
    private static final int FILE_PICKER = 10;
    private static final int DOWNLOAD_PICKER = 11;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        preferences = getSharedPreferences("workspace", MODE_PRIVATE);
        downloads = new DownloadExport(this, DOWNLOAD_PICKER);
        LinearLayout layout = new LinearLayout(this); layout.setOrientation(LinearLayout.VERTICAL);
        layout.setPadding(0, 0, 0, 0);
        layout.setOnApplyWindowInsetsListener((view, insets) -> {
            view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(), insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            return insets;
        });
        LinearLayout bar = new LinearLayout(this); bar.setPadding(20, 8, 16, 8); bar.setGravity(android.view.Gravity.CENTER_VERTICAL);
        TextView title = new TextView(this); title.setText("HQBot"); title.setTextSize(20);
        bar.addView(title, new LinearLayout.LayoutParams(0, -2, 1));
        Button connect = new Button(this); connect.setText("Workspace"); connect.setOnClickListener(v -> chooseWorkspace()); bar.addView(connect);
        layout.addView(bar);
        web = new WebView(this); layout.addView(web, new LinearLayout.LayoutParams(-1, 0, 1));
        setContentView(layout);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true); settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false); settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSafeBrowsingEnabled(true); settings.setSupportMultipleWindows(true);
        // No addJavascriptInterface: the remote workspace has no native command bridge.
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (sameOrigin(request.getUrl())) return false;
                if (request.hasGesture() && request.isForMainFrame()) external(request.getUrl());
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                Intent pick = new Intent(Intent.ACTION_OPEN_DOCUMENT); pick.addCategory(Intent.CATEGORY_OPENABLE); pick.setType("*/*");
                pick.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE);
                startActivityForResult(pick, FILE_PICKER); return true;
            }
            @Override public boolean onCreateWindow(WebView view, boolean dialog, boolean userGesture, android.os.Message result) {
                if (!userGesture) return false;
                WebView popup = new WebView(MainActivity.this);
                popup.setWebViewClient(new WebViewClient() {
                    @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                        external(request.getUrl()); popup.destroy(); return true;
                    }
                });
                ((WebView.WebViewTransport)result.obj).setWebView(popup); result.sendToTarget(); return true;
            }
        });
        web.setDownloadListener((url, agent, disposition, type, length) -> {
            Uri uri = Uri.parse(url);
            if (sameOrigin(uri)) downloads.choose(uri, disposition, type);
            else Toast.makeText(this, "Open HQBot in your browser to save this generated file.", Toast.LENGTH_LONG).show();
        });
        String saved = preferences.getString("origin", "");
        if (!saved.isEmpty()) { origin = validate(saved); if (origin != null) web.loadUrl(origin.toString()); }
        if (origin == null) chooseWorkspace();
    }
    private Uri validate(String value) {
        Uri uri = Uri.parse(value.trim());
        String path = uri.getPath();
        return "https".equals(uri.getScheme()) && uri.getHost() != null && uri.getUserInfo() == null &&
            (path == null || path.isEmpty() || path.equals("/")) && uri.getQuery() == null && uri.getFragment() == null ? uri : null;
    }
    private boolean sameOrigin(Uri uri) {
        return origin != null && "https".equals(uri.getScheme()) && origin.getHost().equalsIgnoreCase(uri.getHost() == null ? "" : uri.getHost()) && port(uri) == port(origin);
    }
    private int port(Uri uri) { return uri.getPort() == -1 ? 443 : uri.getPort(); }
    private void external(Uri uri) {
        if (!"https".equals(uri.getScheme())) return;
        try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); }
        catch (android.content.ActivityNotFoundException error) { Toast.makeText(this, "No browser is available.", Toast.LENGTH_LONG).show(); }
    }
    private void chooseWorkspace() {
        EditText input = new EditText(this); input.setSingleLine(); input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        input.setHint("https://your-workspace.workers.dev"); input.setText(origin == null ? "" : origin.toString());
        AlertDialog dialog = new AlertDialog.Builder(this).setTitle("Connect your workspace")
            .setMessage("Sign in on your own HQBot page.").setView(input).setNegativeButton("Cancel", null).setPositiveButton("Connect", null).create();
        dialog.setOnShowListener(ignored -> dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v -> {
            Uri candidate = validate(input.getText().toString());
            if (candidate == null) { input.setError("Enter an HTTPS address with no path."); return; }
            origin = candidate; preferences.edit().putString("origin", origin.toString()).apply();
            web.stopLoading(); web.clearHistory(); web.loadUrl(origin.toString()); dialog.dismiss();
        })); dialog.show();
    }
    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request == FILE_PICKER && fileCallback != null) {
            Uri[] values = null;
            if (result == RESULT_OK && data != null) {
                if (data.getClipData() != null) { values = new Uri[data.getClipData().getItemCount()]; for (int i=0; i<values.length; i++) values[i] = data.getClipData().getItemAt(i).getUri(); }
                else if (data.getData() != null) values = new Uri[]{ data.getData() };
            }
            fileCallback.onReceiveValue(values); fileCallback = null;
        }
        if (request == DOWNLOAD_PICKER) downloads.save(result == RESULT_OK && data != null ? data.getData() : null);
    }
    @Override public void onBackPressed() { if (web.canGoBack()) web.goBack(); else super.onBackPressed(); }
    @Override protected void onDestroy() { if (fileCallback != null) fileCallback.onReceiveValue(null); downloads.close(); web.destroy(); super.onDestroy(); }
}
