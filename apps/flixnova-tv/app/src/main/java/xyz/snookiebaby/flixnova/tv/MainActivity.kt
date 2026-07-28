package xyz.snookiebaby.flixnova.tv

import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import xyz.snookiebaby.flixnova.tv.data.StreamItem
import xyz.snookiebaby.flixnova.tv.ui.BrowseScreen
import xyz.snookiebaby.flixnova.tv.ui.DetailScreen
import xyz.snookiebaby.flixnova.tv.ui.HomeScreen
import xyz.snookiebaby.flixnova.tv.ui.LoginScreen
import xyz.snookiebaby.flixnova.tv.ui.PlayerScreen
import xyz.snookiebaby.flixnova.tv.ui.SearchScreen

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        enableEdgeToEdge()
        setContent {
            val nav = rememberNavController()
            var playTitle by remember { mutableStateOf("") }
            var playStreams by remember { mutableStateOf<List<StreamItem>>(emptyList()) }

            val start = if (SessionStore.isLoggedIn()) "home" else "login"

            fun openItem(id: Long, type: String) {
                nav.navigate("detail/$id/$type")
            }

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
                            playStreams = streams
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
        }
    }
}
