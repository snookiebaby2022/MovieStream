package xyz.snookiebaby.flixnova.tv.ui

import android.view.KeyEvent as AndroidKeyEvent
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import coil.request.ImageRequest
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import xyz.snookiebaby.flixnova.tv.SessionStore
import xyz.snookiebaby.flixnova.tv.data.CatalogRow
import xyz.snookiebaby.flixnova.tv.data.EpisodeItem
import xyz.snookiebaby.flixnova.tv.data.FlixApi
import xyz.snookiebaby.flixnova.tv.data.LoginBody
import xyz.snookiebaby.flixnova.tv.data.MediaDetails
import xyz.snookiebaby.flixnova.tv.data.MediaItem
import xyz.snookiebaby.flixnova.tv.data.StreamItem
import xyz.snookiebaby.flixnova.tv.data.StreamsBody

val Bg = Color(0xFF0A0A0A)
val CardBg = Color(0xFF141414)
val Red = Color(0xFFE50914)
val Gold = Color(0xFFF5C518)
val TextMuted = Color(0xFFB3B3B3)

/** TV-safe clickable: D-pad OK / Enter / Center activates onClick. */
fun Modifier.tvClickable(focused: Boolean, onFocusedChange: (Boolean) -> Unit, onClick: () -> Unit): Modifier =
    this
        .onFocusChanged { onFocusedChange(it.isFocused) }
        .onPreviewKeyEvent { ev ->
            if (ev.type != KeyEventType.KeyUp) return@onPreviewKeyEvent false
            val code = ev.nativeKeyEvent.keyCode
            val ok = code == AndroidKeyEvent.KEYCODE_DPAD_CENTER
                || code == AndroidKeyEvent.KEYCODE_ENTER
                || code == AndroidKeyEvent.KEYCODE_NUMPAD_ENTER
                || code == AndroidKeyEvent.KEYCODE_BUTTON_A
                || ev.key == Key.DirectionCenter
                || ev.key == Key.Enter
            if (ok) {
                onClick()
                true
            } else false
        }
        .focusable()
        .clickable(onClick = onClick)

@Composable
fun FocusButton(
    label: String,
    modifier: Modifier = Modifier,
    primary: Boolean = false,
    onClick: () -> Unit
) {
    var focused by remember { mutableStateOf(false) }
    Box(
        modifier = modifier
            .tvClickable(focused, { focused = it }, onClick)
            .clip(RoundedCornerShape(10.dp))
            .background(if (primary) Red else CardBg)
            .border(
                width = if (focused) 3.dp else 1.dp,
                color = if (focused) Gold else Color.White.copy(alpha = 0.12f),
                shape = RoundedCornerShape(10.dp)
            )
            .padding(horizontal = 20.dp, vertical = 14.dp),
        contentAlignment = Alignment.Center
    ) {
        Text(label, color = Color.White, fontWeight = FontWeight.Bold, fontSize = 16.sp)
    }
}

@Composable
fun PosterCard(item: MediaItem, onClick: () -> Unit) {
    var focused by remember { mutableStateOf(false) }
    val ctx = LocalContext.current
    val poster = remember(item.poster) { FlixApi.thumb(item.poster) }
    Column(
        modifier = Modifier
            .width(132.dp)
            .tvClickable(focused, { focused = it }, onClick)
            .border(
                width = if (focused) 3.dp else 0.dp,
                color = Gold,
                shape = RoundedCornerShape(8.dp)
            )
            .padding(3.dp)
    ) {
        AsyncImage(
            model = ImageRequest.Builder(ctx)
                .data(poster)
                .size(185, 278)
                .crossfade(false)
                .build(),
            contentDescription = item.title,
            contentScale = ContentScale.Crop,
            modifier = Modifier
                .fillMaxWidth()
                .height(190.dp)
                .clip(RoundedCornerShape(8.dp))
                .background(CardBg)
        )
        Spacer(Modifier.height(4.dp))
        Text(
            item.title,
            color = Color.White,
            fontSize = 12.sp,
            fontWeight = FontWeight.SemiBold,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
        )
    }
}

@Composable
fun TvTextField(
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String,
    password: Boolean = false,
    modifier: Modifier = Modifier,
    onDone: (() -> Unit)? = null
) {
    var focused by remember { mutableStateOf(false) }
    BasicTextField(
        value = value,
        onValueChange = onValueChange,
        singleLine = true,
        visualTransformation = if (password) PasswordVisualTransformation() else VisualTransformation.None,
        textStyle = TextStyle(color = Color.White, fontSize = 18.sp),
        cursorBrush = SolidColor(Gold),
        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
        keyboardActions = KeyboardActions(onDone = { onDone?.invoke() }),
        modifier = modifier
            .onFocusChanged { focused = it.isFocused }
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .background(CardBg)
            .border(
                width = if (focused) 3.dp else 1.dp,
                color = if (focused) Gold else Color.White.copy(alpha = 0.15f),
                shape = RoundedCornerShape(10.dp)
            )
            .padding(16.dp),
        decorationBox = { inner ->
            Box {
                if (value.isEmpty()) {
                    Text(placeholder, color = TextMuted, fontSize = 18.sp)
                }
                inner()
            }
        }
    )
}

@Composable
fun LoginScreen(onLoggedIn: () -> Unit) {
    var user by remember { mutableStateOf("") }
    var pass by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var loading by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val focus = remember { FocusRequester() }

    LaunchedEffect(Unit) { focus.requestFocus() }

    fun doLogin() {
        if (loading) return
        scope.launch {
            loading = true
            error = null
            try {
                val res = FlixApi.service.login(LoginBody(user.trim(), pass))
                if (res.success && !res.token.isNullOrBlank()) {
                    SessionStore.token = res.token
                    SessionStore.username = res.username ?: user.trim()
                    onLoggedIn()
                } else {
                    error = res.error ?: "Login failed"
                }
            } catch (e: Exception) {
                error = e.message ?: "Network error"
            } finally {
                loading = false
            }
        }
    }

    Box(
        Modifier
            .fillMaxSize()
            .background(Bg)
            .padding(48.dp),
        contentAlignment = Alignment.Center
    ) {
        Column(
            Modifier.width(420.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp)
        ) {
            Text("FlixNova TV", color = Color.White, fontSize = 36.sp, fontWeight = FontWeight.Black)
            Text("Sign in with your FlixNova account", color = TextMuted, fontSize = 16.sp)
            Spacer(Modifier.height(8.dp))
            TvTextField(
                value = user,
                onValueChange = { user = it },
                placeholder = "Username",
                modifier = Modifier.focusRequester(focus),
                onDone = { doLogin() }
            )
            TvTextField(
                value = pass,
                onValueChange = { pass = it },
                placeholder = "Password",
                password = true,
                onDone = { doLogin() }
            )
            if (error != null) Text(error!!, color = Red, fontSize = 14.sp)
            FocusButton(
                label = if (loading) "Signing in…" else "Sign In",
                primary = true,
                onClick = { doLogin() },
                modifier = Modifier.fillMaxWidth()
            )
            Text(
                "Same account as phone & website. Manage billing at snookiebaby.xyz",
                color = TextMuted,
                fontSize = 13.sp
            )
        }
    }
}

@Composable
fun HomeScreen(
    onOpen: (MediaItem) -> Unit,
    onSearch: () -> Unit,
    onBrowseMovies: () -> Unit,
    onBrowseTv: () -> Unit,
    onLogout: () -> Unit
) {
    var rows by remember { mutableStateOf<List<CatalogRow>>(emptyList()) }
    var error by remember { mutableStateOf<String?>(null) }
    var loading by remember { mutableStateOf(true) }
    var status by remember { mutableStateOf("") }
    val firstPoster = remember { FocusRequester() }

    LaunchedEffect(Unit) {
        loading = true
        error = null
        try {
            withContext(Dispatchers.IO) {
                coroutineScope {
                    val tok = FlixApi.token()
                    val auth = FlixApi.bearer()
                    // Fast first paint: trending day, then full home (cached)
                    val trendJob = async {
                        try {
                            FlixApi.service.trendingDay(auth, tok)
                        } catch (_: Exception) {
                            null
                        }
                    }
                    val meJob = async {
                        if (tok != null && auth != null) {
                            try {
                                FlixApi.service.me(auth, tok)
                            } catch (_: Exception) {
                                null
                            }
                        } else null
                    }
                    val me = meJob.await()
                    val d = me?.data
                    val statusText = when {
                        d?.lifetimeUnlock == true -> "Lifetime"
                        d?.trialActive == true -> "Trial"
                        d?.entitled == true -> "Premium"
                        d?.needsPay == true -> "Subscribe on phone · snookiebaby.xyz"
                        else -> "Signed in · manage plan on phone"
                    }
                    withContext(Dispatchers.Main) { status = statusText }

                    val trend = trendJob.await()
                    if (trend?.success == true && !trend.data.isNullOrEmpty()) {
                        val quick = listOf(
                            CatalogRow(
                                title = "Trending Today",
                                items = trend.data!!.take(14).map {
                                    it.copy(poster = FlixApi.thumb(it.poster), backdrop = null)
                                }
                            )
                        )
                        withContext(Dispatchers.Main) {
                            rows = quick
                            loading = false
                        }
                    }

                    val home = FlixApi.homeCached()
                    withContext(Dispatchers.Main) {
                        if (home.isNotEmpty()) {
                            rows = home
                            error = null
                        } else if (rows.isEmpty()) {
                            error = "Could not load catalog"
                        }
                        loading = false
                    }
                }
            }
        } catch (e: Exception) {
            if (rows.isEmpty()) error = e.message
            loading = false
        }
    }

    LaunchedEffect(loading, rows) {
        if (!loading && rows.isNotEmpty()) {
            try {
                firstPoster.requestFocus()
            } catch (_: Exception) {
            }
        }
    }

    Column(
        Modifier
            .fillMaxSize()
            .background(Bg)
            .padding(horizontal = 36.dp, vertical = 24.dp)
    ) {
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column {
                Text("FlixNova TV", color = Color.White, fontSize = 28.sp, fontWeight = FontWeight.Black)
                Text(
                    "${SessionStore.username ?: ""} · $status",
                    color = Gold,
                    fontSize = 14.sp
                )
            }
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                FocusButton("Movies", onClick = onBrowseMovies)
                FocusButton("TV Shows", onClick = onBrowseTv)
                FocusButton("Search", onClick = onSearch)
                FocusButton("Log out", onClick = onLogout)
            }
        }
        Spacer(Modifier.height(18.dp))
        when {
            loading && rows.isEmpty() -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = Red)
            }
            error != null && rows.isEmpty() -> Text(error!!, color = Red)
            else -> LazyColumn(
                verticalArrangement = Arrangement.spacedBy(14.dp),
                contentPadding = PaddingValues(bottom = 40.dp)
            ) {
                itemsIndexed(rows, key = { _, row -> row.title }) { rowIndex, row ->
                    Text(row.title, color = Color.White, fontSize = 18.sp, fontWeight = FontWeight.Bold)
                    Spacer(Modifier.height(6.dp))
                    LazyRow(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        itemsIndexed(row.items, key = { idx, item ->
                            "${item.type}:${item.tmdbId.takeIf { it > 0 } ?: item.id}:$idx"
                        }) { itemIndex, item ->
                            val mod = if (rowIndex == 0 && itemIndex == 0) {
                                Modifier.focusRequester(firstPoster)
                            } else Modifier
                            Box(mod) {
                                PosterCard(item) { onOpen(item) }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun BrowseScreen(
    kind: String,
    onOpen: (MediaItem) -> Unit,
    onBack: () -> Unit
) {
    var items by remember { mutableStateOf<List<MediaItem>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }
    val title = if (kind == "tv") "TV Shows" else "Movies"
    val path = if (kind == "tv") "tv" else "movie"
    val first = remember { FocusRequester() }

    LaunchedEffect(kind) {
        loading = true
        try {
            val res = FlixApi.service.discover(path, FlixApi.bearer(), FlixApi.token())
            if (res.success) {
                items = (res.data ?: emptyList()).take(24).map {
                    val typed = if (it.type.isBlank()) it.copy(type = if (kind == "tv") "tv" else "movie") else it
                    typed.copy(poster = FlixApi.thumb(typed.poster), backdrop = null)
                }
            } else error = res.error ?: "Browse failed"
        } catch (e: Exception) {
            error = e.message
        } finally {
            loading = false
        }
    }

    LaunchedEffect(loading, items) {
        if (!loading && items.isNotEmpty()) {
            try {
                first.requestFocus()
            } catch (_: Exception) {
            }
        }
    }

    Column(
        Modifier
            .fillMaxSize()
            .background(Bg)
            .padding(36.dp)
    ) {
        Row(
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            FocusButton("Back", onClick = onBack)
            Text(title, color = Color.White, fontSize = 28.sp, fontWeight = FontWeight.Black)
        }
        Spacer(Modifier.height(18.dp))
        when {
            loading -> CircularProgressIndicator(color = Red)
            error != null -> Text(error!!, color = Red)
            else -> LazyRow(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                itemsIndexed(items) { index, item ->
                    Box(if (index == 0) Modifier.focusRequester(first) else Modifier) {
                        PosterCard(item) { onOpen(item) }
                    }
                }
            }
        }
    }
}

@Composable
fun SearchScreen(onOpen: (MediaItem) -> Unit, onBack: () -> Unit) {
    var q by remember { mutableStateOf("") }
    var results by remember { mutableStateOf<List<MediaItem>>(emptyList()) }
    var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { focus.requestFocus() }

    fun runSearch() {
        val query = q.trim()
        if (query.length < 2) return
        scope.launch {
            loading = true
            error = null
            try {
                val res = FlixApi.service.search(query, FlixApi.bearer(), FlixApi.token())
                if (res.success) {
                    results = (res.data ?: emptyList()).take(20).map {
                        it.copy(poster = FlixApi.thumb(it.poster), backdrop = null)
                    }
                } else error = res.error ?: "Search failed"
            } catch (e: Exception) {
                error = e.message
            } finally {
                loading = false
            }
        }
    }

    Column(
        Modifier
            .fillMaxSize()
            .background(Bg)
            .padding(36.dp)
    ) {
        Row(
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            FocusButton("Back", onClick = onBack)
            TvTextField(
                value = q,
                onValueChange = { q = it },
                placeholder = "Search movies & TV",
                modifier = Modifier.weight(1f).focusRequester(focus),
                onDone = { runSearch() }
            )
            FocusButton("Go", primary = true, onClick = { runSearch() })
        }
        Spacer(Modifier.height(20.dp))
        if (loading) CircularProgressIndicator(color = Red)
        if (error != null) Text(error!!, color = Red)
        LazyRow(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            items(results) { item -> PosterCard(item) { onOpen(item) } }
        }
    }
}

@Composable
fun DetailScreen(
    tmdbId: Long,
    type: String,
    onBack: () -> Unit,
    onPlay: (MediaDetails, Int, Int, List<StreamItem>) -> Unit
) {
    var details by remember { mutableStateOf<MediaDetails?>(null) }
    var episodes by remember { mutableStateOf<List<EpisodeItem>>(emptyList()) }
    var season by remember { mutableStateOf(1) }
    var loading by remember { mutableStateOf(true) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val playFocus = remember { FocusRequester() }

    LaunchedEffect(tmdbId, type) {
        loading = true
        try {
            val res = FlixApi.service.details(tmdbId, type, FlixApi.bearer(), FlixApi.token())
            if (res.success && res.data != null) {
                details = res.data
                val firstSeason = res.data!!.seasons.firstOrNull { it.season_number > 0 }?.season_number ?: 1
                season = firstSeason
                if (type == "tv") {
                    val s = FlixApi.service.season(tmdbId, firstSeason, FlixApi.bearer(), FlixApi.token())
                    episodes = s.data?.episodes ?: emptyList()
                }
            } else error = res.error ?: "Not found"
        } catch (e: Exception) {
            error = e.message
        } finally {
            loading = false
        }
    }

    LaunchedEffect(loading, details) {
        if (!loading && details != null) {
            try {
                playFocus.requestFocus()
            } catch (_: Exception) {
            }
        }
    }

    fun loadSeason(n: Int) {
        season = n
        scope.launch {
            try {
                val s = FlixApi.service.season(tmdbId, n, FlixApi.bearer(), FlixApi.token())
                episodes = s.data?.episodes ?: emptyList()
            } catch (_: Exception) {
            }
        }
    }

    fun play(ep: Int = 1) {
        val d = details ?: return
        val auth = FlixApi.bearer() ?: return
        val tok = FlixApi.token() ?: return
        scope.launch {
            busy = true
            error = null
            try {
                try {
                    FlixApi.service.startTrial(auth, tok)
                } catch (_: Exception) {
                }
                val body = StreamsBody(
                    imdbId = d.imdbId ?: "",
                    type = d.type,
                    season = season,
                    episode = ep,
                    tmdbId = d.tmdbId.takeIf { it > 0 } ?: d.id,
                    title = d.title,
                    year = d.year,
                    adult = d.adult
                )
                val res = FlixApi.service.streams(auth, tok, body)
                if (!res.success) {
                    error = when (res.code) {
                        "ADFREE_REQUIRED" -> "Subscribe £1/month on snookiebaby.xyz, then come back."
                        "NO_PLAYABLE_STREAMS" -> res.error
                            ?: "No playable streams yet. Check debrid account/email."
                        else -> res.error ?: "No streams"
                    }
                } else {
                    val raw = (res.data?.streams?.filter { !it.url.isNullOrBlank() } ?: emptyList())
                    val validated = raw.filter { it.validated == true }
                    val rest = raw.filter { it.validated != true }
                    // Prefer server-validated streams first; keep a few backups after
                    val list = (if (validated.isNotEmpty()) validated + rest else raw).take(40)
                    if (list.isEmpty()) error = "No playable streams found"
                    else onPlay(d, season, ep, list)
                }
            } catch (e: Exception) {
                error = e.message
            } finally {
                busy = false
            }
        }
    }

    Box(
        Modifier
            .fillMaxSize()
            .background(Bg)
    ) {
        val bg = FlixApi.thumb(details?.backdrop ?: details?.poster)
        if (bg != null) {
            AsyncImage(
                model = bg,
                contentDescription = null,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize(),
                alpha = 0.35f
            )
        }
        Column(Modifier.fillMaxSize().padding(36.dp)) {
            FocusButton("Back", onClick = onBack)
            Spacer(Modifier.height(16.dp))
            when {
                loading -> CircularProgressIndicator(color = Red)
                details == null -> Text(error ?: "Missing", color = Red)
                else -> {
                    val d = details!!
                    Text(d.title, color = Color.White, fontSize = 34.sp, fontWeight = FontWeight.Black)
                    Text(
                        listOfNotNull(
                            d.year.takeIf { it.isNotBlank() },
                            d.type.uppercase(),
                            if (d.rating > 0) "★ ${d.rating}" else null
                        ).joinToString(" · "),
                        color = Gold,
                        fontSize = 15.sp
                    )
                    Spacer(Modifier.height(10.dp))
                    Text(
                        d.overview,
                        color = TextMuted,
                        fontSize = 15.sp,
                        maxLines = 4,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.fillMaxWidth(0.7f)
                    )
                    Spacer(Modifier.height(16.dp))
                    if (error != null) Text(error!!, color = Red, fontSize = 14.sp)
                    if (d.type != "tv") {
                        FocusButton(
                            label = if (busy) "Finding best stream…" else "Play",
                            primary = true,
                            onClick = { play(1) },
                            modifier = Modifier.focusRequester(playFocus)
                        )
                    } else {
                        Text("Seasons", color = Color.White, fontWeight = FontWeight.Bold)
                        Spacer(Modifier.height(8.dp))
                        LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            itemsIndexed(d.seasons.filter { it.season_number > 0 }) { idx, s ->
                                FocusButton(
                                    label = "S${s.season_number}",
                                    primary = s.season_number == season,
                                    onClick = { loadSeason(s.season_number) },
                                    modifier = if (idx == 0) Modifier.focusRequester(playFocus) else Modifier
                                )
                            }
                        }
                        Spacer(Modifier.height(14.dp))
                        Text("Episodes", color = Color.White, fontWeight = FontWeight.Bold)
                        Spacer(Modifier.height(8.dp))
                        LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            itemsIndexed(episodes) { _, ep ->
                                FocusButton(
                                    label = "E${ep.episode} · ${ep.name}",
                                    onClick = { play(ep.episode) },
                                    modifier = Modifier.fillMaxWidth(0.75f)
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}
