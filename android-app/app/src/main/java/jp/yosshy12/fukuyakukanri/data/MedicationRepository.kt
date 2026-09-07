package jp.yosshy12.fukuyakukanri.data

import android.content.Context
import jp.yosshy12.fukuyakukanri.backup.BackupScheduler
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.util.UUID

class MedicationRepository(private val context: Context, private val database: AppDatabase) {
    val medicines = database.medicationDao().observeActive()
    val records = database.recordDao().observeRecent()
    val backupStatus = database.backupStatusDao().observe()

    suspend fun addMedicine(name: String, timing: String) = databaseMutex.withLock {
        val now = System.currentTimeMillis()
        database.medicationDao().upsert(
            MedicationEntity(
                id = UUID.randomUUID().toString(),
                name = name.trim(),
                timing = timing,
                sortOrder = database.medicationDao().nextSortOrder(),
                createdAt = now,
                updatedAt = now,
            ),
        )
        BackupScheduler.enqueueSoon(context)
    }

    suspend fun deactivateMedicine(id: String) = databaseMutex.withLock {
        database.medicationDao().softDelete(id, System.currentTimeMillis())
        BackupScheduler.enqueueSoon(context)
    }

    suspend fun addRecord(medicationAt: Long, period: String, selectedMedicine: MedicationEntity? = null) =
        databaseMutex.withLock {
            val now = System.currentTimeMillis()
            val names = selectedMedicine?.name ?: database.medicationDao()
                .activeForTiming(period)
                .joinToString("、") { it.name }
            database.recordDao().upsert(
                MedicationRecordEntity(
                    id = UUID.randomUUID().toString(),
                    medicationAt = medicationAt,
                    period = period,
                    medicineNames = names,
                    medicineId = selectedMedicine?.id,
                    createdAt = now,
                    updatedAt = now,
                ),
            )
            BackupScheduler.enqueueSoon(context)
        }

    companion object {
        val databaseMutex = Mutex()
    }
}
