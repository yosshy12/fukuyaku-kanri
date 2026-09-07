package jp.yosshy12.fukuyakukanri

import android.app.DatePickerDialog
import android.app.TimePickerDialog
import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.LinearLayout
import android.widget.RadioButton
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import jp.yosshy12.fukuyakukanri.data.AppDatabase
import jp.yosshy12.fukuyakukanri.data.BackupStatusEntity
import jp.yosshy12.fukuyakukanri.data.MedicationEntity
import jp.yosshy12.fukuyakukanri.data.MedicationRecordEntity
import jp.yosshy12.fukuyakukanri.data.MedicationRepository
import jp.yosshy12.fukuyakukanri.databinding.ActivityMainBinding
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

class MainActivity : AppCompatActivity() {
    private lateinit var binding: ActivityMainBinding
    private lateinit var repository: MedicationRepository
    private var medicines: List<MedicationEntity> = emptyList()
    private var selectedAsNeededId: String? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)
        repository = MedicationRepository(this, AppDatabase.get(this))

        setupTabs()
        setupDateButton(binding.recordDateButton)
        setupDateButton(binding.asNeededDateButton)
        setOpenDefaults()
        setupRecordActions()
        setupMedicineActions()

        binding.settingsButton.setOnClickListener { startActivity(Intent(this, SettingsActivity::class.java)) }
        binding.backupSummary.setOnClickListener { startActivity(Intent(this, SettingsActivity::class.java)) }

        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                launch { repository.medicines.collect { renderMedicines(it) } }
                launch { repository.records.collect { renderHistory(it) } }
                launch { repository.backupStatus.collect { renderBackupStatus(it) } }
            }
        }
    }

    override fun onResume() {
        super.onResume()
        setOpenDefaults()
    }

    private fun setupTabs() {
        binding.viewTabs.addOnButtonCheckedListener { _, checkedId, isChecked ->
            if (!isChecked) return@addOnButtonCheckedListener
            binding.recordView.visibility = if (checkedId == binding.recordTab.id) View.VISIBLE else View.GONE
            binding.asNeededView.visibility = if (checkedId == binding.asNeededTab.id) View.VISIBLE else View.GONE
            binding.medicineView.visibility = if (checkedId == binding.medicineTab.id) View.VISIBLE else View.GONE
        }
    }

    private fun setOpenDefaults() {
        val now = System.currentTimeMillis()
        binding.recordDateButton.tag = now
        binding.asNeededDateButton.tag = now
        updateDateButton(binding.recordDateButton)
        updateDateButton(binding.asNeededDateButton)
        when (Calendar.getInstance().get(Calendar.HOUR_OF_DAY)) {
            in 0..4 -> binding.sleepButton.isChecked = true
            in 5..11 -> binding.morningButton.isChecked = true
            in 12..16 -> binding.noonButton.isChecked = true
            else -> binding.nightButton.isChecked = true
        }
    }

    private fun setupDateButton(button: Button) {
        button.setOnClickListener {
            val calendar = Calendar.getInstance().apply { timeInMillis = button.tag as? Long ?: System.currentTimeMillis() }
            DatePickerDialog(
                this,
                { _, year, month, day ->
                    calendar.set(year, month, day)
                    TimePickerDialog(
                        this,
                        { _, hour, minute ->
                            calendar.set(Calendar.HOUR_OF_DAY, hour)
                            calendar.set(Calendar.MINUTE, minute)
                            calendar.set(Calendar.SECOND, 0)
                            button.tag = calendar.timeInMillis
                            updateDateButton(button)
                        },
                        calendar.get(Calendar.HOUR_OF_DAY),
                        calendar.get(Calendar.MINUTE),
                        true,
                    ).show()
                },
                calendar.get(Calendar.YEAR),
                calendar.get(Calendar.MONTH),
                calendar.get(Calendar.DAY_OF_MONTH),
            ).show()
        }
    }

    private fun updateDateButton(button: Button) {
        button.text = DATE_FORMAT.format(Date(button.tag as Long))
    }

    private fun setupRecordActions() {
        binding.saveRecordButton.setOnClickListener {
            val period = findViewById<RadioButton>(binding.periodGroup.checkedRadioButtonId)?.text?.toString() ?: return@setOnClickListener
            lifecycleScope.launch {
                repository.addRecord(binding.recordDateButton.tag as Long, period)
                Toast.makeText(this@MainActivity, "端末に記録しました", Toast.LENGTH_SHORT).show()
                setOpenDefaults()
            }
        }
        binding.saveAsNeededButton.setOnClickListener {
            val selected = medicines.firstOrNull { it.id == selectedAsNeededId } ?: return@setOnClickListener
            lifecycleScope.launch {
                repository.addRecord(binding.asNeededDateButton.tag as Long, "必要時", selected)
                selectedAsNeededId = null
                renderAsNeededChoices()
                Toast.makeText(this@MainActivity, "端末に記録しました", Toast.LENGTH_SHORT).show()
                binding.asNeededDateButton.tag = System.currentTimeMillis()
                updateDateButton(binding.asNeededDateButton)
            }
        }
    }

    private fun setupMedicineActions() {
        val timings = listOf("朝", "昼", "夜", "寝る前", "必要時")
        binding.medicineTimingSpinner.adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, timings)
        binding.addMedicineButton.setOnClickListener {
            val name = binding.medicineNameInput.text?.toString()?.trim().orEmpty()
            if (name.isEmpty()) {
                binding.medicineNameInput.error = "薬の名前を入力してください"
                return@setOnClickListener
            }
            lifecycleScope.launch {
                repository.addMedicine(name, binding.medicineTimingSpinner.selectedItem.toString())
                binding.medicineNameInput.text?.clear()
                Toast.makeText(this@MainActivity, "薬を追加しました", Toast.LENGTH_SHORT).show()
            }
        }
    }

    private fun renderMedicines(values: List<MedicationEntity>) {
        medicines = values
        binding.medicineList.removeAllViews()
        if (values.isEmpty()) binding.medicineList.addView(note("登録中の薬はありません"))
        values.forEach { medicine ->
            val row = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                background = ContextCompat.getDrawable(this@MainActivity, R.drawable.history_background)
                layoutParams = spacedParams()
            }
            row.addView(TextView(this).apply {
                text = "${medicine.name}\n${medicine.timing}"
                setTextColor(ContextCompat.getColor(this@MainActivity, R.color.ink))
                textSize = 16f
                layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
            })
            row.addView(Button(this).apply {
                text = "終了"
                setOnClickListener { lifecycleScope.launch { repository.deactivateMedicine(medicine.id) } }
            })
            binding.medicineList.addView(row)
        }
        renderAsNeededChoices()
    }

    private fun renderAsNeededChoices() {
        binding.asNeededMedicineGroup.removeAllViews()
        val choices = medicines.filter { it.timing == "必要時" }
        if (choices.none { it.id == selectedAsNeededId }) selectedAsNeededId = null
        choices.forEach { medicine ->
            binding.asNeededMedicineGroup.addView(RadioButton(this).apply {
                id = View.generateViewId()
                tag = medicine.id
                text = medicine.name
                textSize = 17f
                minHeight = dp(54)
                isChecked = medicine.id == selectedAsNeededId
                setOnClickListener {
                    selectedAsNeededId = medicine.id
                    binding.saveAsNeededButton.isEnabled = true
                }
            })
        }
        if (choices.isEmpty()) binding.asNeededMedicineGroup.addView(note("薬リストで必要時の薬を登録してください"))
        binding.saveAsNeededButton.isEnabled = selectedAsNeededId != null
    }

    private fun renderHistory(values: List<MedicationRecordEntity>) {
        renderHistoryInto(binding.recordHistory, values.filter { it.period != "必要時" })
        renderHistoryInto(binding.asNeededHistory, values.filter { it.period == "必要時" })
    }

    private fun renderHistoryInto(container: LinearLayout, records: List<MedicationRecordEntity>) {
        container.removeAllViews()
        if (records.isEmpty()) {
            container.addView(note("まだ記録はありません"))
            return
        }
        records.take(20).forEach { record ->
            container.addView(TextView(this).apply {
                text = buildString {
                    append(record.period).append("　").append(DATE_FORMAT.format(Date(record.medicationAt)))
                    if (record.medicineNames.isNotBlank()) append("\n").append(record.medicineNames)
                }
                setTextColor(ContextCompat.getColor(this@MainActivity, R.color.ink))
                textSize = 16f
                background = ContextCompat.getDrawable(this@MainActivity, R.drawable.history_background)
                layoutParams = spacedParams()
            })
        }
    }

    private fun renderBackupStatus(status: BackupStatusEntity?) {
        binding.backupSummary.text = when (status?.result) {
            "成功" -> "Drive保存済み：${SHORT_FORMAT.format(Date(status.succeededAt ?: 0))}"
            "失敗" -> "端末に保存済み・Drive保存失敗"
            "実行中" -> "端末に保存済み・バックアップ中"
            else -> "端末内のSQLiteに保存"
        }
    }

    private fun note(value: String) = TextView(this).apply {
        text = value
        setTextColor(ContextCompat.getColor(this@MainActivity, R.color.muted))
        setPadding(dp(8), dp(14), dp(8), dp(14))
    }

    private fun spacedParams() = LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT,
        LinearLayout.LayoutParams.WRAP_CONTENT,
    ).apply { bottomMargin = dp(8) }

    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()

    companion object {
        private val DATE_FORMAT = SimpleDateFormat("yyyy/MM/dd HH:mm", Locale.JAPAN)
        private val SHORT_FORMAT = SimpleDateFormat("MM/dd HH:mm", Locale.JAPAN)
    }
}
