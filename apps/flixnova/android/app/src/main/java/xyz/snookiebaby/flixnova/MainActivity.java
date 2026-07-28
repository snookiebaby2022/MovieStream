package xyz.snookiebaby.flixnova;

import android.content.pm.PackageManager;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.webkit.WebSettings;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  private static final int VERSION_CODE = 3;
  private static final String VERSION_NAME = "1.2.0";

  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    try {
      boolean isTv = getPackageManager().hasSystemFeature(PackageManager.FEATURE_LEANBACK)
          || getPackageManager().hasSystemFeature("amazon.hardware.fire_tv");

      getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
      getWindow().addFlags(WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED);

      if (getBridge() == null || getBridge().getWebView() == null) return;
      WebView webView = getBridge().getWebView();
      WebSettings settings = webView.getSettings();

      String ua = settings.getUserAgentString();
      if (ua == null || ua.isEmpty()) {
        ua = "Mozilla/5.0 (Linux; Android 12; SHIELD Android TV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
      } else {
        ua = ua.replace("; wv", "").replace(" Version/4.0", "");
      }
      if (!ua.contains("FlixNovaApp")) ua = ua + " FlixNovaApp/" + VERSION_NAME;
      if (isTv && !ua.contains("FlixNovaTV")) ua = ua + " FlixNovaTV/1";
      settings.setUserAgentString(ua);

      settings.setMediaPlaybackRequiresUserGesture(false);
      settings.setDomStorageEnabled(true);
      // Block embed ad scripts from opening new windows
      settings.setJavaScriptCanOpenWindowsAutomatically(false);
      settings.setSupportMultipleWindows(false);
      settings.setLoadWithOverviewMode(true);
      settings.setUseWideViewPort(true);
      settings.setSupportZoom(false);
      settings.setBuiltInZoomControls(false);
      settings.setDisplayZoomControls(false);
      try { settings.setOffscreenPreRaster(true); } catch (Exception ignored) {}

      if (isTv) {
        webView.setFocusable(true);
        webView.setFocusableInTouchMode(true);
        webView.setDescendantFocusability(android.view.ViewGroup.FOCUS_AFTER_DESCENDANTS);
        webView.requestFocus(View.FOCUS_DOWN);
        // Re-assert focus after layout — Fire Stick often loses first focus
        webView.postDelayed(() -> {
          try { webView.requestFocus(View.FOCUS_DOWN); } catch (Exception ignored) {}
        }, 1200);
      }

      final boolean tvFlag = isTv;
      webView.postDelayed(() -> {
        try {
          String js = "window.FlixNovaNative=Object.assign(window.FlixNovaNative||{},{"
              + "platform:'android',"
              + "versionCode:" + VERSION_CODE + ","
              + "versionName:'" + VERSION_NAME + "',"
              + "tv:" + (tvFlag ? "true" : "false")
              + "});"
              + "document.documentElement.classList.add('app-shell');"
              + "document.body&&document.body.classList.add('app-shell'"
              + (tvFlag ? ",'tv-mode'" : "")
              + ");"
              + "window.dispatchEvent(new Event('flixnova-native-ready'));";
          webView.evaluateJavascript(js, null);
        } catch (Exception ignored) {}
      }, 800);
    } catch (Exception ignored) {}
  }

  @Override
  public void onBackPressed() {
    try {
      WebView webView = getBridge() != null ? getBridge().getWebView() : null;
      if (webView != null) {
        // Ask the site to close the player modal first
        webView.evaluateJavascript(
            "(function(){try{if(window.__fnHardwareBack){window.__fnHardwareBack();return 'handled';}"
                + "if(document.getElementById('ov')&&document.getElementById('ov').classList.contains('on')"
                + "&&typeof closeModal==='function'){closeModal();return 'handled';}return 'pass';}catch(e){return 'pass';}})()",
            value -> {
              if (value != null && value.contains("handled")) return;
              // Not in player — default Capacitor/WebView back
              runOnUiThread(() -> {
                try { MainActivity.super.onBackPressed(); } catch (Exception ignored) {}
              });
            });
        return;
      }
    } catch (Exception ignored) {}
    super.onBackPressed();
  }

  @Override
  public boolean dispatchKeyEvent(KeyEvent event) {
    if (event.getAction() == KeyEvent.ACTION_UP
        && (event.getKeyCode() == KeyEvent.KEYCODE_BACK
            || event.getKeyCode() == KeyEvent.KEYCODE_ESCAPE)) {
      // Also route Back key through JS close when possible
      try {
        WebView webView = getBridge() != null ? getBridge().getWebView() : null;
        if (webView != null) {
          webView.evaluateJavascript(
              "(function(){try{if(document.getElementById('ov')&&document.getElementById('ov').classList.contains('on')"
                  + "&&typeof closeModal==='function'){closeModal();return true;}return false;}catch(e){return false;}})()",
              value -> {});
        }
      } catch (Exception ignored) {}
    }
    return super.dispatchKeyEvent(event);
  }
}
