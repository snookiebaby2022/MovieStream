package xyz.snookiebaby.flixnova.tv

import android.app.Application

class FlixNovaTvApp : Application() {
    override fun onCreate() {
        super.onCreate()
        SessionStore.init(this)
    }
}
