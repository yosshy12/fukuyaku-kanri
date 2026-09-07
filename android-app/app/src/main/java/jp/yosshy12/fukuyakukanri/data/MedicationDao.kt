package jp.yosshy12.fukuyakukanri.data

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

@Dao
interface MedicationDao {
    @Query("SELECT * FROM medications WHERE deleted = 0 ORDER BY sortOrder, name")
    fun observeActive(): Flow<List<MedicationEntity>>

    @Query("SELECT * FROM medications ORDER BY sortOrder, name")
    suspend fun allIncludingDeleted(): List<MedicationEntity>

    @Query("SELECT * FROM medications WHERE deleted = 0 AND timing = :timing ORDER BY sortOrder")
    suspend fun activeForTiming(timing: String): List<MedicationEntity>

    @Query("SELECT COALESCE(MAX(sortOrder), 0) + 1 FROM medications")
    suspend fun nextSortOrder(): Int

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(value: MedicationEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertAll(values: List<MedicationEntity>)

    @Query("UPDATE medications SET deleted = 1, updatedAt = :now, syncState = :syncState WHERE id = :id")
    suspend fun softDelete(id: String, now: Long, syncState: String = SyncState.PENDING)

    @Query("UPDATE medications SET syncState = :newState WHERE syncState = :oldState")
    suspend fun updateSyncState(oldState: String, newState: String)
}
