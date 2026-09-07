package jp.yosshy12.fukuyakukanri.data

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "backup_status")
data class BackupStatusEntity(
    @PrimaryKey val id: Int = 1,
    val attemptedAt: Long? = null,
    val succeededAt: Long? = null,
    val result: String = "未実行",
    val message: String = "Google Driveにまだバックアップしていません",
)
