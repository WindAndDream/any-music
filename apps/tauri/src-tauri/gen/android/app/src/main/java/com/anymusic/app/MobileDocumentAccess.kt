package com.anymusic.app

import android.content.Context
import android.net.Uri
import android.os.CancellationSignal
import android.os.ParcelFileDescriptor
import android.os.SystemClock
import java.util.concurrent.CompletableFuture
import java.util.concurrent.SynchronousQueue
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException

/** Some providers ignore cancellation during Binder open. Two bounded slots contain
 * those calls; the host queue can return promptly and late descriptors are closed. */
internal class MobileDocumentAccess(private val context: Context) {
    private val opener = ThreadPoolExecutor(0, 2, 60, TimeUnit.SECONDS, SynchronousQueue(),
        { task -> Thread(task, "any-music-document-open").apply { isDaemon = true } })
    private val canceller = ThreadPoolExecutor(0, 2, 60, TimeUnit.SECONDS, SynchronousQueue(),
        { task -> Thread(task, "any-music-document-cancel").apply { isDaemon = true } })

    fun cancel(signal: CancellationSignal?) {
        // Remote CancellationSignal listeners are untrusted synchronous Binder calls too.
        // Epoch/foreground/deadline checks end local work even if this advisory call hangs.
        if (signal != null) try { canceller.execute { try { signal.cancel() } catch (_: Exception) {} } }
        catch (_: java.util.concurrent.RejectedExecutionException) { /* Bounded failed provider slots. */ }
    }
    fun close() { opener.shutdownNow(); canceller.shutdown() }
    fun cleanup(action: () -> Unit) {
        try { opener.execute { try { action() } catch (_: Exception) {} } }
        catch (_: java.util.concurrent.RejectedExecutionException) { /* Best-effort cleanup stays bounded. */ }
    }

    fun open(uri: Uri, mode: String, signal: CancellationSignal, deadline: Long, current: () -> Boolean): ParcelFileDescriptor {
        return call(deadline, { current() && !signal.isCanceled }, { it?.close() }) {
            context.contentResolver.openFileDescriptor(uri, mode, signal)
        } ?: error("Document access expired")
    }

    /** Tree metadata and creation can block in a provider too; share the bounded slots. */
    fun <T> call(deadline: Long, current: () -> Boolean, discard: (T) -> Unit = {}, action: () -> T): T {
        val result = CompletableFuture<T>()
        try {
            opener.execute {
                try {
                    check(current() && SystemClock.elapsedRealtime() < deadline)
                    val value = action()
                    if (!result.complete(value)) discard(value)
                } catch (error: Exception) { result.completeExceptionally(error) }
            }
            while (true) {
                check(current() && SystemClock.elapsedRealtime() < deadline)
                try { return result.get(100, TimeUnit.MILLISECONDS) }
                catch (_: TimeoutException) { /* Recheck the lifecycle without blocking the host queue. */ }
            }
        } catch (error: Exception) {
            if (!result.completeExceptionally(error) && !result.isCompletedExceptionally) discard(result.getNow(null))
            throw error
        }
    }
}
