var RECORD_SHEET = "服薬記録";
var MEDICINE_SHEET = "薬リスト";
var PERIODS = ["朝", "昼", "夜", "寝る前", "必要時"];

function setup() {
  var properties = PropertiesService.getScriptProperties();
  var key = properties.getProperty("ACCESS_KEY");
  if (!key) {
    key = Utilities.getUuid().replace(/-/g, "");
    properties.setProperty("ACCESS_KEY", key);
  }
  console.log("接続キー: " + key);
  return key;
}

function doGet(e) {
  try {
    authenticate_(e);
    if ((e.parameter.action || "bootstrap") !== "bootstrap") {
      throw new Error("未対応の操作です");
    }
    return output_(bootstrap_(e.parameter.recordIds), e.parameter.callback);
  } catch (error) {
    return output_({ ok: false, message: error.message }, e && e.parameter && e.parameter.callback);
  }
}

function doPost(e) {
  try {
    authenticate_(e);
    var action = e.parameter.action;
    var result;
    var lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      if (action === "addRecord") result = addRecord_(e.parameter);
      else if (action === "addMedicine") result = addMedicine_(e.parameter);
      else if (action === "deactivateMedicine") result = deactivateMedicine_(e.parameter);
      else throw new Error("未対応の操作です");
    } finally {
      lock.releaseLock();
    }
    return output_({ ok: true, result: result });
  } catch (error) {
    return output_({ ok: false, message: error.message });
  }
}

function authenticate_(e) {
  var savedKey = PropertiesService.getScriptProperties().getProperty("ACCESS_KEY");
  if (!savedKey) throw new Error("最初にsetup関数を実行してください");
  if (!e || !e.parameter || e.parameter.key !== savedKey) throw new Error("接続キーが正しくありません");
}

function bootstrap_(requestedRecordIdsValue) {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var medicineSheet = requiredSheet_(MEDICINE_SHEET);
  var recordSheet = requiredSheet_(RECORD_SHEET);
  var medicines = [];
  var history = [];

  var medicineRows = dataRows_(medicineSheet, 8);
  if (medicineRows.length) {
    medicines = medicineRows
      .filter(function (row) { return row[0] && row[3] === true; })
      .map(function (row) {
        return {
          id: String(row[0]),
          name: String(row[1]),
          timing: String(row[2]),
          sortOrder: Number(row[4]) || 0
        };
      })
      .sort(function (a, b) { return a.sortOrder - b.sortOrder; });
  }

  var recordRows = dataRows_(recordSheet, 6);
  if (recordRows.length) {
    var historyEntries = recordRows
      .filter(function (row) { return row[0]; })
      .map(function (row) {
        return {
          id: String(row[0]),
          date: formatDate_(row[1], "yyyy/MM/dd HH:mm"),
          period: String(row[2]),
          medicines: String(row[3] || ""),
          sortTime: dateTime_(row[1])
        };
      })
      .sort(function (a, b) { return b.sortTime - a.sortTime; });

    history = historyEntries.slice(0, 100);
    var requestedIds = String(requestedRecordIdsValue || "")
      .split(",")
      .filter(function (id) { return id; })
      .slice(0, 10);
    var includedIds = {};
    history.forEach(function (record) { includedIds[record.id] = true; });
    historyEntries.forEach(function (record) {
      if (requestedIds.indexOf(record.id) !== -1 && !includedIds[record.id]) {
        history.push(record);
        includedIds[record.id] = true;
      }
    });
    history.forEach(function (record) { delete record.sortTime; });
  }

  return {
    ok: true,
    profile: spreadsheet.getName(),
    medicines: medicines,
    history: history
  };
}

function addRecord_(parameters) {
  var id = String(parameters.id || "").trim() || Utilities.getUuid();
  if (id.length > 100 || !/^[0-9A-Za-z_-]+$/.test(id)) {
    throw new Error("記録IDが正しくありません");
  }

  var recordSheet = requiredSheet_(RECORD_SHEET);
  var existingRows = dataRows_(recordSheet, 1);
  var alreadySaved = existingRows.some(function (row) {
    return String(row[0]) === id;
  });
  if (alreadySaved) return id;

  var period = validatePeriod_(parameters.period);
  var medicationDate = parseLocalDate_(parameters.date);
  var registeredDate = parameters.registeredAt
    ? parseLocalDate_(parameters.registeredAt)
    : new Date();
  var selectedMedicineId = String(parameters.medicineId || "");
  var medicineSheet = requiredSheet_(MEDICINE_SHEET);
  var names = [];

  var medicineRows = dataRows_(medicineSheet, 8);
  if (medicineRows.length) {
    if (period === "必要時" && selectedMedicineId) {
      names = medicineRows
        .filter(function (row) {
          return String(row[0]) === selectedMedicineId && row[2] === period && row[3] === true;
        })
        .map(function (row) { return String(row[1]); });
    } else {
      names = medicineRows
        .filter(function (row) { return row[0] && row[2] === period && row[3] === true; })
        .sort(function (a, b) { return (Number(a[4]) || 0) - (Number(b[4]) || 0); })
        .map(function (row) { return String(row[1]); });
    }
  }
  if (period === "必要時" && selectedMedicineId && !names.length) {
    throw new Error("選択した頓服薬が見つかりません");
  }

  recordSheet.appendRow([
    id,
    medicationDate,
    period,
    names.join("、"),
    registeredDate,
    ""
  ]);
  SpreadsheetApp.flush();
  return id;
}

function addMedicine_(parameters) {
  var name = String(parameters.name || "").trim();
  if (!name || name.length > 100) throw new Error("薬名を正しく入力してください");
  var timing = validatePeriod_(parameters.timing);
  var sheet = requiredSheet_(MEDICINE_SHEET);
  var nextOrder = 1;

  var rows = dataRows_(sheet, 8);
  if (rows.length) {
    nextOrder = rows.reduce(function (max, row) {
      return Math.max(max, Number(row[4]) || 0);
    }, 0) + 1;
  }

  var id = Utilities.getUuid();
  sheet.getRange(rows.length + 2, 1, 1, 8)
    .setValues([[id, name, timing, true, nextOrder, new Date(), "", ""]]);
  SpreadsheetApp.flush();
  return id;
}

function deactivateMedicine_(parameters) {
  var id = String(parameters.id || "");
  if (!id) throw new Error("薬IDがありません");
  var sheet = requiredSheet_(MEDICINE_SHEET);
  var rows = dataRows_(sheet, 8);
  if (!rows.length) throw new Error("対象の薬が見つかりません");

  for (var index = 0; index < rows.length; index += 1) {
    if (String(rows[index][0]) === id) {
      var row = index + 2;
      sheet.getRange(row, 4).setValue(false);
      sheet.getRange(row, 7).setValue(new Date());
      SpreadsheetApp.flush();
      return id;
    }
  }
  throw new Error("対象の薬が見つかりません");
}

function requiredSheet_(name) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sheet) throw new Error(name + "シートが見つかりません");
  return sheet;
}

function dataRows_(sheet, width) {
  var maxDataRows = sheet.getMaxRows() - 1;
  if (maxDataRows <= 0) return [];
  var ids = sheet.getRange(2, 1, maxDataRows, 1).getValues();
  var lastIndex = -1;
  for (var index = ids.length - 1; index >= 0; index -= 1) {
    if (ids[index][0] !== "") {
      lastIndex = index;
      break;
    }
  }
  if (lastIndex === -1) return [];
  return sheet.getRange(2, 1, lastIndex + 1, width).getValues();
}

function validatePeriod_(value) {
  var period = String(value || "");
  if (PERIODS.indexOf(period) === -1) throw new Error("区分が正しくありません");
  return period;
}

function parseLocalDate_(value) {
  var match = String(value || "").match(/^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2})$/);
  if (!match) throw new Error("服薬日時が正しくありません");
  return new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    0
  );
}

function dateTime_(value) {
  return value instanceof Date ? value.getTime() : 0;
}

function formatDate_(value, pattern) {
  if (!(value instanceof Date)) return String(value || "");
  return Utilities.formatDate(value, "Asia/Tokyo", pattern);
}

function output_(data, callback) {
  var json = JSON.stringify(data);
  var safeCallback = String(callback || "");
  if (safeCallback && /^[A-Za-z_$][0-9A-Za-z_$]*$/.test(safeCallback)) {
    return ContentService.createTextOutput(safeCallback + "(" + json + ");")
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}
