package jp.yosshy12.fukuyakukanri.backup

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import jp.yosshy12.fukuyakukanri.data.AppDatabase
import jp.yosshy12.fukuyakukanri.data.BackupStatusEntity
import jp.yosshy12.fukuyakukanri.security.SecureSettingsStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class BackupWorker(context: Context, parameters: WorkerParameters) : CoroutineWorker(context, parameters) {
    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val settings = SecureSettingsStore(applicationContext)
        if (!settings.driveConnected) return@withContext Result.success()
        runCatching {
            val token = DriveAuthorizationManager(applicationContext).accessTokenForBackground()
            BackupService(applicationContext).backup(token).getOrThrow()
        }.fold(
            onSuccess = { Result.success() },
            onFailure = { error ->
                val statusDao = AppDatabase.get(applicationContext).backupStatusDao()
                val previous = statusDao.get()
                statusDao.save(
                    BackupStatusEntity(
                        attemptedAt = System.currentTimeMillis(),
                        succeededAt = previous?.succeededAt,
                        result = "失敗",
                        message = error.message ?: "自動バックアップできませんでした",
                    ),
                )
                if (runAttemptCount < 3) Result.retry() else Result.failure()
            },
        )
    }
}
