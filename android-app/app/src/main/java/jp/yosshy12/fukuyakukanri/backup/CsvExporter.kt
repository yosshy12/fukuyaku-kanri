package jp.yosshy12.fukuyakukanri.backup

import jp.yosshy12.fukuyakukanri.data.AppDatabase
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class CsvExporter(private val database: AppDatabase) {
    suspend fun export(destination: File) {
        val records = database.recordDao().allIncludingDeleted()
        destination.outputStream().buffered().use { output ->
            output.write(byteArrayOf(0xEF.toByte(), 0xBB.toByte(), 0xBF.toByte()))
            output.writer(Charsets.UTF_8).use { writer ->
                writer.appendLine("ID,服薬日時,区分,薬名,登録日時,更新日時,削除状態,同期状態")
                records.forEach { record ->
                    writer.appendLine(
                        listOf(
                            record.id,
                            format(record.medicationAt),
                            record.period,
                            record.medicineNames,
                            format(record.createdAt),
                            format(record.updatedAt),
                            if (record.deleted) "削除" else "有効",
                            record.syncState,
                        ).joinToString(",") { csv(it) },
                    )
                }
            }
        }
    }

    private fun csv(value: String): String = "\"${value.replace("\"", "\"\"")}\""
    private fun format(value: Long): String = FORMAT.get().format(Date(value))

    companion object {
        private val FORMAT = ThreadLocal.withInitial { SimpleDateFormat("yyyy/MM/dd HH:mm:ss", Locale.JAPAN) }
    }
}
