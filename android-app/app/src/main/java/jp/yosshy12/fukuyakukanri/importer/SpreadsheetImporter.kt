package jp.yosshy12.fukuyakukanri.importer

import android.net.Uri
import jp.yosshy12.fukuyakukanri.data.AppDatabase
import jp.yosshy12.fukuyakukanri.data.MedicationEntity
import jp.yosshy12.fukuyakukanri.data.MedicationRecordEntity
import jp.yosshy12.fukuyakukanri.data.SyncState
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.UUID

data class ImportResult(val medicines: Int, val records: Int)

class SpreadsheetImporter(private val database: AppDatabase) {
    suspend fun import(endpoint: String, accessKey: String): ImportResult {
        val parsed = Uri.parse(endpoint)
        require(parsed.scheme == "https" && parsed.host == "script.google.com" && parsed.path?.endsWith("/exec") == true) {
            "Apps Scriptの正しいURLを入力してください"
        }
        require(accessKey.isNotBlank()) { "接続キーを入力してください" }

        val url = parsed.buildUpon()
            .appendQueryParameter("action", "bootstrap")
            .appendQueryParameter("key", accessKey)
            .appendQueryParameter("includeAll", "1")
            .appendQueryParameter("_", System.currentTimeMillis().toString())
            .build().toString()
        val connection = URL(url).openConnection() as HttpURLConnection
        connection.connectTimeout = 15_000
        connection.readTimeout = 30_000
        val body = (if (connection.responseCode in 200..299) connection.inputStream else connection.errorStream)
            .bufferedReader(Charsets.UTF_8).use { it.readText() }
        val root = JSONObject(body)
        require(root.optBoolean("ok")) { root.optString("message", "スプレッドシートを読み込めませんでした") }

        val now = System.currentTimeMillis()
        val medicinesJson = root.optJSONArray("medicines")
        val importedMedicines = buildList {
            if (medicinesJson != null) for (index in 0 until medicinesJson.length()) {
                val item = medicinesJson.getJSONObject(index)
                add(
                    MedicationEntity(
                        id = uuidFor("medicine", item.optString("id")),
                        name = item.getString("name"),
                        timing = item.getString("timing"),
                        sortOrder = item.optInt("sortOrder", index + 1),
                        createdAt = item.optLong("createdAt").takeIf { it > 0 } ?: now,
                        updatedAt = item.optLong("updatedAt").takeIf { it > 0 } ?: now,
                        syncState = SyncState.PENDING,
                    ),
                )
            }
        }
        val recordsJson = root.optJSONArray("history")
        val importedRecords = buildList {
            if (recordsJson != null) for (index in 0 until recordsJson.length()) {
                val item = recordsJson.getJSONObject(index)
                val medicationAt = DATE_FORMAT.get().parse(item.getString("date"))?.time
                if (medicationAt != null) {
                    add(
                        MedicationRecordEntity(
                            id = uuidFor("record", item.optString("id")),
                            medicationAt = medicationAt,
                            period = item.getString("period"),
                            medicineNames = item.optString("medicines"),
                            createdAt = item.optLong("createdAt").takeIf { it > 0 } ?: now,
                            updatedAt = item.optLong("updatedAt").takeIf { it > 0 } ?: now,
                            syncState = SyncState.PENDING,
                        ),
                    )
                }
            }
        }
        database.medicationDao().upsertAll(importedMedicines)
        database.recordDao().upsertAll(importedRecords)
        return ImportResult(importedMedicines.size, importedRecords.size)
    }

    private fun uuidFor(type: String, original: String): String =
        runCatching { UUID.fromString(original).toString() }
            .getOrElse { UUID.nameUUIDFromBytes("$type:$original".toByteArray()).toString() }

    companion object {
        private val DATE_FORMAT = ThreadLocal.withInitial {
            SimpleDateFormat("yyyy/MM/dd HH:mm", Locale.JAPAN).apply { isLenient = false }
        }
    }
}
