package xyz.snookiebaby.flixnova.tv.data

data class ApiOk<T>(
    val success: Boolean = false,
    val data: T? = null,
    val error: String? = null,
    val token: String? = null,
    val username: String? = null,
    val entitled: Boolean? = null,
    val trialActive: Boolean? = null,
    val needsPay: Boolean? = null,
    val code: String? = null
)

data class MediaItem(
    val id: Long = 0,
    val tmdbId: Long = 0,
    val title: String = "",
    val type: String = "movie",
    val year: String = "",
    val poster: String? = null,
    val backdrop: String? = null,
    val overview: String = "",
    val rating: Double = 0.0,
    val adult: Boolean = false,
    val imdbId: String? = null
)

data class CatalogRow(
    val title: String = "",
    val items: List<MediaItem> = emptyList(),
    val ap: String? = null
)

data class SeasonInfo(
    val season_number: Int = 0,
    val name: String = "",
    val episode_count: Int = 0
)

data class MediaDetails(
    val id: Long = 0,
    val tmdbId: Long = 0,
    val title: String = "",
    val type: String = "movie",
    val year: String = "",
    val poster: String? = null,
    val backdrop: String? = null,
    val overview: String = "",
    val rating: Double = 0.0,
    val adult: Boolean = false,
    val imdbId: String? = null,
    val tagline: String = "",
    val seasons: List<SeasonInfo> = emptyList(),
    val numberOfSeasons: Int? = null
)

data class EpisodeItem(
    val episode: Int = 0,
    val season: Int = 0,
    val name: String = "",
    val overview: String = "",
    val stillPath: String? = null,
    val airDate: String? = null
)

data class SeasonPayload(
    val season: Int = 0,
    val name: String = "",
    val episodes: List<EpisodeItem> = emptyList()
)

data class StreamItem(
    val name: String? = null,
    val title: String? = null,
    val url: String? = null,
    val source: String? = null,
    val provider: String? = null,
    val quality: String? = null,
    val size: String? = null,
    val browserOk: Boolean? = null
) {
    fun label(): String {
        val q = quality?.takeIf { it.isNotBlank() }
        val base = provider ?: source ?: name ?: title ?: "Stream"
        return if (q != null) "$base · $q" else base
    }
}

data class StreamsPayload(
    val streams: List<StreamItem> = emptyList()
)

data class MeData(
    val username: String? = null,
    val entitled: Boolean? = null,
    val trialActive: Boolean? = null,
    val needsPay: Boolean? = null,
    val lifetimeUnlock: Boolean? = null,
    val subscriptionStatus: String? = null
)

data class LoginBody(
    val username: String,
    val password: String
)

data class StreamsBody(
    val imdbId: String = "",
    val type: String,
    val season: Int = 1,
    val episode: Int = 1,
    val tmdbId: Long,
    val title: String = "",
    val year: String = "",
    val adult: Boolean = false
)
