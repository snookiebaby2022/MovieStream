# FlixNova Admin (Android)

Capacitor WebView shell that loads `https://snookiebaby.xyz/admin/`.

## Build

```bash
cd apps/flixnova-admin
npm install
npx cap sync android
cd android
.\gradlew.bat assembleDebug
```

Debug APK:

`android/app/build/outputs/apk/debug/app-debug.apk`

Copy to `website/downloads/FlixNova-Admin-android.apk` for admin panel download.
