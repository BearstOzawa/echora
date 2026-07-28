package studio.echora.client

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.MediaMetadata
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.SystemClock
import androidx.core.content.ContextCompat
import org.json.JSONObject
import java.net.URL
import java.util.concurrent.Executors

class EchoraMediaService : Service() {
  companion object {
    const val ACTION_UPDATE_METADATA = "studio.echora.client.media.UPDATE_METADATA"
    const val ACTION_UPDATE_STATE = "studio.echora.client.media.UPDATE_STATE"
    const val ACTION_CLEAR = "studio.echora.client.media.CLEAR"
    const val ACTION_PLAY = "studio.echora.client.media.PLAY"
    const val ACTION_PAUSE = "studio.echora.client.media.PAUSE"
    const val ACTION_PREVIOUS = "studio.echora.client.media.PREVIOUS"
    const val ACTION_NEXT = "studio.echora.client.media.NEXT"
    const val ACTION_TOGGLE_LIKE = "studio.echora.client.media.TOGGLE_LIKE"
    const val EXTRA_MEDIA_COMMAND = "echora_media_command"

    private const val CHANNEL_ID = "echora_playback"
    private const val NOTIFICATION_ID = 2107

    @Volatile
    var commandSink: ((String) -> Unit)? = null

    fun send(context: Context, intent: Intent, foreground: Boolean = false) {
      if (foreground && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        ContextCompat.startForegroundService(context, intent)
      } else {
        context.startService(intent)
      }
    }
  }

  private lateinit var mediaSession: MediaSession
  private lateinit var notificationManager: NotificationManager
  private val mainHandler = Handler(Looper.getMainLooper())
  private val artworkExecutor = Executors.newSingleThreadExecutor()

  private var title = "Echora"
  private var artist = ""
  private var album = ""
  private var coverUrl = ""
  private var artwork: Bitmap? = null
  private var durationMs = 0L
  private var positionMs = 0L
  private var playbackRate = 1f
  private var isPlaying = false
  private var isLiked = false
  private var hasTrack = false

  private val noisyAudioReceiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context?, intent: Intent?) {
      if (intent?.action == AudioManager.ACTION_AUDIO_BECOMING_NOISY && isPlaying) {
        dispatchCommand("route-disconnected")
      }
    }
  }

  override fun onCreate() {
    super.onCreate()
    notificationManager = getSystemService(NotificationManager::class.java)
    createNotificationChannel()
    // Chromium owns audio focus for the HTML audio element. A second native
    // request would make Echora compete with itself and interrupt playback.
    mediaSession = MediaSession(this, "EchoraPlayback").apply {
      setFlags(MediaSession.FLAG_HANDLES_MEDIA_BUTTONS or MediaSession.FLAG_HANDLES_TRANSPORT_CONTROLS)
      setPlaybackToLocal(
        AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_MEDIA)
          .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
          .build(),
      )
      setSessionActivity(activityPendingIntent())
      setCallback(object : MediaSession.Callback() {
        override fun onPlay() = dispatchCommand("play")
        override fun onPause() {
          dispatchCommand("pause")
        }
        override fun onSkipToPrevious() = dispatchCommand("previous")
        override fun onSkipToNext() = dispatchCommand("next")
        override fun onSeekTo(pos: Long) = dispatchCommand("seek-to", pos / 1000.0)
        override fun onCustomAction(action: String, extras: android.os.Bundle?) {
          if (action == ACTION_TOGGLE_LIKE) dispatchCommand("toggle-like")
        }
      })
    }
    val noisyFilter = IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      registerReceiver(noisyAudioReceiver, noisyFilter, RECEIVER_NOT_EXPORTED)
    } else {
      @Suppress("DEPRECATION") registerReceiver(noisyAudioReceiver, noisyFilter)
    }
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_UPDATE_METADATA -> updateMetadata(intent)
      ACTION_UPDATE_STATE -> updateState(intent)
      ACTION_CLEAR -> clearSession()
      ACTION_PLAY -> dispatchCommand("play")
      ACTION_PAUSE -> dispatchCommand("pause")
      ACTION_PREVIOUS -> dispatchCommand("previous")
      ACTION_NEXT -> dispatchCommand("next")
      ACTION_TOGGLE_LIKE -> dispatchCommand("toggle-like")
    }
    // The WebView owns the audio engine. If Android kills the process, a bare
    // service restart cannot continue audio and would only create stale UI.
    return START_NOT_STICKY
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onDestroy() {
    runCatching { unregisterReceiver(noisyAudioReceiver) }
    artworkExecutor.shutdownNow()
    mediaSession.release()
    super.onDestroy()
  }

  private fun updateMetadata(intent: Intent) {
    title = intent.getStringExtra("title")?.takeIf { it.isNotBlank() } ?: "Echora"
    artist = intent.getStringExtra("artist").orEmpty()
    album = intent.getStringExtra("album").orEmpty()
    durationMs = (intent.getDoubleExtra("duration", 0.0) * 1000).toLong().coerceAtLeast(0)
    hasTrack = true
    mediaSession.isActive = true
    publishMetadata()

    val nextCoverUrl = intent.getStringExtra("coverUrl").orEmpty()
    if (nextCoverUrl != coverUrl) {
      coverUrl = nextCoverUrl
      artwork = null
      if (nextCoverUrl.startsWith("http://") || nextCoverUrl.startsWith("https://")) {
        loadArtwork(nextCoverUrl)
      }
    }
    publishNotification()
  }

  private fun updateState(intent: Intent) {
    val previousPlaying = isPlaying
    val previousLiked = isLiked
    positionMs = (intent.getDoubleExtra("elapsed", 0.0) * 1000).toLong().coerceAtLeast(0)
    durationMs = (intent.getDoubleExtra("duration", durationMs / 1000.0) * 1000).toLong().coerceAtLeast(0)
    playbackRate = intent.getDoubleExtra("playbackRate", 1.0).toFloat().coerceAtLeast(.1f)
    isPlaying = intent.getBooleanExtra("isPlaying", false)
    isLiked = intent.getBooleanExtra("isLiked", false)
    publishPlaybackState()
    if (previousPlaying != isPlaying || previousLiked != isLiked) publishNotification()
  }

  private fun publishMetadata() {
    val metadata = MediaMetadata.Builder()
      .putString(MediaMetadata.METADATA_KEY_TITLE, title)
      .putString(MediaMetadata.METADATA_KEY_ARTIST, artist)
      .putString(MediaMetadata.METADATA_KEY_ALBUM, album)
      .putLong(MediaMetadata.METADATA_KEY_DURATION, durationMs)
    artwork?.let {
      metadata.putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, it)
      metadata.putBitmap(MediaMetadata.METADATA_KEY_ART, it)
    }
    mediaSession.setMetadata(metadata.build())
  }

  private fun publishPlaybackState() {
    if (!hasTrack) return
    val actions = PlaybackState.ACTION_PLAY or PlaybackState.ACTION_PAUSE or
      PlaybackState.ACTION_PLAY_PAUSE or PlaybackState.ACTION_SKIP_TO_PREVIOUS or
      PlaybackState.ACTION_SKIP_TO_NEXT or PlaybackState.ACTION_SEEK_TO or
      PlaybackState.ACTION_REWIND or PlaybackState.ACTION_FAST_FORWARD
    val state = if (isPlaying) PlaybackState.STATE_PLAYING else PlaybackState.STATE_PAUSED
    mediaSession.setPlaybackState(
      PlaybackState.Builder()
        .setActions(actions)
        .addCustomAction(
          PlaybackState.CustomAction.Builder(
            ACTION_TOGGLE_LIKE,
            if (isLiked) "取消喜欢" else "喜欢",
            if (isLiked) android.R.drawable.btn_star_big_on else android.R.drawable.btn_star_big_off,
          ).build(),
        )
        .setState(state, positionMs, if (isPlaying) playbackRate else 0f, SystemClock.elapsedRealtime())
        .build(),
    )
  }

  private fun publishNotification() {
    if (!hasTrack) return
    val playAction = if (isPlaying) ACTION_PAUSE else ACTION_PLAY
    val playIcon = if (isPlaying) android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play
    val playLabel = if (isPlaying) "暂停" else "播放"
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(this, CHANNEL_ID)
    } else {
      @Suppress("DEPRECATION") Notification.Builder(this)
    }
    builder
      .setSmallIcon(R.drawable.ic_echora_notification)
      .setContentTitle(title)
      .setContentText(listOf(artist, album).filter { it.isNotBlank() }.joinToString(" · "))
      .setContentIntent(activityPendingIntent())
      .setCategory(Notification.CATEGORY_TRANSPORT)
      .setVisibility(Notification.VISIBILITY_PUBLIC)
      .setOnlyAlertOnce(true)
      .setShowWhen(false)
      .setOngoing(isPlaying)
      .addAction(android.R.drawable.ic_media_previous, "上一首", servicePendingIntent(ACTION_PREVIOUS, 1))
      .addAction(playIcon, playLabel, servicePendingIntent(playAction, 2))
      .addAction(android.R.drawable.ic_media_next, "下一首", servicePendingIntent(ACTION_NEXT, 3))
      .addAction(
        if (isLiked) android.R.drawable.btn_star_big_on else android.R.drawable.btn_star_big_off,
        if (isLiked) "取消喜欢" else "喜欢",
        servicePendingIntent(ACTION_TOGGLE_LIKE, 4),
      )
      .setStyle(Notification.MediaStyle().setMediaSession(mediaSession.sessionToken).setShowActionsInCompactView(0, 1, 2))
    artwork?.let(builder::setLargeIcon)
    val notification = builder.build()
    if (isPlaying) startForeground(NOTIFICATION_ID, notification)
    else {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) stopForeground(STOP_FOREGROUND_DETACH)
      else @Suppress("DEPRECATION") stopForeground(false)
      notificationManager.notify(NOTIFICATION_ID, notification)
    }
  }

  private fun clearSession() {
    hasTrack = false
    isPlaying = false
    mediaSession.isActive = false
    mediaSession.setMetadata(null)
    mediaSession.setPlaybackState(null)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) stopForeground(STOP_FOREGROUND_REMOVE)
    else @Suppress("DEPRECATION") stopForeground(true)
    notificationManager.cancel(NOTIFICATION_ID)
    stopSelf()
  }

  private fun dispatchCommand(type: String, position: Double? = null) {
    val payload = JSONObject().put("type", type)
    if (position != null) payload.put("position", position)
    dispatchPayload(payload.toString())
  }

  private fun dispatchPayload(payload: String) {
    val sink = commandSink
    if (sink != null) {
      mainHandler.post { sink(payload) }
      return
    }
    startActivity(
      Intent(this, MainActivity::class.java)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        .putExtra(EXTRA_MEDIA_COMMAND, payload),
    )
  }

  private fun loadArtwork(expectedUrl: String) {
    artworkExecutor.execute {
      val bitmap = runCatching {
        val connection = URL(expectedUrl).openConnection().apply {
          connectTimeout = 5_000
          readTimeout = 8_000
        }
        connection.getInputStream().use(BitmapFactory::decodeStream)
      }.getOrNull() ?: return@execute
      mainHandler.post {
        if (coverUrl != expectedUrl || !hasTrack) return@post
        artwork = bitmap
        publishMetadata()
        publishNotification()
      }
    }
  }

  private fun createNotificationChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    notificationManager.createNotificationChannel(
      NotificationChannel(CHANNEL_ID, "正在播放", NotificationManager.IMPORTANCE_LOW).apply {
        description = "显示当前歌曲与播放控制"
        setShowBadge(false)
        lockscreenVisibility = Notification.VISIBILITY_PUBLIC
      },
    )
  }

  private fun activityPendingIntent(): PendingIntent = PendingIntent.getActivity(
    this,
    0,
    Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
  )

  private fun servicePendingIntent(action: String, requestCode: Int): PendingIntent = PendingIntent.getService(
    this,
    requestCode,
    Intent(this, EchoraMediaService::class.java).setAction(action),
    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
  )
}
