package xyz.snookiebaby.flixnova;

import android.content.pm.PackageManager;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.webkit.WebSettings;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  private static final int VERSION_CODE = 2;
  private static final String VERSION_NAME = "1.1.0";

  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    try {
      boolean isTv = getPackageManager().hasSystemFeature(PackageManager.FEATURE_LEANBACK)
          || getPackageManager().hasSystemFeature("amazon.hardware.fire_tv");

      // Keep screen awake on TV while browsing / watching
      getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
      getWindow().addFlags(WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED);

      if (getBridge() == null || getBridge().getWebView() == null) return;
      WebView webView = getBridge().getWebView();
      WebSettings settings = webView.getSettings();

      String ua = settings.getUserAgentString();
      if (ua == null || ua.isEmpty()) {
        ua = "Mozilla/5.0 (Linux; Android 12; SHIELD Android TV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
      } else {
        // Embed hosts often 403 Android WebView UAs that contain "; wv"
        ua = ua.replace("; wv", "").replace(" Version/4.0", "");
      }
      // Markers used by the website for app / TV layout + update checks
      if (!ua.contains("FlixNovaApp")) ua = ua + " FlixNovaApp/" + VERSION_NAME;
      if (isTv && !ua.contains("FlixNovaTV")) ua = ua + " FlixNovaTV/1";
      settings.setUserAgentString(ua);

      settings.setMediaPlaybackRequiresUserGesture(false);
      settings.setDomStorageEnabled(true);
      settings.setJavaScriptCanOpenWindowsAutomatically(true);
      settings.setLoadWithOverviewMode(true);
      settings.setUseWideViewPort(true);
      settings.setSupportZoom(false);
      settings.setBuiltInZoomControls(false);
      settings.setDisplayZoomControls(false);
      try { settings.setOffscreenPreRaster(true); } catch (Exception ignored) {}

      // Prefer remote D-pad focus over touch mouse cursor on TV
      if (isTv) {
        webView.setFocusable(true);
        webView.setFocusableInTouchMode(true);
        webView.requestFocus(View.FOCUS_DOWN);
      }

      // Expose native metadata to the live site (remote-updatable UI reads this)
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
}
