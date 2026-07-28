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
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView
import kotlinx.coroutines.delay
import xyz.snookiebaby.flixnova.tv.data.FlixApi
import xyz.snookiebaby.flixnova.tv.data.StreamItem

@Composable
fun PlayerScreen(
    title: String,
    streams: List<StreamItem>,
    onBack: () -> Unit
) {
    val context = LocalContext.current
    var index by remember { mutableIntStateOf(0) }
    var status by remember { mutableStateOf("Loading…") }
    // Chrome (buttons/title) + source rail — auto-hide while playing
    var showChrome by remember { mutableStateOf(true) }
    var showRail by remember { mutableStateOf(false) }
    var hideTick by remember { mutableLongStateOf(0L) }
    val closeFocus = remember { FocusRequester() }

    val player = remember {
        ExoPlayer.Builder(context).build().apply {
            playWhenReady = true
        }
    }

    fun bumpChrome(showSources: Boolean = false) {
        showChrome = true
        if (showSources) showRail = true
        hideTick++
    }

    fun playAt(i: Int) {
        if (i !in streams.indices) {
            status = "No more sources"
            bumpChrome()
            return
        }
        index = i
        val raw = streams[i].url ?: return
        val url = FlixApi.proxyUrl(raw)
        status = streams[i].label()
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
        playAt(0)
    }

    // Auto-hide overlay ~3s after last interaction while playing
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
                playAt(index + 1)
            }

            override fun onIsPlayingChanged(isPlaying: Boolean) {
                if (isPlaying) {
                    status = streams.getOrNull(index)?.label() ?: "Playing"
                    hideTick++
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

    LaunchedEffect(showChrome) {
        if (showChrome) {
            try {
                closeFocus.requestFocus()
            } catch (_: Exception) {
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
                // Any remote press while chrome hidden → show it (except when seeking)
                if (!showChrome && !showRail) {
                    when (code) {
                        KeyEvent.KEYCODE_DPAD_LEFT, KeyEvent.KEYCODE_MEDIA_REWIND -> {
                            seekBy(-10_000)
                            true
                        }
                        KeyEvent.KEYCODE_DPAD_RIGHT, KeyEvent.KEYCODE_MEDIA_FAST_FORWARD -> {
                            seekBy(10_000)
                            true
                        }
                        KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE -> {
                            if (player.isPlaying) player.pause() else player.play()
                            bumpChrome()
                            true
                        }
                        KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER,
                        KeyEvent.KEYCODE_DPAD_UP, KeyEvent.KEYCODE_MENU,
                        KeyEvent.KEYCODE_INFO, KeyEvent.KEYCODE_BUTTON_A -> {
                            bumpChrome()
                            true
                        }
                        KeyEvent.KEYCODE_MEDIA_NEXT -> {
                            playAt(index + 1)
                            true
                        }
                        KeyEvent.KEYCODE_MEDIA_PREVIOUS -> {
                            playAt((index - 1).coerceAtLeast(0))
                            true
                        }
                        else -> false
                    }
                } else {
                    when (code) {
                        KeyEvent.KEYCODE_DPAD_LEFT, KeyEvent.KEYCODE_MEDIA_REWIND -> {
                            if (!showRail) {
                                seekBy(-10_000)
                                true
                            } else false
                        }
                        KeyEvent.KEYCODE_DPAD_RIGHT, KeyEvent.KEYCODE_MEDIA_FAST_FORWARD -> {
                            if (!showRail) {
                                seekBy(10_000)
                                true
                            } else false
                        }
                        KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE -> {
                            if (player.isPlaying) player.pause() else player.play()
                            bumpChrome()
                            true
                        }
                        KeyEvent.KEYCODE_MEDIA_NEXT -> {
                            playAt(index + 1)
                            true
                        }
                        KeyEvent.KEYCODE_MEDIA_PREVIOUS -> {
                            playAt((index - 1).coerceAtLeast(0))
                            true
                        }
                        else -> false
                    }
                }
            }
    ) {
        AndroidView(
            factory = { ctx ->
                PlayerView(ctx).apply {
                    // No built-in Exo controller — it sticks on Fire Stick
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
                Text("OK shows menu · ←→ seek · Back closes menu", color = TextMuted, fontSize = 12.sp)
                Row(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    modifier = Modifier.padding(top = 10.dp)
                ) {
                    FocusButton("−10s", onClick = { seekBy(-10_000) })
                    FocusButton("+10s", onClick = { seekBy(10_000) })
                    FocusButton("Next source", onClick = { playAt(index + 1) })
                    FocusButton(
                        label = if (showRail) "Hide sources" else "Sources",
                        onClick = {
                            showRail = !showRail
                            bumpChrome(showSources = showRail)
                        }
                    )
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
                        FocusButton(
                            label = "${if (i == index) "▶ " else ""}${s.label()}",
                            primary = i == index,
                            onClick = { playAt(i) },
                            modifier = Modifier.fillMaxWidth()
                        )
                    }
                }
            }
        }
    }
}
