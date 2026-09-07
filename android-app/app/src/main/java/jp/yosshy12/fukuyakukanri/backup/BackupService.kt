package jp.yosshy12.fukuyakukanri.backup

import android.content.Context
import jp.yosshy12.fukuyakukanri.data.AppDatabase
import jp.yosshy12.fukuyakukanri.data.BackupStatusEntity
import jp.yosshy12.fukuyakukanri.data.MedicationRepository
import jp.yosshy12.fukuyakukanri.data.SyncState
import jp.yosshy12.fukuyakukanri.security.SecureSettingsStore
import kotlinx.coroutines.sync.withLock
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class BackupService(private val context: Context) {
    private val database = AppDatabase.get(context)
    private val settings = SecureSettingsStore(context)

    suspend fun backup(accessToken: String): Result<Unit> = MedicationRepository.databaseMutex.withLock {
        val attemptedAt = System.currentTimeMillis()
        val previousSuccess = database.backupStatusDao().get()?.succeededAt
        database.backupStatusDao().save(
            BackupStatusEntity(
                attemptedAt = attemptedAt,
                succeededAt = previousSuccess,
                result = "実行中",
                message = "Google Driveへ保存しています",
            ),
        )

        runCatching {
            val directory = File(context.cacheDir, "drive-backup").apply { mkdirs() }
            val timestamp = SimpleDateFormat("yyyyMMdd-HHmmss", Locale.JAPAN).format(Date(attemptedAt))
            val databaseFile = File(directory, "服薬管理-$timestamp.sqlite3")
            val csvFile = File(directory, "服薬管理-$timestamp.csv")

            checkpointAndCopy(databaseFile)
            CsvExporter(database).export(csvFile)

            DriveApiClient(accessToken).also { drive ->
                drive.uploadBackup(settings.driveFolderName, databaseFile, "application/x-sqlite3")
                drive.uploadBackup(settings.driveFolderName, csvFile, "text/csv")
            }

            database.medicationDao().updateSyncState(SyncState.PENDING, SyncState.BACKED_UP)
            database.recordDao().updateSyncState(SyncState.PENDING, SyncState.BACKED_UP)
            database.backupStatusDao().save(
                BackupStatusEntity(
                    attemptedAt = attemptedAt,
                    succeededAt = System.currentTimeMillis(),
                    result = "成功",
                    message = "SQLiteとCSVをGoogle Driveへ保存しました",
                ),
            )
            databaseFile.delete()
            csvFile.delete()
            Unit
        }.onFailure { error ->
            database.backupStatusDao().save(
                BackupStatusEntity(
                    attemptedAt = attemptedAt,
                    succeededAt = previousSuccess,
                    result = "失敗",
                    message = error.message ?: "バックアップできませんでした",
                ),
            )
        }
    }

    private fun checkpointAndCopy(destination: File) {
        database.openHelper.writableDatabase.query("PRAGMA wal_checkpoint(FULL)").use { cursor ->
            if (cursor.moveToFirst() && cursor.getInt(0) != 0) {
                throw IllegalStateException("データベースをバックアップ用に確定できませんでした")
            }
        }
        context.getDatabasePath(AppDatabase.NAME).copyTo(destination, overwrite = true)
    }
}
