package com.anymusic.app

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.AtomicFile
import java.io.File
import java.security.KeyStore
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Only the wrapped data key is on disk. The wrapping key never leaves AndroidKeyStore.
 * Missing/invalidated keys fail closed: existing encrypted credentials are not replaced. */
internal object AndroidCredentialKey {
    private const val ALIAS = "any-music-credential-wrapping-v1"
    private val AAD = "any-music:credential-key:v1".toByteArray(Charsets.UTF_8)

    @Synchronized
    fun load(context: Context): ByteArray {
        val file = AtomicFile(File(context.noBackupFilesDir, "credential-key.v1"))
        val existing = file.baseFile.exists() || File(file.baseFile.path + ".bak").exists()
        require(existing || File(context.applicationInfo.dataDir).listFiles()?.none {
            it.isFile && it.name.endsWith(".vault")
        } != false) { "Existing credentials require their original data key" }
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        if (existing && !store.containsAlias(ALIAS)) error("Credential key is unavailable")
        val key = if (store.containsAlias(ALIAS)) {
            store.getKey(ALIAS, null) as SecretKey
        } else {
            KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
                init(KeyGenParameterSpec.Builder(ALIAS,
                    KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                    .setKeySize(256).setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setRandomizedEncryptionRequired(true).build())
            }.generateKey()
        }
        if (existing) {
            val bytes = file.openRead().use { input ->
                val buffer = ByteArray(62)
                var count = 0
                while (count < buffer.size) {
                    val read = input.read(buffer, count, buffer.size - count)
                    if (read < 0) break
                    count += read
                }
                require(count == 61 && buffer[0] == 1.toByte())
                buffer.copyOfRange(0, count)
            }
            return Cipher.getInstance("AES/GCM/NoPadding").run {
                init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, bytes.copyOfRange(1, 13)))
                updateAAD(AAD)
                doFinal(bytes.copyOfRange(13, bytes.size)).also { require(it.size == 32) }
            }
        }
        val value = ByteArray(32).also { SecureRandom().nextBytes(it) }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply {
            init(Cipher.ENCRYPT_MODE, key)
            updateAAD(AAD)
        }
        val bytes = byteArrayOf(1) + cipher.iv + cipher.doFinal(value)
        val output = file.startWrite()
        try {
            output.write(bytes)
            file.finishWrite(output)
        } catch (error: Exception) {
            file.failWrite(output)
            value.fill(0)
            throw error
        }
        return value
    }
}
