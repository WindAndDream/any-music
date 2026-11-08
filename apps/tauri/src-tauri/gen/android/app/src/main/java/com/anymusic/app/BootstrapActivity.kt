package com.anymusic.app

import android.content.Intent
import android.os.Bundle
import android.widget.ScrollView
import android.widget.TextView
import androidx.activity.enableEdgeToEdge
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.WebViewCompat

/** Check before constructing Tauri/WebView: a missing provider can fail before
 * onWebViewCreate. OS intent grants are forwarded inside the same app UID. */
class BootstrapActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        val version = try { WebViewCompat.getCurrentWebViewPackage(this)?.versionName }
            catch (_: RuntimeException) { null }
        if (MobileWebViewSupport.supported(version)) {
            startActivity(Intent(intent).setClass(this, MainActivity::class.java))
            finish()
            return
        }
        val message = TextView(this).apply {
            tag = "any-music-webview-unavailable"
            text = getString(R.string.webview_unavailable)
            textSize = 18f
            val padding = (24 * resources.displayMetrics.density).toInt()
            setPadding(padding, padding, padding, padding)
        }
        val content = ScrollView(this).apply { addView(message) }
        setContentView(content)
        ViewCompat.setOnApplyWindowInsetsListener(content) { view, insets ->
            val safe = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            view.setPadding(safe.left, safe.top, safe.right, safe.bottom)
            insets
        }
        ViewCompat.requestApplyInsets(content)
    }
}
