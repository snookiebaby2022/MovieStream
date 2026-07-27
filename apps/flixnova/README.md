# FlixNova — Android / Fire Stick / iOS

One codebase wraps the **live website** (`https://snookiebaby.xyz`), so catalog, login, payments, and players update when you deploy the site — no app store resubmit for content changes.

| What updates remotely? | How |
|------------------------|-----|
| Site UI, catalog, players, embeds | Automatic — WebView loads the live site |
| New APK (TV shell, allowlist, UA) | In-app **Update APK** banner, or reinstall from Get App |

Current native build: **versionCode 2 / 1.1.0** (Fire Stick / Android TV optimized).

| Platform | How users get it |
|----------|------------------|
| **Android phone/tablet** | Build APK → sideload or GitHub Releases |
| **Fire Stick / Fire TV** | Same APK + leanback launcher → install via **Downloader** |
| **iPhone / iPad** | Safari → **Share → Add to Home Screen** (PWA). See `/get-app.html` |

Apple does **not** allow easy sideloading of streaming wrappers. The Home Screen web app is the supported integration. A full App Store iOS binary needs a **Mac + Xcode + Apple Developer account** (`npx cap add ios` on a Mac).

## Requirements (build machine)

- Node.js 18+
- [Android Studio](https://developer.android.com/studio) (SDK + platform tools)
- JDK 17+

## Build the APK

```bash
cd apps/flixnova
npm install
npx cap sync android
npx cap open android
```

In Android Studio: **Build → Build Bundle(s) / APK(s) → Build APK(s)**.

Or from CLI (after Android SDK is installed):

```bash
npm run build:debug
# APK: android/app/build/outputs/apk/debug/app-debug.apk
```

### Fire Stick install

1. Fire Stick → Settings → My Fire TV → Developer Options → **Apps from Unknown Sources** ON  
2. Install **Downloader** from the Amazon store  
3. Enter the APK URL (or transfer via USB/ADB) → Install → Open **FlixNova**

ADB option:

```bash
adb connect <firestick-ip>
adb install -r app-debug.apk
```

## Config

Edit `capacitor.config.json` if your site URL changes:

```json
"server": {
  "url": "https://snookiebaby.xyz:8443"
}
```

Then `npx cap sync android`.

**HTTPS note:** The WebView must trust your certificate. Use a valid public cert (Let’s Encrypt) on `:8443`. Self-signed certs will show a blank/error screen on devices.

## iOS (optional, Mac only)

```bash
npm install @capacitor/ios
npx cap add ios
npx cap sync ios
npx cap open ios
```

Until then, ship **Add to Home Screen** via https://snookiebaby.xyz:8443/get-app.html#ios

## Project layout

```
apps/flixnova/
  capacitor.config.json   # live site URL + plugins
  www/                    # offline fallback shell
  android/                # Android + Fire TV project
website/get-app.html      # install instructions for users
website/icons/            # PWA / Apple touch icons
```
