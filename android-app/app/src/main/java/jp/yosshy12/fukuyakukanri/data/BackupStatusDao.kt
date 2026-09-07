package jp.yosshy12.fukuyakukanri.data

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

@Dao
interface BackupStatusDao {
    @Query("SELECT * FROM backup_status WHERE id = 1")
    fun observe(): Flow<BackupStatusEntity?>

    @Query("SELECT * FROM backup_status WHERE id = 1")
    suspend fun get(): BackupStatusEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun save(value: BackupStatusEntity)
}
