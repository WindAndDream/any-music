package com.anymusic.app

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.DocumentsContract
import android.webkit.MimeTypeMap
import android.os.SystemClock
import android.system.ErrnoException
import android.system.Os
import android.system.OsConstants
import android.system.StructPollfd
import java.security.MessageDigest

/** Persistent SAF grants and tree URIs belong only to the native download adapter. */
internal class MobileDownloadDirectory(private val context: Context, private val access: MobileDocumentAccess) {
    private val preferences = context.getSharedPreferences("download-directory", Context.MODE_PRIVATE)
    private val resolver = context.contentResolver
    private val permissions = Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION

    fun label(): String? = preferences.getString("label", null)
    fun configured(): Boolean = preferences.contains("tree")

    /** Exact display name, size and complete content must agree; never search by content alone. */
    fun verify(name: String, size: Long, sha256: String, deadline: Long, current: () -> Boolean): Boolean {
        if (!configured() || size !in 0..32L * 1024 * 1024 || !sha256.matches(Regex("[a-f0-9]{64}"))) return false
        val tree = Uri.parse(preferences.getString("tree", null) ?: return false)
        if (!resolver.persistedUriPermissions.any { it.uri == tree && it.isReadPermission }) return false
        val children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree))
        return access.call(deadline, current) {
            resolver.query(children, arrayOf(DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                DocumentsContract.Document.COLUMN_DISPLAY_NAME, DocumentsContract.Document.COLUMN_SIZE), null, null, null)?.use { cursor ->
                while (cursor.moveToNext()) {
                    check(current() && SystemClock.elapsedRealtime() < deadline)
                    if (cursor.getString(1) != name || cursor.getLong(2) != size) continue
                    val uri = DocumentsContract.buildDocumentUriUsingTree(tree, cursor.getString(0))
                    val digest = MessageDigest.getInstance("SHA-256")
                    var total = 0L
                    val matches = resolver.openFileDescriptor(uri, "r")?.use descriptor@ { descriptor ->
                        val fd = descriptor.fileDescriptor
                        Os.fcntlInt(fd, OsConstants.F_SETFL, Os.fcntlInt(fd, OsConstants.F_GETFL, 0) or OsConstants.O_NONBLOCK)
                        val poll = StructPollfd().apply { this.fd = fd; events = OsConstants.POLLIN.toShort() }
                        val buffer = ByteArray(64 * 1024)
                        while (true) {
                            check(current() && SystemClock.elapsedRealtime() < deadline)
                            if (Os.poll(arrayOf(poll), 100) == 0) continue
                            val count = try { Os.read(fd, buffer, 0, buffer.size) }
                                catch (error: ErrnoException) { if (error.errno == OsConstants.EAGAIN) continue else throw error }
                            if (count == 0) break
                            total += count
                            if (total > size) return@descriptor false
                            digest.update(buffer, 0, count)
                        }
                        total == size && digest.digest().joinToString("") { "%02x".format(it) } == sha256
                    } ?: false
                    if (matches) return@call true
                }
                false
            } ?: false
        }
    }

    fun select(uri: Uri, flags: Int, deadline: Long, current: () -> Boolean): String {
        require(uri.scheme == "content" && DocumentsContract.isTreeUri(uri) && flags and permissions == permissions)
        val document = DocumentsContract.buildDocumentUriUsingTree(uri, DocumentsContract.getTreeDocumentId(uri))
        val label = access.call(deadline, current) {
            resolver.query(document, arrayOf(DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                DocumentsContract.Document.COLUMN_MIME_TYPE, DocumentsContract.Document.COLUMN_FLAGS), null, null, null)?.use { cursor ->
                check(cursor.moveToFirst() && cursor.getString(1) == DocumentsContract.Document.MIME_TYPE_DIR &&
                    cursor.getInt(2) and DocumentsContract.Document.FLAG_DIR_SUPPORTS_CREATE != 0)
                cursor.getString(0).take(200).ifBlank { "已选择的文件夹" }
            } ?: error("Directory metadata unavailable")
        }
        check(current())
        val previous = preferences.getString("tree", null)
        resolver.takePersistableUriPermission(uri, permissions)
        try {
            check(current())
            savePreference(uri.toString(), label)
        } catch (error: Exception) {
            if (previous != uri.toString()) release(uri)
            throw error
        }
        if (previous != null && previous != uri.toString()) release(Uri.parse(previous))
        return label
    }

    fun reset() {
        val previous = preferences.getString("tree", null)
        savePreference(null, null)
        if (previous != null) release(Uri.parse(previous))
    }

    fun create(name: String, deadline: Long, current: () -> Boolean): Uri {
        val tree = Uri.parse(preferences.getString("tree", null) ?: error("Directory not selected"))
        check(resolver.persistedUriPermissions.any { it.uri == tree && it.isReadPermission && it.isWritePermission })
        val document = DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree))
        val extension = name.substringAfterLast('.', "").lowercase(java.util.Locale.ROOT)
        val mime = MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension) ?: "application/octet-stream"
        // createDocument creates a new document; providers resolve name collisions without opening existing files.
        return access.call(deadline, current, { it?.let(::discard) }) {
            DocumentsContract.createDocument(resolver, document, mime, name)
        } ?: error("Directory unavailable")
    }

    fun discard(uri: Uri) {
        access.cleanup { DocumentsContract.deleteDocument(resolver, uri) }
    }
    private fun release(uri: Uri) {
        try { resolver.releasePersistableUriPermission(uri, permissions) } catch (_: Exception) {}
    }
    private fun savePreference(tree: String?, label: String?) {
        val previousTree = preferences.getString("tree", null)
        val previousLabel = preferences.getString("label", null)
        if (!preferences.edit().putString("tree", tree).putString("label", label).commit()) {
            // SharedPreferences applies in memory before reporting a disk failure.
            // Restore that projection too, so a failed save cannot change the active destination.
            preferences.edit().putString("tree", previousTree).putString("label", previousLabel).commit()
            error("Directory preference write failed")
        }
    }
}
