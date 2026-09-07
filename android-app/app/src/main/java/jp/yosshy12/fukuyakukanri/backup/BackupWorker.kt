package jp.yosshy12.fukuyakukanri.backup

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
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
            onFailure = { if (runAttemptCount < 3) Result.retry() else Result.failure() },
        )
    }
}
