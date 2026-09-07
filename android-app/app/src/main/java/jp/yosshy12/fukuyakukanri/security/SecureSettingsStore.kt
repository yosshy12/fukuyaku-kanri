package jp.yosshy12.fukuyakukanri.security

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

class SecureSettingsStore(context: Context) {
    private val preferences = context.getSharedPreferences("secure_settings", Context.MODE_PRIVATE)

    var spreadsheetEndpoint: String?
        get() = decrypt(preferences.getString("sheet_endpoint", null))
        set(value) = save("sheet_endpoint", value)

    var spreadsheetAccessKey: String?
        get() = decrypt(preferences.getString("sheet_key", null))
        set(value) = save("sheet_key", value)

    var driveFolderName: String
        get() = preferences.getString("drive_folder", DEFAULT_FOLDER) ?: DEFAULT_FOLDER
        set(value) { preferences.edit().putString("drive_folder", value.ifBlank { DEFAULT_FOLDER }).apply() }

    var driveConnected: Boolean
        get() = preferences.getBoolean("drive_connected", false)
        set(value) { preferences.edit().putBoolean("drive_connected", value).apply() }

    private fun save(key: String, value: String?) {
        preferences.edit().apply {
            if (value.isNullOrBlank()) remove(key) else putString(key, encrypt(value))
        }.apply()
    }

    private fun encrypt(value: String): String {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, secretKey())
        return Base64.encodeToString(cipher.iv + cipher.doFinal(value.toByteArray(Charsets.UTF_8)), Base64.NO_WRAP)
    }

    private fun decrypt(value: String?): String? = runCatching {
        if (value == null) return null
        val bytes = Base64.decode(value, Base64.NO_WRAP)
        val iv = bytes.copyOfRange(0, IV_SIZE)
        val encrypted = bytes.copyOfRange(IV_SIZE, bytes.size)
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.DECRYPT_MODE, secretKey(), GCMParameterSpec(128, iv))
        String(cipher.doFinal(encrypted), Charsets.UTF_8)
    }.getOrNull()

    private fun secretKey(): SecretKey {
        val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (keyStore.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").run {
            init(
                KeyGenParameterSpec.Builder(
                    KEY_ALIAS,
                    KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
                )
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .build(),
            )
            generateKey()
        }
    }

    companion object {
        const val DEFAULT_FOLDER = "服薬管理バックアップ"
        private const val KEY_ALIAS = "fukuyaku_secure_settings_v1"
        private const val TRANSFORMATION = "AES/GCM/NoPadding"
        private const val IV_SIZE = 12
    }
}
