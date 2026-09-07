package jp.yosshy12.fukuyakukanri

import android.app.Application
import jp.yosshy12.fukuyakukanri.backup.BackupScheduler

class MedicationApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        BackupScheduler.schedulePeriodic(this)
    }
}
