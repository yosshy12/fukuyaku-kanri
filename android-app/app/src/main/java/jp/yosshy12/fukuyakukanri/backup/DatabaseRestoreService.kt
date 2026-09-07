package jp.yosshy12.fukuyakukanri.backup

import android.content.Context
import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import jp.yosshy12.fukuyakukanri.data.AppDatabase
import jp.yosshy12.fukuyakukanri.data.MedicationEntity
import jp.yosshy12.fukuyakukanri.data.MedicationRecordEntity
import jp.yosshy12.fukuyakukanri.data.SyncState
import java.io.File

data class RestoreResult(val medicines: Int, val records: Int)

class DatabaseRestoreService(private val context: Context) {
    private val database = AppDatabase.get(context)

    suspend fun restoreLatest(accessToken: String, folderName: String): RestoreResult {
        val downloaded = File(context.cacheDir, "restore-${System.currentTimeMillis()}.sqlite3")
        try {
            val found = DriveApiClient(accessToken).downloadLatestDatabase(folderName, downloaded)
            require(found) { "復元できるSQLiteバックアップがありません" }
            return merge(downloaded)
        } finally {
            downloaded.delete()
        }
    }

    private suspend fun merge(file: File): RestoreResult {
        val source = SQLiteDatabase.openDatabase(file.path, null, SQLiteDatabase.OPEN_READONLY)
        source.use { db ->
            require(hasTable(db, "medications") && hasTable(db, "medication_records")) {
                "服薬管理アプリのバックアップではありません"
            }
            val medicines = db.query("medications", null, null, null, null, null, null).use { cursor ->
                buildList { while (cursor.moveToNext()) add(cursor.toMedication()) }
            }
            val records = db.query("medication_records", null, null, null, null, null, null).use { cursor ->
                buildList { while (cursor.moveToNext()) add(cursor.toRecord()) }
            }
            database.medicationDao().upsertAll(medicines)
            database.recordDao().upsertAll(records)
            return RestoreResult(medicines.size, records.size)
        }
    }

    private fun hasTable(database: SQLiteDatabase, name: String): Boolean =
        database.rawQuery("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", arrayOf(name))
            .use { it.moveToFirst() }

    private fun Cursor.toMedication() = MedicationEntity(
        id = string("id"),
        name = string("name"),
        timing = string("timing"),
        sortOrder = int("sortOrder"),
        createdAt = long("createdAt"),
        updatedAt = long("updatedAt"),
        deleted = int("deleted") != 0,
        syncState = SyncState.PENDING,
    )

    private fun Cursor.toRecord() = MedicationRecordEntity(
        id = string("id"),
        medicationAt = long("medicationAt"),
        period = string("period"),
        medicineNames = string("medicineNames"),
        medicineId = nullableString("medicineId"),
        createdAt = long("createdAt"),
        updatedAt = long("updatedAt"),
        deleted = int("deleted") != 0,
        syncState = SyncState.PENDING,
    )

    private fun Cursor.index(name: String) = getColumnIndexOrThrow(name)
    private fun Cursor.string(name: String) = getString(index(name))
    private fun Cursor.nullableString(name: String) = index(name).let { if (isNull(it)) null else getString(it) }
    private fun Cursor.long(name: String) = getLong(index(name))
    private fun Cursor.int(name: String) = getInt(index(name))
}
