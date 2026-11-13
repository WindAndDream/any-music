package com.anymusic.app

import android.content.Context
import android.net.Uri
import android.os.CancellationSignal
import android.os.ParcelFileDescriptor
import android.os.SystemClock
import android.system.Os
import android.system.OsConstants
import android.system.StructPollfd
import java.io.File
import java.io.FileOutputStream
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong

/** content:// is an OS capability, never a filesystem path. Finish a bounded private
 * snapshot before releasing access; neither an external URI nor a disk path reaches JS. */
internal class MobilePackageInbox(private val context: Context) {
    private val directory = File(context.applicationInfo.dataDir, "mobile-inbox").apply { mkdirs() }
    private val epoch = AtomicLong()
    private val timer = Executors.newSingleThreadScheduledExecutor()
    private val access = MobileDocumentAccess(context)
    private val hashes = LinkedHashSet<String>()
    @Volatile private var active: CancellationSignal? = null

    init {
        directory.listFiles()?.filter { it.name.matches(Regex("[0-9a-f-]{36}\\.(pending|amplugin)")) }
            ?.forEach { it.delete() }
    }

    fun cancel() {
        epoch.incrementAndGet()
        access.cancel(active)
    }

    fun close() { cancel(); timer.shutdownNow(); access.close() }

    fun ticket(): Long = epoch.get()

    fun stage(uri: Uri, deduplicate: Boolean = true, generation: Long = ticket()): String? {
        require(uri.scheme == "content" && !uri.authority.isNullOrEmpty())
        check(epoch.get() == generation)
        val started = SystemClock.elapsedRealtime()
        val signal = CancellationSignal()
        active = signal
        val timeout = timer.schedule({ access.cancel(signal) }, 5, TimeUnit.SECONDS)
        val id = UUID.randomUUID().toString()
        val pending = File(directory, "$id.pending")
        val snapshot = File(directory, "$id.amplugin")
        try {
            // Display names and sizes are untrusted and can require another unbounded IPC.
            // The Rust archive verifier decides the format from the completed owned bytes.
            val hash = MessageDigest.getInstance("SHA-256")
            access.open(uri, "r", signal, started + 5000) { epoch.get() == generation }.use { descriptor ->
                ParcelFileDescriptor.AutoCloseInputStream(descriptor).use { input ->
                    FileOutputStream(pending).use { output ->
                        val buffer = ByteArray(8192)
                        var total = 0
                        val poll = StructPollfd().apply {
                            fd = descriptor.fileDescriptor
                            events = OsConstants.POLLIN.toShort()
                        }
                        while (true) {
                            check(epoch.get() == generation && !signal.isCanceled &&
                                SystemClock.elapsedRealtime() - started < 5000)
                            if (Os.poll(arrayOf(poll), 100) == 0) continue
                            val count = input.read(buffer)
                            if (count < 0) break
                            total += count
                            require(total <= 16 * 1024 * 1024)
                            output.write(buffer, 0, count)
                            hash.update(buffer, 0, count)
                        }
                        require(total > 0)
                        output.fd.sync()
                    }
                }
            }
            check(epoch.get() == generation && !signal.isCanceled)
            val digest = hash.digest().joinToString("") { "%02x".format(it) }
            synchronized(hashes) {
                if (hashes.contains(digest) && deduplicate) return null
                check(pending.renameTo(snapshot))
                hashes.add(digest)
                while (hashes.size > 32) hashes.remove(hashes.first())
            }
            return id
        } finally {
            timeout.cancel(false)
            active = null
            pending.delete()
        }
    }
}
