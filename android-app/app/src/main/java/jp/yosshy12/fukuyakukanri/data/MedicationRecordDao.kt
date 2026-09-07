package jp.yosshy12.fukuyakukanri.data

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

@Dao
interface MedicationRecordDao {
    @Query("SELECT * FROM medication_records WHERE deleted = 0 ORDER BY medicationAt DESC LIMIT 100")
    fun observeRecent(): Flow<List<MedicationRecordEntity>>

    @Query("SELECT * FROM medication_records ORDER BY medicationAt DESC")
    suspend fun allIncludingDeleted(): List<MedicationRecordEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(value: MedicationRecordEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertAll(values: List<MedicationRecordEntity>)

    @Query("UPDATE medication_records SET deleted = 1, updatedAt = :now, syncState = :syncState WHERE id = :id")
    suspend fun softDelete(id: String, now: Long, syncState: String = SyncState.PENDING)

    @Query("UPDATE medication_records SET syncState = :newState WHERE syncState = :oldState")
    suspend fun updateSyncState(oldState: String, newState: String)
}
