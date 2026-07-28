package xyz.snookiebaby.flixnova.tv

import android.content.Context
import android.content.SharedPreferences

object SessionStore {
    private const val PREFS = "flixnova_tv"
    private const val KEY_TOKEN = "token"
    private const val KEY_USER = "username"

    private lateinit var prefs: SharedPreferences

    fun init(ctx: Context) {
        prefs = ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    }

    var token: String?
        get() = prefs.getString(KEY_TOKEN, null)
        set(v) = prefs.edit().putString(KEY_TOKEN, v).apply()

    var username: String?
        get() = prefs.getString(KEY_USER, null)
        set(v) = prefs.edit().putString(KEY_USER, v).apply()

    fun clear() {
        prefs.edit().clear().apply()
    }

    fun isLoggedIn(): Boolean = !token.isNullOrBlank()
}
