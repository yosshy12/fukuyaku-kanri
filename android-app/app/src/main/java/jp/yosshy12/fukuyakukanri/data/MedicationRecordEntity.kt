package jp.yosshy12.fukuyakukanri.data

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

@Entity(
    tableName = "medication_records",
    indices = [Index("medicationAt"), Index("syncState")],
)
data class MedicationRecordEntity(
    @PrimaryKey val id: String,
    val medicationAt: Long,
    val period: String,
    val medicineNames: String,
    val medicineId: String? = null,
    val createdAt: Long,
    val updatedAt: Long,
    val deleted: Boolean = false,
    val syncState: String = SyncState.PENDING,
)
