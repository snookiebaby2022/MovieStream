package xyz.snookiebaby.flixnova.tv

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import xyz.snookiebaby.flixnova.tv.data.AppVersionChannel
import xyz.snookiebaby.flixnova.tv.data.FlixApi
import xyz.snookiebaby.flixnova.tv.data.StreamItem
import xyz.snookiebaby.flixnova.tv.ui.BrowseScreen
import xyz.snookiebaby.flixnova.tv.ui.DetailScreen
import xyz.snookiebaby.flixnova.tv.ui.FocusButton
import xyz.snookiebaby.flixnova.tv.ui.HomeScreen
import xyz.snookiebaby.flixnova.tv.ui.LoginScreen
import xyz.snookiebaby.flixnova.tv.ui.PlayerScreen
import xyz.snookiebaby.flixnova.tv.ui.SearchScreen

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        window.addFlags(WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED)
        setContent {
            val nav = rememberNavController()
            var playTitle by remember { mutableStateOf("") }
            var playStreams by remember { mutableStateOf<List<StreamItem>>(emptyList()) }
            var updateInfo by remember { mutableStateOf<AppVersionChannel?>(null) }
            var updateDismissed by remember { mutableStateOf(false) }

            LaunchedEffect(Unit) {
                val remote = withContext(Dispatchers.IO) {
                    try {
                        val res = FlixApi.service.appVersion()
                        if (res.success) res.tv else null
                    } catch (_: Exception) {
                        null
                    }
                } ?: return@LaunchedEffect
                if (remote.versionCode > BuildConfig.VERSION_CODE) {
                    updateInfo = remote
                }
            }

            val start = if (SessionStore.isLoggedIn()) "home" else "login"

            fun openItem(id: Long, type: String) {
                nav.navigate("detail/$id/$type")
            }

            fun openUpdate() {
                val url = updateInfo?.apkUrl?.takeIf { it.isNotBlank() }
                    ?: "https://snookiebaby.xyz/downloads/FlixNova-tv.apk"
                try {
                    startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
                } catch (_: Exception) {
                }
            }

            Box(Modifier.fillMaxSize()) {
                NavHost(
                    navController = nav,
                    startDestination = start,
                    modifier = Modifier.fillMaxSize()
                ) {
                    composable("login") {
                        LoginScreen {
                            nav.navigate("home") {
                                popUpTo("login") { inclusive = true }
                            }
                        }
                    }
                    composable("home") {
                        HomeScreen(
                            onOpen = { item ->
                                val id = item.tmdbId.takeIf { it > 0 } ?: item.id
                                openItem(id, item.type.ifBlank { "movie" })
                            },
                            onSearch = { nav.navigate("search") },
                            onBrowseMovies = { nav.navigate("browse/movie") },
                            onBrowseTv = { nav.navigate("browse/tv") },
                            onLogout = {
                                SessionStore.clear()
                                FlixApi.clearHomeCache()
                                nav.navigate("login") {
                                    popUpTo(0) { inclusive = true }
                                }
                            }
                        )
                    }
                    composable(
                        route = "browse/{kind}",
                        arguments = listOf(navArgument("kind") { type = NavType.StringType })
                    ) { entry ->
                        val kind = entry.arguments?.getString("kind") ?: "movie"
                        BrowseScreen(
                            kind = kind,
                            onOpen = { item ->
                                val id = item.tmdbId.takeIf { it > 0 } ?: item.id
                                openItem(id, item.type.ifBlank { if (kind == "tv") "tv" else "movie" })
                            },
                            onBack = { nav.popBackStack() }
                        )
                    }
                    composable("search") {
                        SearchScreen(
                            onOpen = { item ->
                                val id = item.tmdbId.takeIf { it > 0 } ?: item.id
                                openItem(id, item.type.ifBlank { "movie" })
                            },
                            onBack = { nav.popBackStack() }
                        )
                    }
                    composable(
                        route = "detail/{id}/{type}",
                        arguments = listOf(
                            navArgument("id") { type = NavType.LongType },
                            navArgument("type") { type = NavType.StringType }
                        )
                    ) { entry ->
                        val id = entry.arguments?.getLong("id") ?: 0L
                        val type = entry.arguments?.getString("type") ?: "movie"
                        DetailScreen(
                            tmdbId = id,
                            type = type,
                            onBack = { nav.popBackStack() },
                            onPlay = { details, _, _, streams ->
                                playTitle = details.title
                                playStreams = streams.take(20)
                                nav.navigate("player")
                            }
                        )
                    }
                    composable("player") {
                        PlayerScreen(
                            title = playTitle,
                            streams = playStreams,
                            onBack = { nav.popBackStack() }
                        )
                    }
                }

                val info = updateInfo
                if (info != null && (!updateDismissed || info.forceUpdate)) {
                    Box(
                        Modifier
                            .fillMaxSize()
                            .background(Color(0xCC000000)),
                        contentAlignment = Alignment.Center
                    ) {
                        Column(
                            Modifier
                                .fillMaxWidth(0.55f)
                                .background(Color(0xFF1A1A1A), RoundedCornerShape(14.dp))
                                .padding(28.dp)
                        ) {
                            Text(
                                if (info.forceUpdate) "Update required" else "Update available",
                                color = Color.White,
                                fontSize = 28.sp,
                                fontWeight = FontWeight.Black
                            )
                            Spacer(Modifier.height(8.dp))
                            Text(
                                "v${BuildConfig.VERSION_NAME} → v${info.versionName.ifBlank { info.versionCode.toString() }}",
                                color = Color(0xFFF5C518),
                                fontSize = 16.sp,
                                fontWeight = FontWeight.Bold
                            )
                            Spacer(Modifier.height(10.dp))
                            Text(
                                info.notes.ifBlank { "A newer FlixNova TV build is ready. Download and install to continue." },
                                color = Color(0xFFB3B3B3),
                                fontSize = 15.sp
                            )
                            Spacer(Modifier.height(20.dp))
                            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                                FocusButton("Download update", primary = true, onClick = { openUpdate() })
                                if (!info.forceUpdate) {
                                    FocusButton("Later", onClick = { updateDismissed = true })
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
