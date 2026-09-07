package jp.yosshy12.fukuyakukanri.backup

import android.content.Context
import android.content.Intent
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.IntentSenderRequest
import com.google.android.gms.auth.api.identity.AuthorizationRequest
import com.google.android.gms.auth.api.identity.AuthorizationResult
import com.google.android.gms.auth.api.identity.Identity
import com.google.android.gms.common.api.Scope
import com.google.android.gms.tasks.Tasks

class DriveAuthorizationManager(context: Context) {
    private val client = Identity.getAuthorizationClient(context)
    private val request = AuthorizationRequest.builder()
        .setRequestedScopes(listOf(Scope(DRIVE_FILE_SCOPE)))
        .build()

    fun authorize(
        launcher: ActivityResultLauncher<IntentSenderRequest>,
        onReady: (String) -> Unit,
        onError: (String) -> Unit,
    ) {
        client.authorize(request)
            .addOnSuccessListener { result ->
                if (result.hasResolution()) {
                    launcher.launch(IntentSenderRequest.Builder(result.pendingIntent!!.intentSender).build())
                } else {
                    result.accessToken?.let(onReady) ?: onError("Google Driveの認証情報を取得できませんでした")
                }
            }
            .addOnFailureListener { onError(it.message ?: "Google Driveへ接続できませんでした") }
    }

    fun resultFromIntent(data: Intent?): AuthorizationResult = client.getAuthorizationResultFromIntent(data!!)

    fun accessTokenForBackground(): String {
        val result = Tasks.await(client.authorize(request))
        if (result.hasResolution()) throw IllegalStateException("Google Driveへの再接続が必要です")
        return result.accessToken ?: throw IllegalStateException("Google Driveの認証情報がありません")
    }

    companion object {
        const val DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file"
    }
}
