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
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
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
    var showRail by remember { mutableStateOf(true) }

    val player = remember {
        ExoPlayer.Builder(context).build().apply {
            playWhenReady = true
        }
    }

    fun playAt(i: Int) {
        if (i !in streams.indices) {
            status = "No more sources"
            return
        }
        index = i
        val raw = streams[i].url ?: return
        val url = FlixApi.proxyUrl(raw)
        status = "Playing ${streams[i].label()}"
        player.setMediaItem(MediaItem.fromUri(url))
        player.prepare()
        player.play()
    }

    fun seekBy(deltaMs: Long) {
        val dur = player.duration.takeIf { it > 0 } ?: return
        val next = (player.currentPosition + deltaMs).coerceIn(0L, dur)
        player.seekTo(next)
        status = "Seek ${if (deltaMs > 0) "+" else ""}${deltaMs / 1000}s"
    }

    LaunchedEffect(streams) {
        playAt(0)
    }

    DisposableEffect(player) {
        val listener = object : Player.Listener {
            override fun onPlayerError(error: PlaybackException) {
                status = "Error — trying next…"
                playAt(index + 1)
            }

            override fun onIsPlayingChanged(isPlaying: Boolean) {
                if (isPlaying) {
                    status = streams.getOrNull(index)?.label() ?: "Playing"
                    showRail = false
                }
            }
        }
        player.addListener(listener)
        onDispose {
            player.removeListener(listener)
            player.release()
        }
    }

    BackHandler { onBack() }

    Box(
        Modifier
            .fillMaxSize()
            .background(Color.Black)
            .onPreviewKeyEvent { ev ->
                if (ev.nativeKeyEvent.action != KeyEvent.ACTION_DOWN) return@onPreviewKeyEvent false
                when (ev.nativeKeyEvent.keyCode) {
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
                    KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE, KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER -> {
                        if (!showRail) {
                            if (player.isPlaying) player.pause() else player.play()
                            true
                        } else false
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
    ) {
        AndroidView(
            factory = { ctx ->
                PlayerView(ctx).apply {
                    useController = true
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

        Column(
            Modifier
                .align(Alignment.TopStart)
                .padding(24.dp)
        ) {
            FocusButton("Close", onClick = onBack)
            Text(title, color = Color.White, fontSize = 20.sp, fontWeight = FontWeight.Bold)
            Text(status, color = Gold, fontSize = 14.sp)
            Text("←→ seek 10s · OK play/pause · Sources for next link", color = TextMuted, fontSize = 12.sp)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FocusButton("−10s", onClick = { seekBy(-10_000) })
                FocusButton("+10s", onClick = { seekBy(10_000) })
                FocusButton("Next source", onClick = { playAt(index + 1) })
                FocusButton(
                    label = if (showRail) "Hide sources" else "Sources",
                    onClick = { showRail = !showRail }
                )
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
