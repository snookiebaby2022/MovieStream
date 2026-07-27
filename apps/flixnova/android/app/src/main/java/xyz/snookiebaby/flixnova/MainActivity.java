package xyz.snookiebaby.flixnova;

import android.os.Bundle;
import android.webkit.WebSettings;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    try {
      if (getBridge() == null || getBridge().getWebView() == null) return;
      WebSettings settings = getBridge().getWebView().getSettings();
      String ua = settings.getUserAgentString();
      if (ua == null || ua.isEmpty()) {
        ua = "Mozilla/5.0 (Linux; Android 12; SHIELD Android TV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
      } else {
        // Embed hosts often 403 Android WebView UAs that contain "; wv"
        ua = ua.replace("; wv", "").replace(" Version/4.0", "");
      }
      settings.setUserAgentString(ua);
      settings.setMediaPlaybackRequiresUserGesture(false);
      settings.setDomStorageEnabled(true);
      settings.setJavaScriptCanOpenWindowsAutomatically(true);
    } catch (Exception ignored) {}
  }
}
