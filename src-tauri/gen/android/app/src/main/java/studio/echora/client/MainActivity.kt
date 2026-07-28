package studio.echora.client

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioManager
import android.os.Build
import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import org.json.JSONObject

class MainActivity : TauriActivity() {
  private var webViewRef: WebView? = null
  private var pendingQuickAction: String? = null
  private var pendingMediaCommand: String? = null
  private var requestedNotificationPermission = false
  private var lastDarkSurface: Boolean? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    consumeIntent(intent)
    super.onCreate(savedInstanceState)
    volumeControlStream = AudioManager.STREAM_MUSIC
    onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
      override fun handleOnBackPressed() = handleBackNavigation()
    })
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    consumeIntent(intent)
    dispatchPendingNativeActions()
  }

  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    webViewRef = webView
    webView.addJavascriptInterface(SystemBarsBridge(), "EchoraSystemBars")
    webView.addJavascriptInterface(MediaSessionBridge(), "EchoraMediaSession")
    EchoraMediaService.commandSink = { payload -> dispatchWindowEvent("echora-android-media-command", payload) }
    installWindowInsetsSync(webView)
    webView.postDelayed({
      installSystemBarsSync(webView)
      ViewCompat.requestApplyInsets(webView)
      dispatchPendingNativeActions()
    }, 300)
    webView.postDelayed({
      installSystemBarsSync(webView)
      ViewCompat.requestApplyInsets(webView)
      dispatchPendingNativeActions()
    }, 1_500)
  }

  override fun onDestroy() {
    if (EchoraMediaService.commandSink != null) EchoraMediaService.commandSink = null
    webViewRef = null
    super.onDestroy()
  }

  private fun consumeIntent(intent: Intent?) {
    intent ?: return
    intent.getStringExtra("echora_quick_action")?.let {
      if (it == "liked" || it == "search" || it == "daily") pendingQuickAction = it
      intent.removeExtra("echora_quick_action")
    }
    intent.getStringExtra(EchoraMediaService.EXTRA_MEDIA_COMMAND)?.let {
      pendingMediaCommand = it
      intent.removeExtra(EchoraMediaService.EXTRA_MEDIA_COMMAND)
    }
  }

  private fun dispatchPendingNativeActions() {
    pendingQuickAction?.let {
      pendingQuickAction = null
      dispatchWindowEvent("echora-android-quick-action", it)
    }
    pendingMediaCommand?.let {
      pendingMediaCommand = null
      dispatchWindowEvent("echora-android-media-command", it)
    }
  }

  private fun dispatchWindowEvent(name: String, detail: String) {
    val encodedName = JSONObject.quote(name)
    val encodedDetail = JSONObject.quote(detail)
    runOnUiThread {
      webViewRef?.evaluateJavascript(
        "window.dispatchEvent(new CustomEvent($encodedName, { detail: $encodedDetail }));",
        null,
      )
    }
  }

  private fun handleBackNavigation() {
    val webView = webViewRef
    if (webView == null) {
      moveTaskToBack(true)
      return
    }
    webView.evaluateJavascript(
      """
        (() => {
          const visible = (element) => {
            const bounds = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            return bounds.width > 0 && bounds.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
          };
          const lastVisible = (selector) => Array.from(document.querySelectorAll(selector)).filter(visible).at(-1);
          const menu = lastVisible('[role="menu"]');
          if (menu) {
            menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            return true;
          }
          const dialog = lastVisible('[role="dialog"]');
          if (dialog) {
            dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            const close = Array.from(dialog.querySelectorAll('button')).find((button) =>
              visible(button) && (button.getAttribute('aria-label') || '').startsWith('关闭')
            ) || lastVisible('button[aria-label^="关闭"]');
            if (close) {
              close.click();
            }
            return true;
          }
          const back = Array.from(document.querySelectorAll('button')).filter((button) =>
            visible(button) && (button.getAttribute('aria-label') || '').startsWith('返回')
          ).at(-1);
          if (back) {
            back.click();
            return true;
          }
          const collapsePlayer = Array.from(document.querySelectorAll('button')).find((button) =>
            visible(button) && button.getAttribute('title') === '收起歌曲模式'
          );
          if (collapsePlayer) {
            collapsePlayer.click();
            return true;
          }
          return false;
        })();
      """.trimIndent(),
    ) { handled ->
      if (handled != "true") moveTaskToBack(true)
    }
  }

  private fun installWindowInsetsSync(webView: WebView) {
    ViewCompat.setOnApplyWindowInsetsListener(webView) { _, insets ->
      val systemBars = insets.getInsets(
        WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
      )
      val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
      val density = resources.displayMetrics.density
      val top = systemBars.top / density
      val right = systemBars.right / density
      val bottom = systemBars.bottom / density
      val left = systemBars.left / density
      val keyboardVisible = insets.isVisible(WindowInsetsCompat.Type.ime())
      val keyboard = if (keyboardVisible) ime.bottom / density else 0f
      val viewportHeight = (resources.displayMetrics.heightPixels / density) - keyboard
      webView.post {
        webView.evaluateJavascript(
          """
            (() => {
              const root = document.documentElement;
              root.style.setProperty('--native-safe-area-top', '${top}px');
              root.style.setProperty('--native-safe-area-right', '${right}px');
              root.style.setProperty('--native-safe-area-bottom', '${bottom}px');
              root.style.setProperty('--native-safe-area-left', '${left}px');
              root.style.setProperty('--native-keyboard-height', '${keyboard}px');
              root.style.setProperty('--native-viewport-height', '${viewportHeight}px');
              root.dataset.nativeKeyboard = ${if (keyboard > 0f) "'open'" else "'closed'"};
            })();
          """.trimIndent(),
          null
        )
      }
      insets
    }
    ViewCompat.requestApplyInsets(webView)
  }

  private fun installSystemBarsSync(webView: WebView) {
    webView.evaluateJavascript(
      """
        (() => {
          if (window.__echoraSystemBarsSyncInstalled) return;
          window.__echoraSystemBarsSyncInstalled = true;
          let lastDarkSurface;
          const sync = () => {
            const shell = document.querySelector('.client-shell');
            const darkSurface = shell?.dataset.style !== 'light';
            if (darkSurface === lastDarkSurface) return;
            lastDarkSurface = darkSurface;
            window.EchoraSystemBars?.setDarkSurface(darkSurface);
          };
          new MutationObserver(sync).observe(document.documentElement, {
            attributes: true,
            attributeFilter: ['data-style'],
            childList: true,
            subtree: true
          });
          sync();
        })();
      """.trimIndent(),
      null
    )
  }

  private inner class SystemBarsBridge {
    @JavascriptInterface
    fun setDarkSurface(darkSurface: Boolean) {
      runOnUiThread {
        if (lastDarkSurface == darkSurface) return@runOnUiThread
        lastDarkSurface = darkSurface
        WindowCompat.getInsetsController(window, window.decorView).apply {
          isAppearanceLightStatusBars = !darkSurface
          isAppearanceLightNavigationBars = !darkSurface
        }
      }
    }
  }

  private inner class MediaSessionBridge {
    @JavascriptInterface
    fun updateMetadata(payload: String) {
      val value = runCatching { JSONObject(payload) }.getOrNull() ?: return
      EchoraMediaService.send(
        this@MainActivity,
        Intent(this@MainActivity, EchoraMediaService::class.java)
          .setAction(EchoraMediaService.ACTION_UPDATE_METADATA)
          .putExtra("title", value.optString("title"))
          .putExtra("artist", value.optString("artist"))
          .putExtra("album", value.optString("album"))
          .putExtra("coverUrl", value.optString("coverUrl"))
          .putExtra("duration", value.optDouble("duration", 0.0)),
      )
    }

    @JavascriptInterface
    fun updateState(payload: String) {
      val value = runCatching { JSONObject(payload) }.getOrNull() ?: return
      val playing = value.optBoolean("isPlaying", false)
      if (playing) requestNotificationPermission()
      EchoraMediaService.send(
        this@MainActivity,
        Intent(this@MainActivity, EchoraMediaService::class.java)
          .setAction(EchoraMediaService.ACTION_UPDATE_STATE)
          .putExtra("elapsed", value.optDouble("elapsed", 0.0))
          .putExtra("duration", value.optDouble("duration", 0.0))
          .putExtra("playbackRate", value.optDouble("playbackRate", 1.0))
          .putExtra("isPlaying", playing)
          .putExtra("isLiked", value.optBoolean("isLiked", false)),
        foreground = playing,
      )
    }

    @JavascriptInterface
    fun clear() {
      EchoraMediaService.send(
        this@MainActivity,
        Intent(this@MainActivity, EchoraMediaService::class.java).setAction(EchoraMediaService.ACTION_CLEAR),
      )
    }
  }

  private fun requestNotificationPermission() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || requestedNotificationPermission) return
    if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) return
    requestedNotificationPermission = true
    ActivityCompat.requestPermissions(this, arrayOf(Manifest.permission.POST_NOTIFICATIONS), 2107)
  }
}
