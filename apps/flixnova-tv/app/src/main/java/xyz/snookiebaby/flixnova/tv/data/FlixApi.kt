package xyz.snookiebaby.flixnova.tv.data

import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.POST
import retrofit2.http.Path
import xyz.snookiebaby.flixnova.tv.BuildConfig
import xyz.snookiebaby.flixnova.tv.SessionStore
import java.util.concurrent.TimeUnit

interface FlixApiService {
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
    private val logging = HttpLoggingInterceptor().apply {
        level = HttpLoggingInterceptor.Level.BASIC
    }

    private val client = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(90, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .addInterceptor(logging)
        .build()

    val service: FlixApiService = Retrofit.Builder()
        .baseUrl(BuildConfig.API_BASE.trimEnd('/') + "/")
        .client(client)
        .addConverterFactory(GsonConverterFactory.create())
        .build()
        .create(FlixApiService::class.java)

    fun bearer(): String? = SessionStore.token?.let { "Bearer $it" }
    fun token(): String? = SessionStore.token

    fun proxyUrl(streamUrl: String): String {
        val t = SessionStore.token ?: return streamUrl
        val encoded = java.net.URLEncoder.encode(streamUrl, "UTF-8")
        val tok = java.net.URLEncoder.encode(t, "UTF-8")
        return "${BuildConfig.API_BASE.trimEnd('/')}/api/debrid/proxy?token=$tok&u=$encoded"
    }
}
