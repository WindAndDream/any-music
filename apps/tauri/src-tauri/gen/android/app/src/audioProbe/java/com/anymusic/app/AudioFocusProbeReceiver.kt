package com.anymusic.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioTrack
import android.os.Handler
import android.os.Looper
import android.util.Log

/** Independent test UID/target only: request real focus without hiding or pausing the product.
 * No network, product data, telephone permissions or synthetic system broadcasts. */
class AudioFocusProbeReceiver : BroadcastReceiver() {
    companion object { private var active = false }
    override fun onReceive(context: Context, intent: Intent) {
        val kind = intent.getStringExtra("focus") ?: return
        val gain = when (kind) {
            "gain" -> AudioManager.AUDIOFOCUS_GAIN
            "transient", "communication" -> AudioManager.AUDIOFOCUS_GAIN_TRANSIENT
            "duck" -> AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK
            else -> return
        }
        if (active) return
        active = true
        val pending = goAsync()
        val audio = context.getSystemService(AudioManager::class.java)
        val handler = Handler(Looper.getMainLooper())
        val request = AudioFocusRequest.Builder(gain)
            .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build())
            .setOnAudioFocusChangeListener({ change -> Log.i("AnyMusicAudioProbe", "change=$change") }, handler)
            .build()
        var track: AudioTrack? = null
        var changedMode = false
        val cleanup = {
            runCatching { track?.stop() }
            runCatching { track?.release() }
            if (changedMode) runCatching { audio.mode = AudioManager.MODE_NORMAL }
            runCatching { audio.abandonAudioFocusRequest(request) }
            active = false
            Log.i("AnyMusicAudioProbe", "kind=$kind released")
            pending.finish()
        }
        try {
            val result = audio.requestAudioFocus(request)
            if (kind == "communication" && result == AudioManager.AUDIOFOCUS_REQUEST_GRANTED) {
                // Silent active communication output makes the owned VoIP-mode request eligible.
                val samples = ShortArray(8000)
                val output = AudioTrack.Builder()
                    .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
                    .setAudioFormat(AudioFormat.Builder().setSampleRate(8000).setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                        .setEncoding(AudioFormat.ENCODING_PCM_16BIT).build())
                    .setTransferMode(AudioTrack.MODE_STATIC).setBufferSizeInBytes(samples.size * 2).build()
                track = output
                output.write(samples, 0, samples.size)
                output.setLoopPoints(0, samples.size, -1)
                output.play()
                audio.mode = AudioManager.MODE_IN_COMMUNICATION
                changedMode = true
            }
            Log.i("AnyMusicAudioProbe", "kind=$kind result=$result mode=${audio.mode}")
            handler.postDelayed({ cleanup() }, 8000)
        } catch (error: Exception) {
            Log.e("AnyMusicAudioProbe", "kind=$kind failed", error)
            cleanup()
        }
    }
}
