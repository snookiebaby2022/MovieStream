package xyz.snookiebaby.flixnova.tv

import android.app.Application
import coil.ImageLoader
import coil.ImageLoaderFactory
import coil.disk.DiskCache
import coil.memory.MemoryCache
import coil.request.CachePolicy
import okhttp3.OkHttpClient
import xyz.snookiebaby.flixnova.tv.data.FlixApi
import java.util.concurrent.TimeUnit

class FlixNovaTvApp : Application(), ImageLoaderFactory {
    override fun onCreate() {
        super.onCreate()
        SessionStore.init(this)
        FlixApi.initCache(cacheDir)
    }

    /** Lean Coil config — Fire Stick has limited RAM/CPU. */
    override fun newImageLoader(): ImageLoader {
        val http = OkHttpClient.Builder()
            .connectTimeout(12, TimeUnit.SECONDS)
            .readTimeout(20, TimeUnit.SECONDS)
            .retryOnConnectionFailure(true)
            .build()
        return ImageLoader.Builder(this)
            .okHttpClient(http)
            .crossfade(false)
            .allowHardware(true)
            .memoryCache {
                MemoryCache.Builder(this)
                    .maxSizePercent(0.18)
                    .build()
            }
            .diskCache {
                DiskCache.Builder()
                    .directory(cacheDir.resolve("coil_tv"))
                    .maxSizeBytes(80L * 1024 * 1024)
                    .build()
            }
            .memoryCachePolicy(CachePolicy.ENABLED)
            .diskCachePolicy(CachePolicy.ENABLED)
            .networkCachePolicy(CachePolicy.ENABLED)
            .build()
    }
}
