package com.anymusic.app

import android.content.Context
import android.content.Intent
import android.content.ContextWrapper
import android.content.pm.ApplicationInfo
import android.net.Uri
import android.os.Bundle
import android.security.keystore.KeyInfo
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.security.KeyStore
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
import javax.crypto.SecretKeyFactory
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class MobilePlatformTest {
    private fun fixture(test: (Context, File) -> Unit) {
        val target = InstrumentationRegistry.getInstrumentation().targetContext
        val root = File(target.cacheDir, "s16-test-${UUID.randomUUID()}").apply { mkdirs() }
        val scoped = object : ContextWrapper(target) {
            override fun getNoBackupFilesDir() = File(root, "no-backup").apply { mkdirs() }
            override fun getApplicationInfo() = ApplicationInfo(target.applicationInfo).apply { dataDir = root.path }
        }
        try { test(scoped, root) }
        finally {
            check(root.parentFile == target.cacheDir && root.name.startsWith("s16-test-"))
            root.deleteRecursively()
        }
    }
    private fun document(name: String) = Uri.parse("content://${InstrumentationRegistry.getInstrumentation().context.packageName}.documents/$name")

    @Test fun credential_key_survives_recreation_and_is_wrapped_on_disk() = fixture { context, _ ->
        val first = AndroidCredentialKey.load(context)
        val wrapped = File(context.noBackupFilesDir, "credential-key.v1").readBytes()
        assertEquals(32, first.size)
        assertEquals(61, wrapped.size)
        assertArrayEquals(first, AndroidCredentialKey.load(context))
        assertFalse(wrapped.toList().windowed(32).any { it == first.toList() })
        first.fill(0)
    }
    @Test fun keystore_wrapping_key_is_nonextractable_and_reports_device_protection() = fixture { context, _ ->
        AndroidCredentialKey.load(context).fill(0)
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        val key = store.getKey("any-music-credential-wrapping-v1", null)
        assertNull(key.encoded)
        val info = SecretKeyFactory.getInstance(key.algorithm, "AndroidKeyStore")
            .getKeySpec(key as javax.crypto.SecretKey, KeyInfo::class.java) as KeyInfo
        assertEquals(256, info.keySize)
        assertTrue(info.blockModes.contains("GCM"))
        @Suppress("DEPRECATION")
        val hardware = info.isInsideSecureHardware
        InstrumentationRegistry.getInstrumentation().sendStatus(2, Bundle().apply {
            putString("s16KeystoreHardwareBacked", hardware.toString())
            putString("s16KeystoreNonextractable", "true")
        })
    }
    @Test fun corrupt_or_missing_key_never_replaces_existing_credentials() = fixture { context, root ->
        AndroidCredentialKey.load(context).fill(0)
        val file = File(context.noBackupFilesDir, "credential-key.v1")
        val corrupt = file.readBytes().also { it[it.lastIndex] = (it.last().toInt() xor 1).toByte() }
        file.writeBytes(corrupt)
        assertTrue(runCatching { AndroidCredentialKey.load(context) }.isFailure)
        assertArrayEquals(corrupt, file.readBytes())
        assertTrue(file.delete())
        val credentials = File(root, "retained.vault").apply { writeBytes(byteArrayOf(4,5,6)) }
        assertTrue(runCatching { AndroidCredentialKey.load(context) }.isFailure)
        assertArrayEquals(byteArrayOf(4,5,6), credentials.readBytes())
        assertFalse(file.exists())
    }
    @Test fun content_uri_becomes_private_snapshot_and_duplicate_events_are_bounded() = fixture { context, root ->
        val inbox = MobilePackageInbox(context)
        val id = inbox.stage(document("small"))!!
        assertArrayEquals(byteArrayOf(1,2,3), File(root, "mobile-inbox/$id.amplugin").readBytes())
        assertNull(inbox.stage(document("small")))
        assertNotNull(inbox.stage(document("small"), false))
        assertEquals(2, File(root, "mobile-inbox").listFiles()!!.size)
    }
    @Test fun size_claims_paths_and_expired_access_do_not_bypass_acquisition() = fixture { context, root ->
        assertNull(packageIntentUri(Intent(Intent.ACTION_SEND).putExtra(Intent.EXTRA_STREAM, Intent())))
        assertNull(packageIntentUri(Intent(Intent.ACTION_SEND).putExtra(Intent.EXTRA_STREAM, "not a URI")))
        assertNull(packageIntentUri(Intent(Intent.ACTION_SEND_MULTIPLE)))
        assertEquals(document("small"), packageIntentUri(Intent(Intent.ACTION_SEND).putExtra(Intent.EXTRA_STREAM, document("small"))))
        val inbox = MobilePackageInbox(context)
        for (uri in listOf(Uri.parse("file:///etc/passwd"), Uri.parse("https://example.com/file.amplugin"), document("denied"), document("oversize"))) {
            assertTrue(runCatching { inbox.stage(uri) }.isFailure)
        }
        assertTrue(File(root, "mobile-inbox").listFiles()!!.isEmpty())
    }
    @Test fun background_cancellation_aborts_stalled_read_and_allows_retry() = fixture { context, root ->
        val inbox = MobilePackageInbox(context)
        val failure = AtomicReference<Throwable?>()
        val done = CountDownLatch(1)
        Thread { try { inbox.stage(document("stall")) } catch (error: Throwable) { failure.set(error) } finally { done.countDown() } }.start()
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5)
        while (File(root, "mobile-inbox").listFiles()!!.isEmpty() && done.count > 0 && System.nanoTime() < deadline) Thread.sleep(20)
        inbox.cancel()
        assertTrue(done.await(2, TimeUnit.SECONDS))
        assertNotNull(failure.get())
        assertTrue(File(root, "mobile-inbox").listFiles()!!.isEmpty())
        assertNotNull(inbox.stage(document("small")))
        inbox.close()
    }
    @Test fun process_restart_reclaims_only_own_incomplete_staging() = fixture { context, root ->
        val dir = File(root, "mobile-inbox").apply { mkdirs() }
        File(dir, "${UUID.randomUUID()}.pending").writeText("incomplete")
        File(dir, "unrecognized-data").writeText("retain")
        MobilePackageInbox(context)
        assertEquals(listOf("unrecognized-data"), dir.listFiles()!!.map { it.name })
    }
    @Test fun a_queued_document_cannot_start_after_its_lifecycle_was_cancelled() = fixture { context, root ->
        val inbox = MobilePackageInbox(context)
        try {
            val queuedTicket = inbox.ticket()
            inbox.cancel()
            assertTrue(runCatching { inbox.stage(document("small"), generation = queuedTicket) }.isFailure)
            assertTrue(File(root, "mobile-inbox").listFiles()!!.isEmpty())
            assertNotNull(inbox.stage(document("small")))
        } finally { inbox.close() }
    }
    @Test fun a_provider_ignoring_open_cancellation_cannot_block_the_host_queue() = fixture { context, root ->
        val inbox = MobilePackageInbox(context)
        try {
            val done = CountDownLatch(1)
            val failed = AtomicReference<Throwable?>()
            Thread { try { inbox.stage(document("stall-open")) } catch (error: Throwable) { failed.set(error) } finally { done.countDown() } }.start()
            Thread.sleep(200)
            inbox.cancel()
            assertTrue(done.await(2, TimeUnit.SECONDS))
            assertNotNull(failed.get())
            assertNotNull(inbox.stage(document("small")))
            assertEquals(1, File(root, "mobile-inbox").listFiles()!!.size)
        } finally { inbox.close() }
    }
    @Test fun stalled_bytes_exhaust_the_five_second_budget_without_a_partial_snapshot() = fixture { context, root ->
        val inbox = MobilePackageInbox(context)
        try {
            val started = System.nanoTime()
            assertTrue(runCatching { inbox.stage(document("stall")) }.isFailure)
            assertTrue(System.nanoTime() - started < TimeUnit.MILLISECONDS.toNanos(6500))
            assertTrue(File(root, "mobile-inbox").listFiles()!!.isEmpty())
            assertNotNull(inbox.stage(document("small")))
        } finally { inbox.close() }
    }
}
