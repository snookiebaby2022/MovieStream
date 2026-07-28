package xyz.snookiebaby.flixnova.tv

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

object SessionStore {
    private const val PREFS = "flixnova_tv_secure"
    private const val LEGACY_PREFS = "flixnova_tv"
    private const val KEY_TOKEN = "token"
    private const val KEY_USER = "username"

    private lateinit var prefs: SharedPreferences

    fun init(ctx: Context) {
        val app = ctx.applicationContext
        prefs = try {
            val masterKey = MasterKey.Builder(app)
                .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                .build()
            EncryptedSharedPreferences.create(
                app,
                PREFS,
                masterKey,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
            )
        } catch (_: Exception) {
            app.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        }

        // One-time migrate from plaintext prefs used by earlier MVP builds
        val legacy = app.getSharedPreferences(LEGACY_PREFS, Context.MODE_PRIVATE)
        val legacyToken = legacy.getString(KEY_TOKEN, null)
        if (!legacyToken.isNullOrBlank() && prefs.getString(KEY_TOKEN, null).isNullOrBlank()) {
            prefs.edit()
                .putString(KEY_TOKEN, legacyToken)
                .putString(KEY_USER, legacy.getString(KEY_USER, null))
                .apply()
            legacy.edit().clear().apply()
        }
    }

    var token: String?
        get() = prefs.getString(KEY_TOKEN, null)
        set(v) {
            prefs.edit().putString(KEY_TOKEN, v).apply()
        }

    var username: String?
        get() = prefs.getString(KEY_USER, null)
        set(v) {
            prefs.edit().putString(KEY_USER, v).apply()
        }

    fun clear() {
        prefs.edit().clear().apply()
    }

    fun isLoggedIn(): Boolean = !token.isNullOrBlank()
}
