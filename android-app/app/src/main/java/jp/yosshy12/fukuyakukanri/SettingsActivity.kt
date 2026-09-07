package jp.yosshy12.fukuyakukanri

import android.app.Activity
import android.os.Bundle
import android.widget.Toast
import androidx.activity.result.IntentSenderRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import jp.yosshy12.fukuyakukanri.backup.BackupScheduler
import jp.yosshy12.fukuyakukanri.backup.BackupService
import jp.yosshy12.fukuyakukanri.backup.DatabaseRestoreService
import jp.yosshy12.fukuyakukanri.backup.DriveAuthorizationManager
import jp.yosshy12.fukuyakukanri.data.AppDatabase
import jp.yosshy12.fukuyakukanri.data.BackupStatusEntity
import jp.yosshy12.fukuyakukanri.databinding.ActivitySettingsBinding
import jp.yosshy12.fukuyakukanri.importer.SpreadsheetImporter
import jp.yosshy12.fukuyakukanri.security.SecureSettingsStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class SettingsActivity : AppCompatActivity() {
    private lateinit var binding: ActivitySettingsBinding
    private lateinit var settings: SecureSettingsStore
    private lateinit var authorization: DriveAuthorizationManager
    private var pendingAction = DriveAction.CONNECT

    private val authorizationLauncher = registerForActivityResult(
        ActivityResultContracts.StartIntentSenderForResult(),
    ) { result ->
        if (result.resultCode != Activity.RESULT_OK || result.data == null) {
            showMessage("Google Driveへの接続を完了できませんでした")
            return@registerForActivityResult
        }
        runCatching { authorization.resultFromIntent(result.data).accessToken }
            .onSuccess { token ->
                if (token == null) showMessage("Google Driveの認証情報を取得できませんでした")
                else onAuthorized(token)
            }
            .onFailure { showMessage(it.message ?: "Google Driveへ接続できませんでした") }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivitySettingsBinding.inflate(layoutInflater)
        setContentView(binding.root)
        settings = SecureSettingsStore(this)
        authorization = DriveAuthorizationManager(this)

        binding.backButton.setOnClickListener { finish() }
        binding.folderNameInput.setText(settings.driveFolderName)
        binding.endpointInput.setText(settings.spreadsheetEndpoint.orEmpty())
        binding.accessKeyInput.setText(settings.spreadsheetAccessKey.orEmpty())
        renderDriveConnection()

        binding.connectDriveButton.setOnClickListener { requestAuthorization(DriveAction.CONNECT) }
        binding.backupNowButton.setOnClickListener {
            saveFolderName()
            requestAuthorization(DriveAction.BACKUP)
        }
        binding.restoreButton.setOnClickListener {
            AlertDialog.Builder(this)
                .setTitle("最新バックアップを取り込みますか？")
                .setMessage("端末内の同じIDの記録は、バックアップの内容で更新されます。")
                .setNegativeButton("キャンセル", null)
                .setPositiveButton("復元する") { _, _ ->
                    saveFolderName()
                    requestAuthorization(DriveAction.RESTORE)
                }
                .show()
        }
        binding.importButton.setOnClickListener { importSpreadsheet() }

        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                AppDatabase.get(this@SettingsActivity).backupStatusDao().observe().collect(::renderBackupStatus)
            }
        }
    }

    private fun requestAuthorization(action: DriveAction) {
        pendingAction = action
        setBusy(true)
        authorization.authorize(
            authorizationLauncher,
            onReady = ::onAuthorized,
            onError = {
                setBusy(false)
                showMessage(it)
            },
        )
    }

    private fun onAuthorized(token: String) {
        settings.driveConnected = true
        renderDriveConnection()
        when (pendingAction) {
            DriveAction.CONNECT -> {
                setBusy(false)
                BackupScheduler.enqueueSoon(this)
                showMessage("Google Driveに接続しました")
            }
            DriveAction.BACKUP -> lifecycleScope.launch(Dispatchers.IO) {
                val result = BackupService(this@SettingsActivity).backup(token)
                withContext(Dispatchers.Main) {
                    setBusy(false)
                    showMessage(if (result.isSuccess) "バックアップが完了しました" else "バックアップに失敗しました")
                }
            }
            DriveAction.RESTORE -> lifecycleScope.launch(Dispatchers.IO) {
                val result = runCatching {
                    DatabaseRestoreService(this@SettingsActivity).restoreLatest(token, settings.driveFolderName)
                }
                withContext(Dispatchers.Main) {
                    setBusy(false)
                    result.onSuccess {
                        showMessage("薬${it.medicines}件、記録${it.records}件を復元しました")
                        BackupScheduler.enqueueSoon(this@SettingsActivity)
                    }.onFailure { showMessage(it.message ?: "復元できませんでした") }
                }
            }
        }
    }

    private fun importSpreadsheet() {
        val endpoint = binding.endpointInput.text?.toString()?.trim().orEmpty()
        val key = binding.accessKeyInput.text?.toString()?.trim().orEmpty()
        setBusy(true)
        binding.importStatus.text = "取り込んでいます"
        lifecycleScope.launch(Dispatchers.IO) {
            val result = runCatching { SpreadsheetImporter(AppDatabase.get(this@SettingsActivity)).import(endpoint, key) }
            withContext(Dispatchers.Main) {
                setBusy(false)
                result.onSuccess {
                    settings.spreadsheetEndpoint = endpoint
                    settings.spreadsheetAccessKey = key
                    binding.importStatus.text = "薬${it.medicines}件、記録${it.records}件を取り込みました"
                    BackupScheduler.enqueueSoon(this@SettingsActivity)
                }.onFailure { binding.importStatus.text = it.message ?: "取り込めませんでした" }
            }
        }
    }

    private fun saveFolderName() {
        settings.driveFolderName = binding.folderNameInput.text?.toString()?.trim().orEmpty()
        binding.folderNameInput.setText(settings.driveFolderName)
    }

    private fun renderDriveConnection() {
        binding.driveConnectionStatus.text = if (settings.driveConnected) "接続済み" else "未接続"
        binding.connectDriveButton.text = if (settings.driveConnected) "Google Driveへ再接続" else "Google Driveに接続"
    }

    private fun renderBackupStatus(status: BackupStatusEntity?) {
        binding.backupStatus.text = if (status == null) {
            "最終バックアップ：未実行"
        } else {
            val date = status.succeededAt?.let { DATE_FORMAT.format(Date(it)) } ?: "未完了"
            "最終成功：$date\n結果：${status.result}\n${status.message}"
        }
    }

    private fun setBusy(busy: Boolean) {
        binding.connectDriveButton.isEnabled = !busy
        binding.backupNowButton.isEnabled = !busy
        binding.restoreButton.isEnabled = !busy
        binding.importButton.isEnabled = !busy
    }

    private fun showMessage(message: String) = Toast.makeText(this, message, Toast.LENGTH_LONG).show()

    private enum class DriveAction { CONNECT, BACKUP, RESTORE }

    companion object {
        private val DATE_FORMAT = SimpleDateFormat("yyyy/MM/dd HH:mm:ss", Locale.JAPAN)
    }
}
