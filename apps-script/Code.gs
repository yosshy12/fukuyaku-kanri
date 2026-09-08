var RECORD_SHEET = "服薬記録";
var MEDICINE_SHEET = "薬リスト";
var SYNC_LOG_SHEET = "_アプリ同期履歴";
var CONFLICT_SHEET = "_アプリ競合履歴";
var PERIODS = ["朝", "昼", "夜", "寝る前", "必要時"];
var SYNC_PAGE_SIZE = 200;

function setup() {
  var properties = PropertiesService.getScriptProperties();
  var key = properties.getProperty("ACCESS_KEY");
  if (!key) {
    key = Utilities.getUuid().replace(/-/g, "");
    properties.setProperty("ACCESS_KEY", key);
  }
  getSyncLogSheet_(true);
  console.log("接続キー: " + key);
  return key;
}

function doGet(e) {
  try {
    authenticate_(e);
    var action = e.parameter.action || "bootstrap";
    var result;
    if (action === "bootstrap") {
      if (e.parameter.prepareMigration === "1") {
        backupBeforeMigration_();
        ensureExistingIds_();
      }
      result = bootstrap_(e.parameter.recordIds, e.parameter.includeAll === "1");
    } else if (action === "pullChanges") {
      result = pullChanges_(e.parameter.cursor);
    } else if (action === "ping") {
      result = {
        ok: true,
        profile: SpreadsheetApp.getActiveSpreadsheet().getName(),
        serverTime: Date.now()
      };
    } else {
      throw new Error("未対応の操作です");
    }
    return output_(result, e.parameter.callback);
  } catch (error) {
    return output_({ ok: false, message: error.message }, e && e.parameter && e.parameter.callback);
  }
}

function doPost(e) {
  try {
    authenticate_(e);
    var actionName = e.parameter.action;
    var result;
    var lock = LockService.getScriptLock();
    lock.waitLock(15000);
    try {
      if (actionName === "applyChange") result = applyChange_(e.parameter);
      else if (actionName === "addRecord") result = addRecord_(e.parameter);
      else if (actionName === "addMedicine") result = addMedicine_(e.parameter);
      else if (actionName === "deactivateMedicine") result = deactivateMedicine_(e.parameter);
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

function bootstrap_(requestedRecordIdsValue, includeAll) {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var medicineSheet = requiredSheet_(MEDICINE_SHEET);
  var recordSheet = requiredSheet_(RECORD_SHEET);
  var syncStates = latestSyncStates_();
  var medicines = [];
  var history = [];

  var medicineRows = dataRows_(medicineSheet, 8);
  if (medicineRows.length) {
    medicines = medicineRows
      .filter(function (row) {
        var state = syncStates[entityKey_("medicine", row[0])];
        return row[0] && row[3] === true && !(state && state.deletedAt);
      })
      .map(function (row) {
        var state = syncStates[entityKey_("medicine", row[0])] || {};
        return medicineFromRow_(row, state.version || 0, state.deletedAt || null);
      })
      .sort(function (a, b) { return a.sortOrder - b.sortOrder; });
  }

  var recordRows = dataRows_(recordSheet, 6);
  if (recordRows.length) {
    var historyEntries = recordRows
      .filter(function (row) {
        var state = syncStates[entityKey_("record", row[0])];
        return row[0] && !(state && state.deletedAt);
      })
      .map(function (row) {
        var state = syncStates[entityKey_("record", row[0])] || {};
        var record = recordFromRow_(row, state.version || 0, state.deletedAt || null);
        record.sortTime = dateTime_(row[1]);
        return record;
      })
      .sort(function (a, b) { return b.sortTime - a.sortTime; });

    history = includeAll ? historyEntries : historyEntries.slice(0, 100);
    var requestedIds = String(requestedRecordIdsValue || "").split(",").filter(Boolean).slice(0, 10);
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
    history: history,
    counts: { medicines: medicines.length, records: historyEntriesCount_(recordRows, syncStates) },
    syncCursor: syncCursor_(),
    serverTime: Date.now()
  };
}

function historyEntriesCount_(rows, states) {
  return rows.filter(function (row) {
    var state = states[entityKey_("record", row[0])];
    return row[0] && !(state && state.deletedAt);
  }).length;
}

function pullChanges_(cursorValue) {
  var sheet = getSyncLogSheet_(true);
  var cursor = Math.max(1, Number(cursorValue) || 1);
  var lastRow = sheet.getLastRow();
  var startRow = Math.max(2, cursor + 1);
  if (startRow > lastRow) {
    return { ok: true, changes: [], nextCursor: lastRow, hasMore: false, serverTime: Date.now() };
  }
  var count = Math.min(SYNC_PAGE_SIZE, lastRow - startRow + 1);
  var rows = sheet.getRange(startRow, 1, count, 10).getValues();
  var changes = rows.map(function (row) {
    return {
      changeId: String(row[0]),
      entityType: String(row[1]),
      entityId: String(row[2]),
      version: Number(row[3]) || 0,
      updatedAt: dateTime_(row[4]),
      operation: String(row[5]),
      entity: parseJson_(row[6], null),
      conflictPayload: parseJson_(row[7], null),
      deviceId: String(row[8] || "")
    };
  });
  var nextCursor = startRow + count - 1;
  return {
    ok: true,
    changes: changes,
    nextCursor: nextCursor,
    hasMore: nextCursor < lastRow,
    serverTime: Date.now()
  };
}

function applyChange_(parameters) {
  var changeId = validateId_(parameters.changeId, "変更ID");
  var entityType = String(parameters.entityType || "");
  if (["record", "medicine"].indexOf(entityType) === -1) throw new Error("データ種別が正しくありません");
  var entityId = validateId_(parameters.entityId, "データID");
  var operation = parameters.operation === "delete" ? "delete" : "upsert";
  var baseVersion = Math.max(0, Number(parameters.baseVersion) || 0);
  var deviceId = String(parameters.deviceId || "").slice(0, 100);
  var entity = parseJson_(parameters.entity, null);
  if (!entity || String(entity.id) !== entityId) throw new Error("同期データが正しくありません");

  var logSheet = getSyncLogSheet_(true);
  var duplicate = logSheet.getRange(2, 1, Math.max(1, logSheet.getLastRow() - 1), 1)
    .createTextFinder(changeId).matchEntireCell(true).findNext();
  if (duplicate) return { changeId: changeId, duplicate: true };

  var currentState = latestSyncState_(entityType, entityId);
  var currentVersion = currentState ? currentState.version : 0;
  if (baseVersion < currentVersion) {
    var serverEntity = readEntity_(entityType, entityId, currentVersion, currentState.deletedAt)
      || currentState.entity;
    appendConflict_(changeId, entityType, entityId, baseVersion, currentVersion, entity, serverEntity, deviceId);
    appendSyncLog_(changeId, entityType, entityId, currentVersion, "conflict", serverEntity, entity, deviceId, "app");
    return { changeId: changeId, conflict: true };
  }

  var nextVersion = currentVersion + 1;
  var updatedAt = Number(entity.updatedAt) || Date.now();
  var deletedAt = operation === "delete" ? (Number(entity.deletedAt) || updatedAt) : null;
  var normalized = entityType === "record"
    ? normalizeRecordEntity_(entity, nextVersion, updatedAt, deletedAt)
    : normalizeMedicineEntity_(entity, nextVersion, updatedAt, deletedAt);
  writeEntity_(entityType, normalized);
  appendSyncLog_(changeId, entityType, entityId, nextVersion, operation, normalized, null, deviceId, "app");
  SpreadsheetApp.flush();
  return { changeId: changeId, version: nextVersion };
}

function normalizeRecordEntity_(entity, version, updatedAt, deletedAt) {
  return {
    id: validateId_(entity.id, "記録ID"),
    date: formatDate_(parseLocalDate_(entity.date), "yyyy/MM/dd HH:mm"),
    period: validatePeriod_(entity.period),
    medicines: String(entity.medicines || "").slice(0, 500),
    medicineId: String(entity.medicineId || "").slice(0, 100),
    createdAt: Number(entity.createdAt) || updatedAt,
    updatedAt: updatedAt,
    deletedAt: deletedAt,
    version: version
  };
}

function normalizeMedicineEntity_(entity, version, updatedAt, deletedAt) {
  var name = String(entity.name || "").trim();
  if (!name || name.length > 100) throw new Error("薬名を正しく入力してください");
  return {
    id: validateId_(entity.id, "薬ID"),
    name: name,
    timing: validatePeriod_(entity.timing),
    sortOrder: Math.max(0, Number(entity.sortOrder) || 0),
    createdAt: Number(entity.createdAt) || updatedAt,
    updatedAt: updatedAt,
    deletedAt: deletedAt,
    version: version
  };
}

function writeEntity_(entityType, entity) {
  if (entityType === "record") {
    var recordSheet = requiredSheet_(RECORD_SHEET);
    var recordRow = findRowById_(recordSheet, entity.id);
    if (!recordRow) {
      recordSheet.appendRow([
        entity.id,
        parseLocalDate_(entity.date),
        entity.period,
        entity.medicines,
        new Date(entity.createdAt),
        ""
      ]);
    } else if (!entity.deletedAt) {
      recordSheet.getRange(recordRow, 1, 1, 5).setValues([[
        entity.id,
        parseLocalDate_(entity.date),
        entity.period,
        entity.medicines,
        new Date(entity.createdAt)
      ]]);
    }
    return;
  }

  var medicineSheet = requiredSheet_(MEDICINE_SHEET);
  var medicineRow = findRowById_(medicineSheet, entity.id);
  if (!medicineRow) {
    medicineSheet.appendRow([
      entity.id,
      entity.name,
      entity.timing,
      !entity.deletedAt,
      entity.sortOrder,
      new Date(entity.createdAt),
      new Date(entity.updatedAt),
      ""
    ]);
  } else {
    medicineSheet.getRange(medicineRow, 1, 1, 7).setValues([[
      entity.id,
      entity.name,
      entity.timing,
      !entity.deletedAt,
      entity.sortOrder,
      new Date(entity.createdAt),
      new Date(entity.updatedAt)
    ]]);
  }
}

function readEntity_(entityType, id, version, deletedAt) {
  var sheet = requiredSheet_(entityType === "record" ? RECORD_SHEET : MEDICINE_SHEET);
  var row = findRowById_(sheet, id);
  if (!row) return null;
  var values = sheet.getRange(row, 1, 1, entityType === "record" ? 6 : 8).getValues()[0];
  return entityType === "record"
    ? recordFromRow_(values, version, deletedAt)
    : medicineFromRow_(values, version, deletedAt);
}

function recordFromRow_(row, version, deletedAt) {
  return {
    id: String(row[0]),
    date: formatDate_(row[1], "yyyy/MM/dd HH:mm"),
    period: String(row[2]),
    medicines: String(row[3] || ""),
    medicineId: "",
    createdAt: dateTime_(row[4]) || dateTime_(row[1]),
    updatedAt: latestDate_(dateTime_(row[4]), dateTime_(row[1])),
    deletedAt: deletedAt || null,
    version: Number(version) || 0
  };
}

function medicineFromRow_(row, version, deletedAt) {
  return {
    id: String(row[0]),
    name: String(row[1]),
    timing: String(row[2]),
    sortOrder: Number(row[4]) || 0,
    createdAt: dateTime_(row[5]) || Date.now(),
    updatedAt: dateTime_(row[6]) || dateTime_(row[5]) || Date.now(),
    deletedAt: deletedAt || (row[3] === false ? (dateTime_(row[6]) || Date.now()) : null),
    version: Number(version) || 0
  };
}

function latestDate_(first, second) {
  return Math.max(Number(first) || 0, Number(second) || 0) || Date.now();
}

function latestSyncStates_() {
  var sheet = getSyncLogSheet_(false);
  var states = {};
  if (!sheet || sheet.getLastRow() < 2) return states;
  var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 8).getValues();
  rows.forEach(function (row) {
    var type = String(row[1]);
    var id = String(row[2]);
    var entity = parseJson_(row[6], {});
    states[entityKey_(type, id)] = {
      version: Number(row[3]) || 0,
      deletedAt: entity && entity.deletedAt ? Number(entity.deletedAt) : null,
      entity: entity
    };
  });
  return states;
}

function latestSyncState_(entityType, entityId) {
  return latestSyncStates_()[entityKey_(entityType, entityId)] || null;
}

function entityKey_(entityType, entityId) {
  return entityType + ":" + String(entityId);
}

function appendSyncLog_(changeId, entityType, entityId, version, operation, entity, conflict, deviceId, source) {
  getSyncLogSheet_(true).appendRow([
    changeId,
    entityType,
    entityId,
    version,
    new Date(),
    operation,
    JSON.stringify(entity),
    conflict ? JSON.stringify(conflict) : "",
    deviceId || "",
    source || ""
  ]);
}

function appendConflict_(changeId, entityType, entityId, baseVersion, currentVersion, localEntity, serverEntity, deviceId) {
  var sheet = getConflictSheet_();
  sheet.appendRow([
    new Date(), changeId, entityType, entityId, baseVersion, currentVersion,
    JSON.stringify(localEntity), JSON.stringify(serverEntity), deviceId || ""
  ]);
}

function getSyncLogSheet_(create) {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = spreadsheet.getSheetByName(SYNC_LOG_SHEET);
  if (!sheet && create) {
    sheet = spreadsheet.insertSheet(SYNC_LOG_SHEET);
    sheet.getRange(1, 1, 1, 10).setValues([[
      "変更ID", "種別", "データID", "バージョン", "更新日時",
      "操作", "データ", "競合データ", "端末ID", "更新元"
    ]]);
    sheet.setFrozenRows(1);
    sheet.hideSheet();
  }
  return sheet;
}

function getConflictSheet_() {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = spreadsheet.getSheetByName(CONFLICT_SHEET);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(CONFLICT_SHEET);
    sheet.getRange(1, 1, 1, 9).setValues([[
      "発生日時", "変更ID", "種別", "データID", "端末側バージョン",
      "Google側バージョン", "端末側コピー", "Google側コピー", "端末ID"
    ]]);
    sheet.setFrozenRows(1);
    sheet.hideSheet();
  }
  return sheet;
}

function syncCursor_() {
  var sheet = getSyncLogSheet_(false);
  return sheet ? sheet.getLastRow() : 1;
}

function backupBeforeMigration_() {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var propertyName = "LOCAL_FIRST_BACKUP_" + spreadsheet.getId();
  var properties = PropertiesService.getScriptProperties();
  if (properties.getProperty(propertyName)) return;
  var stamp = Utilities.formatDate(new Date(), "Asia/Tokyo", "yyyyMMdd_HHmmss");
  [RECORD_SHEET, MEDICINE_SHEET].forEach(function (name) {
    var copy = requiredSheet_(name).copyTo(spreadsheet);
    copy.setName(uniqueSheetName_(spreadsheet, name + "_移行前_" + stamp));
    copy.hideSheet();
  });
  properties.setProperty(propertyName, new Date().toISOString());
}

function uniqueSheetName_(spreadsheet, baseName) {
  var name = baseName.slice(0, 95);
  var suffix = 1;
  while (spreadsheet.getSheetByName(name)) {
    name = (baseName.slice(0, 90) + "_" + suffix).slice(0, 99);
    suffix += 1;
  }
  return name;
}

function ensureExistingIds_() {
  [
    { name: RECORD_SHEET, width: 6 },
    { name: MEDICINE_SHEET, width: 8 }
  ].forEach(function (definition) {
    var sheet = requiredSheet_(definition.name);
    if (sheet.getLastRow() < 2) return;
    var rowCount = sheet.getLastRow() - 1;
    var rows = sheet.getRange(2, 1, rowCount, definition.width).getValues();
    var ids = sheet.getRange(2, 1, rowCount, 1).getValues();
    var changed = false;
    rows.forEach(function (row, index) {
      var hasData = row.slice(1).some(function (value) { return value !== ""; });
      if (!row[0] && hasData) {
        ids[index][0] = Utilities.getUuid();
        changed = true;
      }
    });
    if (changed) sheet.getRange(2, 1, rowCount, 1).setValues(ids);
  });
}

function onEdit(e) {
  try {
    if (!e || !e.range || e.range.getRow() < 2) return;
    var sheet = e.range.getSheet();
    var name = sheet.getName();
    if ([RECORD_SHEET, MEDICINE_SHEET].indexOf(name) === -1) return;
    var entityType = name === RECORD_SHEET ? "record" : "medicine";
    var id = String(sheet.getRange(e.range.getRow(), 1).getValue() || (e.range.getColumn() === 1 ? e.oldValue : ""));
    if (!id) return;
    var current = latestSyncState_(entityType, id);
    var nextVersion = (current ? current.version : 0) + 1;
    var deletedAt = null;
    var operation = "upsert";
    if (e.range.getColumn() === 1 && !e.value) {
      deletedAt = Date.now();
      operation = "delete";
    }
    var width = entityType === "record" ? 6 : 8;
    var rowValues = sheet.getRange(e.range.getRow(), 1, 1, width).getValues()[0];
    rowValues[0] = id;
    var entity = entityType === "record"
      ? recordFromRow_(rowValues, nextVersion, deletedAt)
      : medicineFromRow_(rowValues, nextVersion, deletedAt);
    entity.updatedAt = Date.now();
    if (!entity && operation !== "delete") return;
    appendSyncLog_("sheet-" + Utilities.getUuid(), entityType, id, nextVersion, operation, entity, null, "", "sheet");
  } catch (error) {
    console.error(error);
  }
}

function addRecord_(parameters) {
  var id = validateId_(String(parameters.id || "").trim() || Utilities.getUuid(), "記録ID");
  var recordSheet = requiredSheet_(RECORD_SHEET);
  if (findRowById_(recordSheet, id)) return id;
  var period = validatePeriod_(parameters.period);
  var medicationDate = parseLocalDate_(parameters.date);
  var registeredDate = parameters.registeredAt ? parseLocalDate_(parameters.registeredAt) : new Date();
  var names = medicineNamesFor_(period, String(parameters.medicineId || ""));
  recordSheet.appendRow([id, medicationDate, period, names, registeredDate, ""]);
  var state = latestSyncState_("record", id);
  appendSyncLog_("legacy-" + Utilities.getUuid(), "record", id, (state ? state.version : 0) + 1, "upsert",
    recordFromRow_([id, medicationDate, period, names, registeredDate, ""], (state ? state.version : 0) + 1, null),
    null, "", "legacy-app");
  SpreadsheetApp.flush();
  return id;
}

function addMedicine_(parameters) {
  var name = String(parameters.name || "").trim();
  if (!name || name.length > 100) throw new Error("薬名を正しく入力してください");
  var timing = validatePeriod_(parameters.timing);
  var sheet = requiredSheet_(MEDICINE_SHEET);
  var rows = dataRows_(sheet, 8);
  var nextOrder = rows.reduce(function (max, row) { return Math.max(max, Number(row[4]) || 0); }, 0) + 1;
  var id = Utilities.getUuid();
  var now = new Date();
  var row = [id, name, timing, true, nextOrder, now, now, ""];
  sheet.appendRow(row);
  appendSyncLog_("legacy-" + Utilities.getUuid(), "medicine", id, 1, "upsert", medicineFromRow_(row, 1, null), null, "", "legacy-app");
  SpreadsheetApp.flush();
  return id;
}

function deactivateMedicine_(parameters) {
  var id = validateId_(parameters.id, "薬ID");
  var sheet = requiredSheet_(MEDICINE_SHEET);
  var rowNumber = findRowById_(sheet, id);
  if (!rowNumber) throw new Error("対象の薬が見つかりません");
  var now = new Date();
  sheet.getRange(rowNumber, 4).setValue(false);
  sheet.getRange(rowNumber, 7).setValue(now);
  var state = latestSyncState_("medicine", id);
  var version = (state ? state.version : 0) + 1;
  var values = sheet.getRange(rowNumber, 1, 1, 8).getValues()[0];
  appendSyncLog_("legacy-" + Utilities.getUuid(), "medicine", id, version, "delete",
    medicineFromRow_(values, version, now.getTime()), null, "", "legacy-app");
  SpreadsheetApp.flush();
  return id;
}

function medicineNamesFor_(period, selectedMedicineId) {
  var rows = dataRows_(requiredSheet_(MEDICINE_SHEET), 8);
  var names;
  if (period === "必要時" && selectedMedicineId) {
    names = rows.filter(function (row) {
      return String(row[0]) === selectedMedicineId && row[2] === period && row[3] === true;
    }).map(function (row) { return String(row[1]); });
  } else {
    names = rows.filter(function (row) { return row[0] && row[2] === period && row[3] === true; })
      .sort(function (a, b) { return (Number(a[4]) || 0) - (Number(b[4]) || 0); })
      .map(function (row) { return String(row[1]); });
  }
  if (period === "必要時" && selectedMedicineId && !names.length) throw new Error("選択した頓服薬が見つかりません");
  return names.join("、");
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
    if (ids[index][0] !== "") { lastIndex = index; break; }
  }
  if (lastIndex === -1) return [];
  return sheet.getRange(2, 1, lastIndex + 1, width).getValues();
}

function findRowById_(sheet, id) {
  if (!id || sheet.getLastRow() < 2) return 0;
  var match = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1)
    .createTextFinder(String(id)).matchEntireCell(true).findNext();
  return match ? match.getRow() : 0;
}

function validateId_(value, label) {
  var id = String(value || "").trim();
  if (!id || id.length > 100 || !/^[0-9A-Za-z_-]+$/.test(id)) throw new Error(label + "が正しくありません");
  return id;
}

function validatePeriod_(value) {
  var period = String(value || "");
  if (PERIODS.indexOf(period) === -1) throw new Error("区分が正しくありません");
  return period;
}

function parseLocalDate_(value) {
  var match = String(value || "").match(/^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2})$/);
  if (!match) throw new Error("服薬日時が正しくありません");
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]), 0);
}

function dateTime_(value) {
  return value instanceof Date ? value.getTime() : 0;
}

function formatDate_(value, pattern) {
  if (!(value instanceof Date)) return String(value || "");
  return Utilities.formatDate(value, "Asia/Tokyo", pattern);
}

function parseJson_(value, fallback) {
  try { return JSON.parse(String(value || "")); } catch (error) { return fallback; }
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
