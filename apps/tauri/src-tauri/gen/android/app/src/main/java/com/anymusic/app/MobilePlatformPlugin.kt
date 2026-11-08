package com.anymusic.app

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.CancellationSignal
import android.os.SystemClock
import android.system.ErrnoException
import android.system.Os
import android.system.OsConstants
import android.system.StructPollfd
import android.util.Base64
import android.webkit.WebView
import androidx.activity.result.ActivityResult
import androidx.appcompat.app.AppCompatActivity
import androidx.webkit.WebViewCompat
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.File
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong

@InvokeArg
class SaveName { lateinit var fileName: String }
@InvokeArg
class SaveCommit { lateinit var token: String; lateinit var id: String }
@InvokeArg
class DownloadVerification { lateinit var fileName: String; var sizeBytes: Long = 0; lateinit var sha256: String }
@InvokeArg
class BilibiliLogin { lateinit var url: String }

/** OS extras are untrusted; malformed or wrongly typed Parcelables cannot crash the host. */
@Suppress("DEPRECATION")
internal fun packageIntentUri(intent: Intent): Uri? {
    if (intent.action !in listOf(Intent.ACTION_VIEW, Intent.ACTION_SEND)) return null
    return try {
        if (intent.action == Intent.ACTION_SEND)
            intent.getParcelableExtra<android.os.Parcelable>(Intent.EXTRA_STREAM) as? Uri
        else intent.data
    } catch (_: RuntimeException) { null }
}

/** Rust-only adapter: the plugin has no JS command handler or granted plugin permissions.
 * OS entries can request a preview; only the Rust installer can verify/authorize it. */
@TauriPlugin
class MobilePlatformPlugin(private val activity: Activity) : Plugin(activity) {
    private val audioInterruptions = MobileAudioInterruptions(activity)
    private val inbox = MobilePackageInbox(activity)
    private val saveAccess = MobileDocumentAccess(activity)
    private val downloadDirectory = MobileDownloadDirectory(activity, saveAccess)
    private val io = Executors.newSingleThreadExecutor()
    private val queued = AtomicInteger()
    private val lifecycle = AtomicLong()
    private val incoming = ArrayDeque<Pair<String, String>>()
    private val links = LinkedHashSet<String>()
    private data class Destination(val uri: Uri, val created: Long, val download: Boolean = false)
    private val destinations = HashMap<String, Destination>()
    private val timer = Executors.newSingleThreadScheduledExecutor()
    @Volatile private var saving: CancellationSignal? = null
    private var pendingChoice: Invoke? = null
    @Volatile private var choosing = false
    @Volatile private var foreground = true
    private var mainView: WebView? = null

    override fun load(webView: WebView) {
        mainView = webView
        audioInterruptions.load(webView)
        // A killed process cannot replay an old save. Preserve unrelated files.
        File(activity.applicationInfo.dataDir, "mobile-outbox").listFiles()
            ?.filter { it.name.matches(Regex("[0-9a-f-]{36}(\\.tmp)?")) }?.forEach { it.delete() }
        receive(activity.intent)
    }
    override fun onNewIntent(intent: Intent) { receive(intent) }
    override fun onResume(activity: AppCompatActivity) { foreground = true; audioInterruptions.resume() }
    override fun onStop(activity: AppCompatActivity) {
        audioInterruptions.stop()
        if (!choosing) {
            lifecycle.incrementAndGet()
            foreground = false; inbox.cancel(); saveAccess.cancel(saving)
            clearDestinations()
            clearIncoming()
        }
    }
    override fun onDestroy(activity: AppCompatActivity) {
        audioInterruptions.close()
        lifecycle.incrementAndGet()
        clearDestinations()
        foreground = false; inbox.close(); saveAccess.cancel(saving); saveAccess.close(); timer.shutdownNow(); io.shutdown()
        clearIncoming()
        pendingChoice?.reject("System picker closed"); pendingChoice = null; mainView = null
    }

    private fun choose(invoke: Invoke, intent: Intent, callback: String) {
        choosing = true; pendingChoice = invoke
        try { startActivityForResult(invoke, intent, callback) }
        catch (_: Exception) { choosing = false; pendingChoice = null; invoke.reject("System picker unavailable") }
    }

    private fun clearDestinations() {
        val discarded = synchronized(destinations) { destinations.values.toList().also { destinations.clear() } }
        discarded.filter { it.download }.forEach { downloadDirectory.discard(it.uri) }
    }
    private fun registerDestination(uri: Uri, download: Boolean = false): String {
        val token = UUID.randomUUID().toString()
        try {
            synchronized(destinations) {
                check(destinations.size < 16)
                destinations[token] = Destination(uri, SystemClock.elapsedRealtime(), download)
            }
            timer.schedule({
                val expired = synchronized(destinations) { destinations.remove(token) }
                if (expired?.download == true) downloadDirectory.discard(expired.uri)
            }, 30, TimeUnit.SECONDS)
            return token
        } catch (error: Exception) {
            synchronized(destinations) { destinations.remove(token) }
            if (download) downloadDirectory.discard(uri)
            throw error
        }
    }

    private fun receive(intent: Intent) {
        val uri = packageIntentUri(intent) ?: return
        if (uri.scheme == "anymusic") {
            val url = uri.toString()
            if (url.length <= 8192) {
                val digest = MessageDigest.getInstance("SHA-256").digest(url.toByteArray())
                    .joinToString("") { "%02x".format(it) }
                if (links.add(digest)) {
                    while (links.size > 32) links.remove(links.first())
                    enqueue("url", url)
                }
            }
            return
        }
        if (uri.scheme != "content" || intent.flags and Intent.FLAG_GRANT_READ_URI_PERMISSION == 0 ||
            (intent.clipData?.itemCount ?: 1) != 1) return
        if (queued.incrementAndGet() > 2) { queued.decrementAndGet(); return }
        val generation = inbox.ticket()
        val episode = lifecycle.get()
        io.execute {
            try { inbox.stage(uri, generation = generation)?.let { enqueue("file", it, episode) } }
            catch (_: Exception) { enqueue("error", "Package unavailable, cancelled or over budget", episode) }
            finally { queued.decrementAndGet() }
        }
    }
    private fun discardIncomingFile(kind: String, value: String) {
        if (kind == "file" && value.matches(Regex("[0-9a-f-]{36}"))) {
            File(activity.applicationInfo.dataDir, "mobile-inbox/$value.amplugin").delete()
        }
    }
    private fun clearIncoming() {
        synchronized(incoming) {
            incoming.forEach { discardIncomingFile(it.first, it.second) }
            incoming.clear()
        }
    }
    private fun enqueue(kind: String, value: String, episode: Long = lifecycle.get()) {
        synchronized(incoming) {
            if (episode != lifecycle.get() || incoming.size >= 4) {
                discardIncomingFile(kind, value)
                return
            }
            incoming.add(kind to value)
        }
        // A fixed notification only asks the trusted host to drain its native inbox.
        // Its payload supplies no URI, package bytes, identity or authorization.
        activity.runOnUiThread {
            mainView?.evaluateJavascript("window.dispatchEvent(new Event('any-music:mobile-package-ready'))", null)
        }
    }
    @Command
    fun openBilibiliLogin(invoke: Invoke) {
        val link = invoke.parseArgs(BilibiliLogin::class.java).url
        val target = bilibiliLoginIntent(link)
        if (target == null) { invoke.reject("Invalid login handoff", "invalid_handoff"); return }
        activity.runOnUiThread {
            try {
                activity.startActivity(Intent.createChooser(target, "选择哔哩哔哩应用"))
                invoke.resolve()
            } catch (_: ActivityNotFoundException) {
                invoke.reject("Bilibili application unavailable", "app_unavailable")
            } catch (_: Exception) {
                invoke.reject("Bilibili handoff failed", "handoff_failed")
            }
        }
    }
    @Command
    fun drainPackage(invoke: Invoke) {
        val item = synchronized(incoming) { incoming.removeFirstOrNull() }
        invoke.resolve(JSObject().put("kind", item?.first).put("value", item?.second))
    }
    @Command
    fun environment(invoke: Invoke) {
        val provider = WebViewCompat.getCurrentWebViewPackage(activity)
        invoke.resolve(JSObject().put("sdk", Build.VERSION.SDK_INT).put("fingerprint", Build.FINGERPRINT)
            .put("webviewPackage", provider?.packageName).put("webviewVersion", provider?.versionName))
    }
    @Command
    fun credentialKey(invoke: Invoke) {
        io.execute {
            try {
                val key = AndroidCredentialKey.load(activity)
                try { invoke.resolve(JSObject().put("key", Base64.encodeToString(key, Base64.NO_WRAP))) }
                finally { key.fill(0) }
            } catch (_: Exception) { invoke.reject("System credential key unavailable") }
        }
    }
    @Command
    fun pickPackage(invoke: Invoke) {
        if (choosing) { invoke.reject("A system picker is already open"); return }
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
            .setType("*/*").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        choose(invoke, intent, "packagePicked")
    }
    @ActivityCallback
    fun packagePicked(invoke: Invoke, result: ActivityResult) {
        choosing = false; pendingChoice = null
        foreground = true
        val uri = result.data?.data
        if (result.resultCode != Activity.RESULT_OK || uri == null) { invoke.resolve(JSObject()); return }
        val generation = inbox.ticket()
        io.execute {
            try { invoke.resolve(JSObject().put("id", inbox.stage(uri, false, generation))) }
            catch (_: Exception) { invoke.reject("Package unavailable, cancelled or over budget") }
        }
    }
    @Command
    fun getDownloadDirectory(invoke: Invoke) {
        invoke.resolve(JSObject().put("directory", downloadDirectory.label() ?: org.json.JSONObject.NULL))
    }
    @Command
    fun chooseDownloadDirectory(invoke: Invoke) {
        if (choosing) { invoke.reject("A system picker is already open"); return }
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or
            Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION or Intent.FLAG_GRANT_PREFIX_URI_PERMISSION)
        choose(invoke, intent, "downloadDirectoryPicked")
    }
    @ActivityCallback
    fun downloadDirectoryPicked(invoke: Invoke, result: ActivityResult) {
        choosing = false; pendingChoice = null; foreground = true
        val uri = result.data?.data
        if (result.resultCode != Activity.RESULT_OK || uri == null) {
            invoke.resolve(JSObject().put("selected", false)); return
        }
        val generation = lifecycle.get()
        io.execute {
            try {
                val label = downloadDirectory.select(uri, result.data?.flags ?: 0, SystemClock.elapsedRealtime() + 5000) {
                    foreground && lifecycle.get() == generation
                }
                invoke.resolve(JSObject().put("selected", true).put("directory", label))
            } catch (_: Exception) { invoke.reject("Directory unavailable or permission not persisted") }
        }
    }
    @Command
    fun resetDownloadDirectory(invoke: Invoke) {
        if (choosing) { invoke.reject("A system picker is already open"); return }
        io.execute {
            try { downloadDirectory.reset(); invoke.resolve(JSObject().put("directory", org.json.JSONObject.NULL)) }
            catch (_: Exception) { invoke.reject("Directory preference write failed") }
        }
    }
    @Command
    fun verifyDownload(invoke: Invoke) {
        val args = invoke.parseArgs(DownloadVerification::class.java)
        val generation = lifecycle.get()
        io.execute {
            try {
                val matches = downloadDirectory.verify(args.fileName, args.sizeBytes, args.sha256,
                    SystemClock.elapsedRealtime() + 5000) { foreground && lifecycle.get() == generation }
                invoke.resolve(JSObject().put("matches", matches))
            } catch (_: Exception) { invoke.resolve(JSObject().put("matches", false)) }
        }
    }
    @Command
    fun prepareDownload(invoke: Invoke) {
        if (!downloadDirectory.configured()) { prepareSave(invoke); return }
        val name = invoke.parseArgs(SaveName::class.java).fileName
        if (name.isEmpty() || name.length > 200 || name.any { it == '/' || it == '\\' || it == '\u0000' }) {
            invoke.reject("Invalid download filename"); return
        }
        val generation = lifecycle.get()
        io.execute {
            try {
                val uri = downloadDirectory.create(name, SystemClock.elapsedRealtime() + 5000) { foreground && lifecycle.get() == generation }
                if (!foreground || lifecycle.get() != generation) { downloadDirectory.discard(uri); error("Save cancelled") }
                val token = registerDestination(uri, true)
                invoke.resolve(JSObject().put("token", token))
            } catch (_: Exception) { invoke.reject("Download directory unavailable; select the directory again") }
        }
    }
    @Command
    fun prepareSave(invoke: Invoke) {
        val name = invoke.parseArgs(SaveName::class.java).fileName
        if (choosing || name.isEmpty() || name.length > 200 || name.any { it == '/' || it == '\\' || it == '\u0000' }) {
            invoke.reject("Save is busy or filename is invalid"); return
        }
        val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
            .setType("application/octet-stream").putExtra(Intent.EXTRA_TITLE, name)
        choose(invoke, intent, "savePicked")
    }
    @ActivityCallback
    fun savePicked(invoke: Invoke, result: ActivityResult) {
        choosing = false; pendingChoice = null
        foreground = true
        val uri = result.data?.data
        if (result.resultCode != Activity.RESULT_OK || uri?.scheme != "content") { invoke.resolve(JSObject()); return }
        try { invoke.resolve(JSObject().put("token", registerDestination(uri))) }
        catch (_: Exception) { invoke.reject("Save queue is full") }
    }
    @Command
    fun commitSave(invoke: Invoke) {
        val generation = lifecycle.get()
        val args = invoke.parseArgs(SaveCommit::class.java)
        val destination = synchronized(destinations) { destinations.remove(args.token) }
        if (destination == null || SystemClock.elapsedRealtime() - destination.created > 30_000 ||
            !args.id.matches(Regex("[0-9a-f-]{36}"))) {
            if (destination?.download == true) downloadDirectory.discard(destination.uri)
            invoke.reject("Save expired"); return
        }
        io.execute {
            val root = File(activity.applicationInfo.dataDir, "mobile-outbox")
            val file = File(root, args.id)
            val signal = CancellationSignal()
            saving = signal
            val started = SystemClock.elapsedRealtime()
            val timeout = timer.schedule({ saveAccess.cancel(signal) }, 5, TimeUnit.SECONDS)
            try {
                require(foreground && lifecycle.get() == generation && started - destination.created <= 30_000 && file.canonicalFile.parentFile == root.canonicalFile &&
                    file.isFile && file.length() <= 32 * 1024 * 1024)
                file.inputStream().use { input ->
                    saveAccess.open(destination.uri, "wt", signal, started + 5000) { foreground && lifecycle.get() == generation }.use { output ->
                        val descriptor = output.fileDescriptor
                        val flags = Os.fcntlInt(descriptor, OsConstants.F_GETFL, 0)
                        Os.fcntlInt(descriptor, OsConstants.F_SETFL, flags or OsConstants.O_NONBLOCK)
                        val poll = StructPollfd().apply { fd = descriptor; events = OsConstants.POLLOUT.toShort() }
                        val buffer = ByteArray(4096)
                        while (true) {
                            check(foreground && lifecycle.get() == generation && !signal.isCanceled && SystemClock.elapsedRealtime() - started < 5000)
                            val count = input.read(buffer)
                            if (count < 0) break
                            var offset = 0
                            while (offset < count) {
                                check(foreground && lifecycle.get() == generation && !signal.isCanceled && SystemClock.elapsedRealtime() - started < 5000)
                                if (Os.poll(arrayOf(poll), 100) == 0) continue
                                try { offset += Os.write(descriptor, buffer, offset, count - offset) }
                                catch (error: ErrnoException) { if (error.errno != OsConstants.EAGAIN) throw error }
                            }
                        }
                    }
                }
                invoke.resolve()
            } catch (_: Exception) {
                if (destination.download) downloadDirectory.discard(destination.uri)
                invoke.reject("Save cancelled or unavailable")
            }
            finally { timeout.cancel(false); saving = null; file.delete() }
        }
    }
}
