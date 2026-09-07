package jp.yosshy12.fukuyakukanri.data

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase

@Database(
    entities = [MedicationEntity::class, MedicationRecordEntity::class, BackupStatusEntity::class],
    version = 1,
    exportSchema = true,
)
abstract class AppDatabase : RoomDatabase() {
    abstract fun medicationDao(): MedicationDao
    abstract fun recordDao(): MedicationRecordDao
    abstract fun backupStatusDao(): BackupStatusDao

    companion object {
        const val NAME = "fukuyaku-kanri.db"

        @Volatile private var instance: AppDatabase? = null

        fun get(context: Context): AppDatabase = instance ?: synchronized(this) {
            instance ?: Room.databaseBuilder(
                context.applicationContext,
                AppDatabase::class.java,
                NAME,
            ).build().also { instance = it }
        }
    }
}
