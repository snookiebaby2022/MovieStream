package xyz.snookiebaby.flixnova.tv.ui

import android.view.KeyEvent
import android.view.ViewGroup
import android.widget.FrameLayout
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView
import kotlinx.coroutines.delay
import xyz.snookiebaby.flixnova.tv.data.FlixApi
import xyz.snookiebaby.flixnova.tv.data.StreamItem

@Composable
fun PlayerScreen(
    title: String,
    streams: List<StreamItem>,
    onBack: () -> Unit,
    onRequestMore: (() -> Unit)? = null
) {
    val context = LocalContext.current
    var index by remember { mutableIntStateOf(0) }
    var status by remember { mutableStateOf("Loading…") }
    var showChrome by remember { mutableStateOf(true) }
    var showRail by remember { mutableStateOf(false) }
    var hideTick by remember { mutableLongStateOf(0L) }
    var failed by remember { mutableStateOf(setOf<String>()) }
    var stallEpoch by remember { mutableIntStateOf(0) }
    val closeFocus = remember { FocusRequester() }
    val nextFocus = remember { FocusRequester() }
    val railFocus = remember { FocusRequester() }

    val player = remember {
        val loadControl = DefaultLoadControl.Builder()
            .setBufferDurationsMs(2_500, 15_000, 1_000, 2_000)
            .build()
        ExoPlayer.Builder(context)
            .setLoadControl(loadControl)
            .build()
            .apply { playWhenReady = true }
    }

    fun urlKey(s: StreamItem?): String =
        (s?.url ?: "").substringBefore('?').lowercase()

    fun bumpChrome(showSources: Boolean = false) {
        showChrome = true
        if (showSources) showRail = true
        hideTick++
    }

    fun pickNext(from: Int, dir: Int = 1): Int {
        if (streams.isEmpty()) return -1
        val n = streams.size
        for (i in 1..n) {
            val idx = ((from + dir * i) % n + n) % n
            val key = urlKey(streams.getOrNull(idx))
            if (key.isBlank()) continue
            if (key !in failed) return idx
        }
        return -1
    }

    fun playAt(i: Int, markCurrentFailed: Boolean = false) {
        if (markCurrentFailed) {
            val cur = urlKey(streams.getOrNull(index))
            if (cur.isNotBlank()) failed = failed + cur
        }
        var target = i
        if (target !in streams.indices || urlKey(streams.getOrNull(target)).isBlank() || urlKey(streams[target]) in failed) {
            target = pickNext(if (target in streams.indices) target else index, 1)
        }
        if (target < 0) {
            status = if (onRequestMore != null) "No more sources — search again" else "No more sources"
            bumpChrome(showSources = true)
            return
        }
        val raw = streams[target].url
        if (raw.isNullOrBlank()) {
            failed = failed + urlKey(streams[target])
            playAt(pickNext(target, 1))
            return
        }
        index = target
        val url = FlixApi.proxyUrl(raw)
        status = streams[target].label()
        stallEpoch++
        player.setMediaItem(MediaItem.fromUri(url))
        player.prepare()
        player.play()
        bumpChrome()
    }

    fun seekBy(deltaMs: Long) {
        val dur = player.duration.takeIf { it > 0 } ?: return
        val next = (player.currentPosition + deltaMs).coerceIn(0L, dur)
        player.seekTo(next)
        bumpChrome()
    }

    LaunchedEffect(streams) {
        failed = emptySet()
        playAt(0)
    }

    // Stall watchdog — advance if buffering with no progress
    LaunchedEffect(stallEpoch, index) {
        delay(10_000)
        if (!player.isPlaying &&
            (player.playbackState == Player.STATE_BUFFERING || player.playbackState == Player.STATE_IDLE)
        ) {
            status = "Stalled — trying next…"
            playAt(index, markCurrentFailed = true)
        }
    }

    LaunchedEffect(hideTick, showChrome, showRail) {
        if (!showChrome && !showRail) return@LaunchedEffect
        delay(3000)
        if (player.isPlaying) {
            showChrome = false
            showRail = false
        }
    }

    DisposableEffect(player) {
        val listener = object : Player.Listener {
            override fun onPlayerError(error: PlaybackException) {
                status = "Error — trying next…"
                bumpChrome()
                playAt(index, markCurrentFailed = true)
            }

            override fun onIsPlayingChanged(isPlaying: Boolean) {
                if (isPlaying) {
                    status = streams.getOrNull(index)?.label() ?: "Playing"
                    hideTick++
                    stallEpoch++
                } else {
                    bumpChrome()
                }
            }
        }
        player.addListener(listener)
        onDispose {
            player.removeListener(listener)
            player.release()
        }
    }

    BackHandler {
        when {
            showRail -> {
                showRail = false
                hideTick++
            }
            showChrome -> onBack()
            else -> bumpChrome()
        }
    }

    LaunchedEffect(showChrome, showRail) {
        if (showRail) {
            try {
                railFocus.requestFocus()
            } catch (_: Exception) {
            }
        } else if (showChrome) {
            try {
                nextFocus.requestFocus()
            } catch (_: Exception) {
                try {
                    closeFocus.requestFocus()
                } catch (_: Exception) {
                }
            }
        }
    }

    Box(
        Modifier
            .fillMaxSize()
            .background(Color.Black)
            .onPreviewKeyEvent { ev ->
                if (ev.nativeKeyEvent.action != KeyEvent.ACTION_DOWN) return@onPreviewKeyEvent false
                val code = ev.nativeKeyEvent.keyCode
                if (!showChrome && !showRail) {
                    when (code) {
                        KeyEvent.KEYCODE_DPAD_LEFT, KeyEvent.KEYCODE_MEDIA_REWIND -> {
                            seekBy(-10_000); true
                        }
                        KeyEvent.KEYCODE_DPAD_RIGHT, KeyEvent.KEYCODE_MEDIA_FAST_FORWARD -> {
                            seekBy(10_000); true
                        }
                        KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE -> {
                            if (player.isPlaying) player.pause() else player.play()
                            bumpChrome(); true
                        }
                        KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER,
                        KeyEvent.KEYCODE_DPAD_UP, KeyEvent.KEYCODE_MENU,
                        KeyEvent.KEYCODE_INFO, KeyEvent.KEYCODE_BUTTON_A -> {
                            bumpChrome(); true
                        }
                        KeyEvent.KEYCODE_MEDIA_NEXT -> {
                            playAt(pickNext(index, 1)); true
                        }
                        KeyEvent.KEYCODE_MEDIA_PREVIOUS -> {
                            playAt(pickNext(index, -1)); true
                        }
                        else -> false
                    }
                } else {
                    when (code) {
                        KeyEvent.KEYCODE_MEDIA_REWIND -> {
                            seekBy(-10_000); true
                        }
                        KeyEvent.KEYCODE_MEDIA_FAST_FORWARD -> {
                            seekBy(10_000); true
                        }
                        KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE -> {
                            if (player.isPlaying) player.pause() else player.play()
                            bumpChrome(); true
                        }
                        KeyEvent.KEYCODE_MEDIA_NEXT -> {
                            playAt(pickNext(index, 1)); true
                        }
                        KeyEvent.KEYCODE_MEDIA_PREVIOUS -> {
                            playAt(pickNext(index, -1)); true
                        }
                        else -> false
                    }
                }
            }
    ) {
        AndroidView(
            factory = { ctx ->
                PlayerView(ctx).apply {
                    useController = false
                    keepScreenOn = true
                    layoutParams = FrameLayout.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        ViewGroup.LayoutParams.MATCH_PARENT
                    )
                    this.player = player
                }
            },
            update = { it.player = player },
            modifier = Modifier.fillMaxSize()
        )

        if (showChrome) {
            Column(
                Modifier
                    .align(Alignment.TopStart)
                    .fillMaxWidth()
                    .background(Color(0xCC000000))
                    .padding(20.dp)
            ) {
                FocusButton(
                    "Close",
                    onClick = onBack,
                    modifier = Modifier.focusRequester(closeFocus)
                )
                Text(title, color = Color.White, fontSize = 20.sp, fontWeight = FontWeight.Bold)
                Text(status, color = Gold, fontSize = 14.sp)
                Text("OK menu · Next source wraps · seek when menu hidden", color = TextMuted, fontSize = 12.sp)
                Row(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    modifier = Modifier.padding(top = 10.dp)
                ) {
                    FocusButton(
                        "Next source",
                        primary = true,
                        onClick = { playAt(pickNext(index, 1)) },
                        modifier = Modifier.focusRequester(nextFocus)
                    )
                    FocusButton("Sources", onClick = {
                        showRail = true
                        bumpChrome(showSources = true)
                    })
                    if (onRequestMore != null) {
                        FocusButton("Search again", onClick = onRequestMore)
                    }
                    FocusButton("−10s", onClick = { seekBy(-10_000) })
                    FocusButton("+10s", onClick = { seekBy(10_000) })
                }
            }
        }

        if (showRail) {
            Column(
                Modifier
                    .align(Alignment.CenterEnd)
                    .fillMaxHeight()
                    .width(320.dp)
                    .background(Color(0xEE0A0A0A))
                    .padding(16.dp)
            ) {
                Text("Sources", color = Color.White, fontWeight = FontWeight.Bold, fontSize = 18.sp)
                LazyColumn(
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                    modifier = Modifier.padding(top = 12.dp)
                ) {
                    itemsIndexed(streams) { i, s ->
                        val dead = urlKey(s) in failed
                        FocusButton(
                            label = "${when {
                                i == index -> "▶ "
                                dead -> "✕ "
                                else -> ""
                            }}${s.label()}",
                            primary = i == index,
                            onClick = {
                                // Force retry even if previously failed
                                val key = urlKey(s)
                                if (key.isNotBlank()) failed = failed - key
                                playAt(i)
                            },
                            modifier = Modifier
                                .fillMaxWidth()
                                .then(if (i == 0) Modifier.focusRequester(railFocus) else Modifier)
                        )
                    }
                }
            }
        }
    }
}
