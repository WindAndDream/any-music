package com.anymusic.app

import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.media.AudioManager
import android.os.Handler
import android.os.Looper
import android.os.Build
import android.webkit.WebView
import androidx.annotation.RequiresApi
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner

/** WebView owns audio focus. Observe interruptions without a competing focus request,
 * telephony/Bluetooth permissions, private Chromium APIs, or automatic playback on resume. */
internal class MobileAudioInterruptions(private val activity: Activity) {
    private val audio = activity.getSystemService(AudioManager::class.java)
    private val handler = Handler(Looper.getMainLooper())
    private var view: WebView? = null
    private var resumed = false
    private var registered = false
    private var blocked = 1
    private var modeSubscription: AutoCloseable? = null
    private val noisy = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (intent?.action == AudioManager.ACTION_AUDIO_BECOMING_NOISY) publish("audio-output")
        }
    }
    // Synchronize each new document after navigation, including startup during an active call.
    // API 31+ gets native mode changes from the listener; older systems also poll getMode.
    // Only foreground synchronization survives; no background service/task is created.
    private val checkMode = object : Runnable {
        override fun run() {
            if (!resumed) return
            if (Build.VERSION.SDK_INT < 31) updateMode(audio.mode)
            publish("communication")
            handler.postDelayed(this, 500)
        }
    }
    private fun updateMode(mode: Int) {
        if (!resumed) return
        val next = if (mode == AudioManager.MODE_NORMAL) 0 else 2
        if (next != blocked) { blocked = next; publish("communication") }
    }
    @RequiresApi(31)
    private class ModeSubscription(audio: AudioManager, activity: Activity, changed: (Int) -> Unit) : AutoCloseable {
        private val manager = audio
        private val listener = AudioManager.OnModeChangedListener { mode -> changed(mode) }
        init { audio.addOnModeChangedListener(activity.mainExecutor, listener) }
        override fun close() { manager.removeOnModeChangedListener(listener) }
    }
    fun load(webView: WebView) {
        view = webView
        // Rust may register the plugin after Activity.onResume already ran.
        // Start from the actual lifecycle rather than waiting for a second foreground entry.
        if ((activity as? LifecycleOwner)?.lifecycle?.currentState?.isAtLeast(Lifecycle.State.RESUMED) == true) resume()
        else publish("background")
    }
    fun resume() {
        resumed = true
        if (!registered) {
            // This is a protected system broadcast; never accept a package's fake noisy event.
            ContextCompat.registerReceiver(activity, noisy,
                IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY), ContextCompat.RECEIVER_EXPORTED)
            registered = true
        }
        handler.removeCallbacks(checkMode)
        modeSubscription?.close()
        updateMode(audio.mode)
        if (Build.VERSION.SDK_INT >= 31) modeSubscription = ModeSubscription(audio, activity, ::updateMode)
        checkMode.run()
        publish("background")
    }
    fun stop() {
        resumed = false
        blocked = 1
        handler.removeCallbacks(checkMode)
        modeSubscription?.close(); modeSubscription = null
        publish("background")
        if (registered) { activity.unregisterReceiver(noisy); registered = false }
    }
    fun close() { stop(); view = null }
    private fun publish(reason: String) {
        // Values are a native bitmask and fixed literals, never OS-supplied text or device data.
        view?.evaluateJavascript("if(window.anyMusicAudioBlocked!==$blocked||'$reason'==='audio-output'){window.anyMusicAudioBlocked=$blocked;window.dispatchEvent(new CustomEvent('any-music:mobile-audio-interruption',{detail:'$reason'}))}", null)
    }
}
