package xyz.snookiebaby.flixnova.tv.data

import okhttp3.Cache
import okhttp3.OkHttpClient
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.POST
import retrofit2.http.Path
import xyz.snookiebaby.flixnova.tv.BuildConfig
import xyz.snookiebaby.flixnova.tv.SessionStore
import java.io.File
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

interface FlixApiService {
    @GET("/api/app/version")
    suspend fun appVersion(): AppVersionResponse

    @POST("/api/auth/login")
    suspend fun login(@Body body: LoginBody): ApiOk<Any?>

    @GET("/api/auth/me")
    suspend fun me(
        @Header("Authorization") auth: String,
        @Header("x-user-token") token: String
    ): ApiOk<MeData>

    @GET("/api/catalog/home")
    suspend fun homeCatalog(
        @Header("Authorization") auth: String? = null,
        @Header("x-user-token") token: String? = null
    ): ApiOk<List<CatalogRow>>

    @GET("/api/trending/day")
    suspend fun trendingDay(
        @Header("Authorization") auth: String? = null,
        @Header("x-user-token") token: String? = null
    ): ApiOk<List<MediaItem>>

    @GET("/api/discover/{kind}")
    suspend fun discover(
        @Path("kind") kind: String,
        @Header("Authorization") auth: String? = null,
        @Header("x-user-token") token: String? = null
    ): ApiOk<List<MediaItem>>

    @GET("/api/search/{query}")
    suspend fun search(
        @Path("query") query: String,
        @Header("Authorization") auth: String? = null,
        @Header("x-user-token") token: String? = null
    ): ApiOk<List<MediaItem>>

    @GET("/api/details/{tmdbId}/{type}")
    suspend fun details(
        @Path("tmdbId") tmdbId: Long,
        @Path("type") type: String,
        @Header("Authorization") auth: String? = null,
        @Header("x-user-token") token: String? = null
    ): ApiOk<MediaDetails>

    @GET("/api/season/{tmdbId}/{season}")
    suspend fun season(
        @Path("tmdbId") tmdbId: Long,
        @Path("season") season: Int,
        @Header("Authorization") auth: String? = null,
        @Header("x-user-token") token: String? = null
    ): ApiOk<SeasonPayload>

    @POST("/api/debrid/streams")
    suspend fun streams(
        @Header("Authorization") auth: String,
        @Header("x-user-token") token: String,
        @Body body: StreamsBody
    ): ApiOk<StreamsPayload>

    @POST("/api/pay/start-trial")
    suspend fun startTrial(
        @Header("Authorization") auth: String,
        @Header("x-user-token") token: String
    ): ApiOk<Any?>
}

object FlixApi {
    @Volatile
    private var cacheDir: File? = null

    private val homeCache = AtomicReference<Pair<Long, List<CatalogRow>>?>(null)
    private const val HOME_CACHE_MS = 5 * 60 * 1000L

    fun initCache(dir: File) {
        cacheDir = dir
    }

    private val client: OkHttpClient by lazy {
        val builder = OkHttpClient.Builder()
            .connectTimeout(12, TimeUnit.SECONDS)
            .readTimeout(45, TimeUnit.SECONDS)
            .writeTimeout(20, TimeUnit.SECONDS)
            .callTimeout(60, TimeUnit.SECONDS)
            .retryOnConnectionFailure(true)
        cacheDir?.let { dir ->
            builder.cache(Cache(File(dir, "http_cache"), 40L * 1024 * 1024))
        }
        builder.build()
    }

    val service: FlixApiService by lazy {
        Retrofit.Builder()
            .baseUrl(BuildConfig.API_BASE.trimEnd('/') + "/")
            .client(client)
            .addConverterFactory(GsonConverterFactory.create())
            .build()
            .create(FlixApiService::class.java)
    }

    fun bearer(): String? = SessionStore.token?.let { "Bearer $it" }
    fun token(): String? = SessionStore.token

    fun proxyUrl(streamUrl: String): String {
        val t = SessionStore.token ?: return streamUrl
        val encoded = java.net.URLEncoder.encode(streamUrl, "UTF-8")
        val tok = java.net.URLEncoder.encode(t, "UTF-8")
        return "${BuildConfig.API_BASE.trimEnd('/')}/api/debrid/proxy?token=$tok&u=$encoded"
    }

    /** Shrink TMDB poster URLs for Fire Stick memory/bandwidth. */
    fun thumb(url: String?): String? {
        if (url.isNullOrBlank()) return null
        return url
            .replace("/w1280", "/w780")
            .replace("/w780", "/w342")
            .replace("/w500", "/w185")
            .replace("/original", "/w342")
    }

    fun trimHome(rows: List<CatalogRow>, maxRows: Int = 8, maxItems: Int = 14): List<CatalogRow> =
        rows.take(maxRows).map { row ->
            row.copy(items = row.items.take(maxItems).map { it.copy(poster = thumb(it.poster), backdrop = null) })
        }

    suspend fun homeCached(): List<CatalogRow> {
        val now = System.currentTimeMillis()
        homeCache.get()?.let { (ts, rows) ->
            if (now - ts < HOME_CACHE_MS) return rows
        }
        val res = service.homeCatalog(bearer(), token())
        val rows = if (res.success && res.data != null) trimHome(res.data!!) else emptyList()
        if (rows.isNotEmpty()) homeCache.set(now to rows)
        return rows
    }

    fun clearHomeCache() {
        homeCache.set(null)
    }
}
