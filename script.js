"use strict";

const elements = {
  dateInput: document.querySelector("#dateInput"),
  nowButton: document.querySelector("#nowButton"),
  refreshButton: document.querySelector("#refreshButton"),
  connectionButton: document.querySelector("#connectionButton"),
  periodButtons: document.querySelectorAll(".segment"),
  saveButton: document.querySelector("#saveButton"),
  historyList: document.querySelector("#historyList"),
  recordSearchInput: document.querySelector("#recordSearchInput"),
  asNeededDateInput: document.querySelector("#asNeededDateInput"),
  asNeededNowButton: document.querySelector("#asNeededNowButton"),
  asNeededMedicineList: document.querySelector("#asNeededMedicineList"),
  asNeededSaveButton: document.querySelector("#asNeededSaveButton"),
  asNeededMessage: document.querySelector("#asNeededMessage"),
  asNeededHistoryList: document.querySelector("#asNeededHistoryList"),
  viewTabs: document.querySelectorAll(".view-tab"),
  appViews: document.querySelectorAll(".app-view"),
  medicineForm: document.querySelector("#medicineForm"),
  medicineNameInput: document.querySelector("#medicineNameInput"),
  medicineTimingInput: document.querySelector("#medicineTimingInput"),
  medicineMasterList: document.querySelector("#medicineMasterList"),
  masterCount: document.querySelector("#masterCount"),
  profileLabel: document.querySelector("#profileLabel"),
  syncStatus: document.querySelector("#syncStatus"),
  connectionDialog: document.querySelector("#connectionDialog"),
  connectionForm: document.querySelector("#connectionForm"),
  closeConnectionButton: document.querySelector("#closeConnectionButton"),
  endpointInput: document.querySelector("#endpointInput"),
  accessKeyInput: document.querySelector("#accessKeyInput"),
  connectionMessage: document.querySelector("#connectionMessage"),
  disconnectButton: document.querySelector("#disconnectButton"),
  syncNowButton: document.querySelector("#syncNowButton"),
  recordEditDialog: document.querySelector("#recordEditDialog"),
  recordEditForm: document.querySelector("#recordEditForm"),
  recordEditDateInput: document.querySelector("#recordEditDateInput"),
  recordEditPeriodInput: document.querySelector("#recordEditPeriodInput"),
  closeRecordEditButton: document.querySelector("#closeRecordEditButton"),
  deleteRecordButton: document.querySelector("#deleteRecordButton"),
  medicineEditDialog: document.querySelector("#medicineEditDialog"),
  medicineEditForm: document.querySelector("#medicineEditForm"),
  medicineEditNameInput: document.querySelector("#medicineEditNameInput"),
  medicineEditTimingInput: document.querySelector("#medicineEditTimingInput"),
  closeMedicineEditButton: document.querySelector("#closeMedicineEditButton"),
  deleteMedicineButton: document.querySelector("#deleteMedicineButton"),
};

const CONNECTION_KEY = "medicationApp.connection.v1";
const PROFILE_KEY = "profile";
const LAST_CURSOR_KEY = "sync.lastCursor";
const LAST_SYNC_KEY = "sync.lastSuccessAt";
const LAST_ERROR_KEY = "sync.lastError";
const REMOTE_MIGRATION_PREFIX = "migration.remote.";
const MAX_PUSH_BATCH = 20;

let selectedPeriod = "朝";
let selectedAsNeededMedicineId = null;
let editingRecordId = null;
let editingMedicineId = null;
let medicines = [];
let history = [];
let searchedHistory = null;
let connection = loadJson(CONNECTION_KEY, null);
let syncInProgress = false;
let searchTimer = null;
let syncRetryTimer = null;

function scheduleSync(delay) {
  window.clearTimeout(syncRetryTimer);
  syncRetryTimer = window.setTimeout(() => syncNow(), delay);
}

function loadJson(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDateInputValue(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    + `T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function dateInputToDisplay(input) {
  const match = input.value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) {
    input.setAttribute("aria-invalid", "true");
    input.focus();
    return null;
  }
  input.removeAttribute("aria-invalid");
  return `${match[1]}/${match[2]}/${match[3]} ${match[4]}:${match[5]}`;
}

function displayToDateInput(value) {
  return String(value).replace(
    /^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2})$/,
    "$1-$2-$3T$4:$5",
  );
}

function setCurrentDateTime(input) {
  input.value = formatDateInputValue(new Date());
  input.removeAttribute("aria-invalid");
}

function automaticPeriodFor(date) {
  const hour = date.getHours();
  if (hour < 5) return "寝る前";
  if (hour < 12) return "朝";
  if (hour < 17) return "昼";
  return "夜";
}

function selectPeriod(period) {
  selectedPeriod = period;
  elements.periodButtons.forEach((button) => {
    const selected = button.dataset.period === period;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
}

function refreshOpenDefaults() {
  const now = new Date();
  setCurrentDateTime(elements.dateInput);
  setCurrentDateTime(elements.asNeededDateInput);
  selectPeriod(automaticPeriodFor(now));
}

function badgeClass(period) {
  if (period === "朝") return "morning";
  if (period === "昼") return "noon";
  if (period === "寝る前") return "sleep";
  if (period === "必要時") return "as-needed";
  return "night";
}

function switchView(viewId) {
  elements.appViews.forEach((view) => view.classList.toggle("active", view.id === viewId));
  elements.viewTabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.view === viewId));
}

function setSyncStatus(text, state) {
  elements.syncStatus.textContent = text;
  elements.syncStatus.dataset.state = state;
}

async function updateSyncStatus() {
  const [queue, conflicts, lastSync, lastError] = await Promise.all([
    MedicationDB.getAll(MedicationDB.STORES.queue),
    MedicationDB.getAll(MedicationDB.STORES.conflicts),
    MedicationDB.getMeta(LAST_SYNC_KEY, null),
    MedicationDB.getMeta(LAST_ERROR_KEY, null),
  ]);
  if (!connection) {
    setSyncStatus(queue.length ? `端末に保存・未同期 ${queue.length}件` : "この端末内に保存", queue.length ? "loading" : "local");
  } else if (syncInProgress) {
    setSyncStatus("バックグラウンド同期中", "loading");
  } else if (lastError) {
    setSyncStatus(`同期エラー${queue.length ? `・未同期 ${queue.length}件` : ""}`, "error");
  } else if (queue.length) {
    setSyncStatus(`未同期 ${queue.length}件`, "loading");
  } else if (conflicts.length) {
    setSyncStatus(`同期済み・競合履歴 ${conflicts.length}件`, "error");
  } else if (lastSync) {
    const time = new Date(lastSync).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
    setSyncStatus(`同期済み・最終 ${time}`, "synced");
  } else {
    setSyncStatus("端末に保存・同期準備済み", "local");
  }
}

async function refreshLocalData(search = elements.recordSearchInput.value) {
  [medicines, history, searchedHistory] = await Promise.all([
    MedicationDB.getActiveMedicines(),
    MedicationDB.getRecentRecords(100),
    search.trim() ? MedicationDB.getRecentRecords(100, search) : Promise.resolve(null),
  ]);
  renderMedicineMaster();
  renderAsNeededMedicines();
  renderHistory();
  renderAsNeededHistory();
  await updateSyncStatus();
}

function renderMedicineMaster() {
  elements.medicineMasterList.innerHTML = "";
  elements.masterCount.textContent = `${medicines.length}件`;
  if (!medicines.length) {
    elements.medicineMasterList.innerHTML = '<p class="empty-note">登録中の薬はありません</p>';
    return;
  }
  medicines.forEach((medicine) => {
    const item = document.createElement("article");
    item.className = "master-card";
    item.innerHTML = `
      <div>
        <strong>${escapeHtml(medicine.name)}</strong>
        <small>${escapeHtml(medicine.timing)}${medicine.syncStatus === "pending" ? "・未同期" : ""}</small>
      </div>
      <button class="delete-button" type="button" aria-label="${escapeHtml(medicine.name)}を編集">編集</button>
    `;
    item.querySelector("button").addEventListener("click", () => openMedicineEdit(medicine.id));
    elements.medicineMasterList.append(item);
  });
}

function renderAsNeededMedicines() {
  const available = medicines.filter((medicine) => medicine.timing === "必要時");
  if (!available.some((medicine) => medicine.id === selectedAsNeededMedicineId)) selectedAsNeededMedicineId = null;
  elements.asNeededMedicineList.innerHTML = "";
  if (!available.length) {
    elements.asNeededMedicineList.innerHTML = '<p class="empty-note">薬リストで「必要時」の薬を登録してください</p>';
    elements.asNeededSaveButton.disabled = true;
    return;
  }
  available.forEach((medicine) => {
    const selected = medicine.id === selectedAsNeededMedicineId;
    const button = document.createElement("button");
    button.className = `medicine-item${selected ? " selected" : ""}`;
    button.type = "button";
    button.setAttribute("aria-pressed", String(selected));
    button.innerHTML = `
      <span class="checkmark" aria-hidden="true">✓</span>
      <span><strong>${escapeHtml(medicine.name)}</strong><small>頓服薬</small></span>
    `;
    button.addEventListener("click", () => {
      selectedAsNeededMedicineId = medicine.id;
      elements.asNeededMessage.textContent = "";
      renderAsNeededMedicines();
    });
    elements.asNeededMedicineList.append(button);
  });
  elements.asNeededSaveButton.disabled = !selectedAsNeededMedicineId;
}

function historyCard(record, title) {
  const card = document.createElement("article");
  card.className = "history-card";
  card.innerHTML = `
    <div class="history-main">
      <span class="period-badge ${badgeClass(record.period)}">${record.period === "必要時" ? "頓服" : escapeHtml(record.period)}</span>
      <div>
        <time>${escapeHtml(record.date)}${record.syncStatus === "pending" ? "・未同期" : ""}</time>
        <p>${escapeHtml(title)}</p>
        ${record.medicines ? `<small class="history-medicines">${escapeHtml(record.medicines)}</small>` : ""}
      </div>
      <button class="history-edit-button" type="button" aria-label="この記録を編集">✎</button>
    </div>
  `;
  card.querySelector("button").addEventListener("click", () => openRecordEdit(record.id));
  return card;
}

function renderHistory() {
  elements.historyList.innerHTML = "";
  const records = (searchedHistory || history).filter((record) => record.period !== "必要時");
  if (!records.length) {
    elements.historyList.innerHTML = '<p class="empty-note neutral">該当する記録はありません</p>';
    return;
  }
  records.slice(0, 20).forEach((record) => elements.historyList.append(historyCard(record, `${record.period}の服薬を記録`)));
}

function renderAsNeededHistory() {
  elements.asNeededHistoryList.innerHTML = "";
  const records = history.filter((record) => record.period === "必要時");
  if (!records.length) {
    elements.asNeededHistoryList.innerHTML = '<p class="empty-note neutral">まだ頓服の記録はありません</p>';
    return;
  }
  records.slice(0, 20).forEach((record) => elements.asNeededHistoryList.append(historyCard(record, "頓服を記録")));
}

function normalizeEndpoint(value) {
  const url = new URL(value.trim());
  if (url.protocol !== "https:" || url.hostname !== "script.google.com" || !url.pathname.endsWith("/exec")) {
    throw new Error("Apps ScriptのウェブアプリURLを入力してください");
  }
  return url.toString();
}

function requestRemote(action, parameters = {}, targetConnection = connection) {
  if (!targetConnection) return Promise.reject(new Error("スプレッドシートに未接続です"));
  return new Promise((resolve, reject) => {
    const callbackName = `medicationSync_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const script = document.createElement("script");
    const timeout = window.setTimeout(() => finish(new Error("同期がタイムアウトしました")), 15000);
    function finish(error, data) {
      window.clearTimeout(timeout);
      script.remove();
      delete window[callbackName];
      if (error) reject(error); else resolve(data);
    }
    window[callbackName] = (data) => {
      if (!data?.ok) finish(new Error(data?.message || "同期できませんでした"));
      else finish(null, data);
    };
    script.onerror = () => finish(new Error("スプレッドシートに接続できませんでした"));
    const url = new URL(targetConnection.endpoint);
    url.searchParams.set("action", action);
    url.searchParams.set("key", targetConnection.key);
    url.searchParams.set("callback", callbackName);
    Object.entries(parameters).forEach(([key, value]) => url.searchParams.set(key, String(value)));
    url.searchParams.set("_", Date.now());
    script.src = url.toString();
    document.head.append(script);
  });
}

async function deviceId() {
  let value = await MedicationDB.getMeta("deviceId", null);
  if (!value) {
    value = crypto.randomUUID();
    await MedicationDB.setMeta("deviceId", value);
  }
  return value;
}

async function postRemoteChange(item) {
  const body = new URLSearchParams({
    action: "applyChange",
    key: connection.key,
    changeId: item.changeId,
    entityType: item.entityType,
    entityId: item.entityId,
    operation: item.operation,
    baseVersion: String(item.baseVersion || 0),
    deviceId: await deviceId(),
    entity: JSON.stringify(item.entity),
  });
  await MedicationDB.updateQueueAttempt(item.changeId);
  await fetch(connection.endpoint, { method: "POST", mode: "no-cors", body });
}

async function ensureInitialRemoteMigration() {
  const migrationKey = `${REMOTE_MIGRATION_PREFIX}${connection.endpoint}`;
  if (await MedicationDB.getMeta(migrationKey, false)) return;
  setSyncStatus("初回データを取り込み中", "loading");
  const snapshot = await requestRemote("bootstrap", { includeAll: "1", prepareMigration: "1" });
  const result = await MedicationDB.importRemoteSnapshot(snapshot);
  const [localRecords, localMedicines] = await Promise.all([
    MedicationDB.getAll(MedicationDB.STORES.records),
    MedicationDB.getAll(MedicationDB.STORES.medicines),
  ]);
  const localRecordIds = new Set(localRecords.map((item) => item.id));
  const localMedicineIds = new Set(localMedicines.map((item) => item.id));
  const missingRecord = (snapshot.history || []).some((item) => !localRecordIds.has(item.id));
  const missingMedicine = (snapshot.medicines || []).some((item) => !localMedicineIds.has(item.id));
  if (missingRecord || missingMedicine
    || localRecords.length < Number(snapshot.counts?.records || 0)
    || localMedicines.length < Number(snapshot.counts?.medicines || 0)) {
    throw new Error("初回データの件数確認に失敗しました。元のスプレッドシートは変更していません");
  }
  await MedicationDB.setMeta(migrationKey, {
    completedAt: Date.now(),
    remoteRecords: Number(snapshot.counts?.records || 0),
    remoteMedicines: Number(snapshot.counts?.medicines || 0),
    importedRecords: result.importedRecords,
    importedMedicines: result.importedMedicines,
  });
  await MedicationDB.setMeta(LAST_CURSOR_KEY, Number(snapshot.syncCursor || 0));
  if (snapshot.profile) {
    await MedicationDB.setMeta(PROFILE_KEY, snapshot.profile);
    elements.profileLabel.textContent = snapshot.profile;
  }
  await refreshLocalData();
}

async function pullRemoteChanges() {
  let cursor = Number(await MedicationDB.getMeta(LAST_CURSOR_KEY, 0));
  for (let page = 0; page < 10; page += 1) {
    const data = await requestRemote("pullChanges", { cursor });
    await MedicationDB.applyRemoteChanges(Array.isArray(data.changes) ? data.changes : []);
    cursor = Number(data.nextCursor || cursor);
    await MedicationDB.setMeta(LAST_CURSOR_KEY, cursor);
    if (!data.hasMore) break;
  }
}

async function syncNow(options = {}) {
  await databaseReady;
  if (!connection || syncInProgress) {
    await updateSyncStatus();
    return;
  }
  syncInProgress = true;
  window.clearTimeout(syncRetryTimer);
  await updateSyncStatus();
  let failed = false;
  try {
    await ensureInitialRemoteMigration();
    const queue = (await MedicationDB.getAll(MedicationDB.STORES.queue))
      .sort((a, b) => a.createdAt - b.createdAt)
      .slice(0, MAX_PUSH_BATCH);
    for (const item of queue) await postRemoteChange(item);
    if (queue.length) await new Promise((resolve) => window.setTimeout(resolve, 500));
    await pullRemoteChanges();
    await MedicationDB.setMeta(LAST_SYNC_KEY, Date.now());
    await MedicationDB.setMeta(LAST_ERROR_KEY, null);
    if (options.manual) elements.connectionMessage.textContent = "同期が完了しました";
  } catch (error) {
    failed = true;
    await MedicationDB.setMeta(LAST_ERROR_KEY, { at: Date.now(), message: error.message });
    setSyncStatus("同期エラー・端末には保存済み", "error");
    if (options.manual) elements.connectionMessage.textContent = error.message;
  } finally {
    syncInProgress = false;
    await refreshLocalData();
    const remaining = await MedicationDB.getAll(MedicationDB.STORES.queue);
    if (connection && remaining.length && navigator.onLine) scheduleSync(failed ? 30000 : 750);
  }
}

async function saveRecord(period, input, selectedMedicine = null) {
  const date = dateInputToDisplay(input);
  if (!date) return false;
  const now = Date.now();
  const names = selectedMedicine?.name || medicines
    .filter((medicine) => medicine.timing === period)
    .map((medicine) => medicine.name)
    .join("、");
  await MedicationDB.saveLocalChange("record", {
    id: crypto.randomUUID(),
    date,
    period,
    medicines: names,
    medicineId: selectedMedicine?.id || "",
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    version: 0,
  }, "upsert");
  await refreshLocalData();
  syncNow();
  return true;
}

function openRecordEdit(id) {
  const record = history.find((item) => item.id === id);
  if (!record) return;
  editingRecordId = id;
  elements.recordEditDateInput.value = displayToDateInput(record.date);
  elements.recordEditPeriodInput.value = record.period;
  elements.recordEditDialog.showModal();
}

function openMedicineEdit(id) {
  const medicine = medicines.find((item) => item.id === id);
  if (!medicine) return;
  editingMedicineId = id;
  elements.medicineEditNameInput.value = medicine.name;
  elements.medicineEditTimingInput.value = medicine.timing;
  elements.medicineEditDialog.showModal();
}

elements.nowButton.addEventListener("click", () => {
  setCurrentDateTime(elements.dateInput);
  selectPeriod(automaticPeriodFor(new Date()));
});
elements.asNeededNowButton.addEventListener("click", () => setCurrentDateTime(elements.asNeededDateInput));
elements.periodButtons.forEach((button) => button.addEventListener("click", () => selectPeriod(button.dataset.period)));
elements.viewTabs.forEach((tab) => tab.addEventListener("click", () => {
  if (tab.dataset.view === "asNeededView") setCurrentDateTime(elements.asNeededDateInput);
  switchView(tab.dataset.view);
}));

elements.saveButton.addEventListener("click", async () => {
  await databaseReady;
  if (!await saveRecord(selectedPeriod, elements.dateInput)) return;
  elements.saveButton.textContent = "端末に記録しました";
  refreshOpenDefaults();
  window.setTimeout(() => { elements.saveButton.textContent = "記録する"; }, 1200);
});

elements.asNeededSaveButton.addEventListener("click", async () => {
  await databaseReady;
  const medicine = medicines.find((item) => item.id === selectedAsNeededMedicineId && item.timing === "必要時");
  if (!medicine) {
    elements.asNeededMessage.textContent = "飲んだ頓服薬を1つ選んでください";
    return;
  }
  if (!await saveRecord("必要時", elements.asNeededDateInput, medicine)) return;
  selectedAsNeededMedicineId = null;
  elements.asNeededSaveButton.textContent = "端末に記録しました";
  setCurrentDateTime(elements.asNeededDateInput);
  renderAsNeededMedicines();
  window.setTimeout(() => {
    elements.asNeededSaveButton.textContent = "頓服を記録する";
    renderAsNeededMedicines();
  }, 1200);
});

elements.medicineForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await databaseReady;
  const name = elements.medicineNameInput.value.trim();
  if (!name) return elements.medicineNameInput.focus();
  const now = Date.now();
  await MedicationDB.saveLocalChange("medicine", {
    id: crypto.randomUUID(),
    name,
    timing: elements.medicineTimingInput.value,
    sortOrder: medicines.reduce((max, item) => Math.max(max, Number(item.sortOrder || 0)), 0) + 1,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    version: 0,
  }, "upsert");
  elements.medicineForm.reset();
  await refreshLocalData();
  syncNow();
});

elements.recordEditForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const current = await MedicationDB.get(MedicationDB.STORES.records, editingRecordId);
  const date = dateInputToDisplay(elements.recordEditDateInput);
  if (!current || !date) return;
  const period = elements.recordEditPeriodInput.value;
  const names = period === "必要時" ? current.medicines : medicines
    .filter((medicine) => medicine.timing === period)
    .map((medicine) => medicine.name).join("、");
  await MedicationDB.saveLocalChange("record", { ...current, date, period, medicines: names, updatedAt: Date.now() }, "upsert");
  elements.recordEditDialog.close();
  await refreshLocalData();
  syncNow();
});

elements.deleteRecordButton.addEventListener("click", async () => {
  if (!window.confirm("この記録を削除しますか？")) return;
  const current = await MedicationDB.get(MedicationDB.STORES.records, editingRecordId);
  if (!current) return;
  const now = Date.now();
  await MedicationDB.saveLocalChange("record", { ...current, deletedAt: now, updatedAt: now }, "delete");
  elements.recordEditDialog.close();
  await refreshLocalData();
  syncNow();
});

elements.medicineEditForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const current = await MedicationDB.get(MedicationDB.STORES.medicines, editingMedicineId);
  const name = elements.medicineEditNameInput.value.trim();
  if (!current || !name) return;
  await MedicationDB.saveLocalChange("medicine", {
    ...current,
    name,
    timing: elements.medicineEditTimingInput.value,
    updatedAt: Date.now(),
  }, "upsert");
  elements.medicineEditDialog.close();
  await refreshLocalData();
  syncNow();
});

elements.deleteMedicineButton.addEventListener("click", async () => {
  if (!window.confirm("この薬を使用終了にしますか？")) return;
  const current = await MedicationDB.get(MedicationDB.STORES.medicines, editingMedicineId);
  if (!current) return;
  const now = Date.now();
  await MedicationDB.saveLocalChange("medicine", { ...current, deletedAt: now, updatedAt: now }, "delete");
  elements.medicineEditDialog.close();
  await refreshLocalData();
  syncNow();
});

elements.recordSearchInput.addEventListener("input", () => {
  window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => refreshLocalData(elements.recordSearchInput.value), 160);
});

function openConnectionDialog() {
  elements.endpointInput.value = connection?.endpoint || "";
  elements.accessKeyInput.value = connection?.key || "";
  elements.connectionMessage.textContent = "";
  elements.disconnectButton.hidden = !connection;
  elements.syncNowButton.hidden = !connection;
  elements.connectionDialog.showModal();
}

elements.connectionButton.addEventListener("click", openConnectionDialog);
elements.syncStatus.addEventListener("click", openConnectionDialog);
elements.closeConnectionButton.addEventListener("click", () => elements.connectionDialog.close());
elements.closeRecordEditButton.addEventListener("click", () => elements.recordEditDialog.close());
elements.closeMedicineEditButton.addEventListener("click", () => elements.medicineEditDialog.close());
elements.refreshButton.addEventListener("click", () => syncNow({ manual: true }));
elements.syncNowButton.addEventListener("click", () => syncNow({ manual: true }));

elements.connectionForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  elements.connectionMessage.textContent = "接続を確認しています";
  try {
    const nextConnection = {
      endpoint: normalizeEndpoint(elements.endpointInput.value),
      key: elements.accessKeyInput.value.trim(),
    };
    if (!nextConnection.key) throw new Error("接続キーを入力してください");
    const response = await requestRemote("ping", {}, nextConnection);
    connection = nextConnection;
    localStorage.setItem(CONNECTION_KEY, JSON.stringify(connection));
    elements.profileLabel.textContent = response.profile || "服薬管理";
    await MedicationDB.setMeta(PROFILE_KEY, response.profile || "服薬管理");
    elements.connectionDialog.close();
    syncNow();
  } catch (error) {
    elements.connectionMessage.textContent = error.message;
  }
});

elements.disconnectButton.addEventListener("click", async () => {
  connection = null;
  localStorage.removeItem(CONNECTION_KEY);
  elements.connectionDialog.close();
  await updateSyncStatus();
});

const databaseReady = (async () => {
  try {
    await MedicationDB.open();
    await MedicationDB.migrateLegacyLocalStorage();
    elements.profileLabel.textContent = await MedicationDB.getMeta(PROFILE_KEY, "服薬管理");
    await refreshLocalData();
  } catch (error) {
    setSyncStatus("端末保存を開始できません", "error");
    elements.saveButton.disabled = true;
    elements.asNeededSaveButton.disabled = true;
    throw error;
  }
})();

refreshOpenDefaults();
databaseReady.then(() => window.setTimeout(() => syncNow(), 0)).catch(() => {});
window.addEventListener("pageshow", () => {
  refreshOpenDefaults();
  databaseReady.then(() => refreshLocalData()).then(() => syncNow()).catch(() => {});
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    refreshOpenDefaults();
    databaseReady.then(() => refreshLocalData()).then(() => syncNow()).catch(() => {});
  }
});
window.addEventListener("online", () => syncNow());

if ("serviceWorker" in navigator && window.location.protocol !== "file:") {
  window.addEventListener("load", () => navigator.serviceWorker.register("./service-worker.js").catch(() => {}));
}
