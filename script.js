const dateInput = document.querySelector("#dateInput");
const nowButton = document.querySelector("#nowButton");
const refreshButton = document.querySelector("#refreshButton");
const connectionButton = document.querySelector("#connectionButton");
const periodButtons = document.querySelectorAll(".segment");
const saveButton = document.querySelector("#saveButton");
const historyList = document.querySelector("#historyList");
const asNeededDateInput = document.querySelector("#asNeededDateInput");
const asNeededNowButton = document.querySelector("#asNeededNowButton");
const asNeededMedicineList = document.querySelector("#asNeededMedicineList");
const asNeededSaveButton = document.querySelector("#asNeededSaveButton");
const asNeededMessage = document.querySelector("#asNeededMessage");
const asNeededHistoryList = document.querySelector("#asNeededHistoryList");
const viewTabs = document.querySelectorAll(".view-tab");
const appViews = document.querySelectorAll(".app-view");
const medicineForm = document.querySelector("#medicineForm");
const medicineNameInput = document.querySelector("#medicineNameInput");
const medicineTimingInput = document.querySelector("#medicineTimingInput");
const medicineMasterList = document.querySelector("#medicineMasterList");
const masterCount = document.querySelector("#masterCount");
const profileLabel = document.querySelector("#profileLabel");
const syncStatus = document.querySelector("#syncStatus");
const connectionDialog = document.querySelector("#connectionDialog");
const connectionForm = document.querySelector("#connectionForm");
const closeConnectionButton = document.querySelector("#closeConnectionButton");
const endpointInput = document.querySelector("#endpointInput");
const accessKeyInput = document.querySelector("#accessKeyInput");
const connectionMessage = document.querySelector("#connectionMessage");
const disconnectButton = document.querySelector("#disconnectButton");

const CONNECTION_KEY = "medicationApp.connection.v1";
const MEDICINE_KEY = "medicationApp.medicines.v2";
const HISTORY_KEY = "medicationApp.history.v2";

let selectedPeriod = "朝";
let selectedAsNeededMedicineId = null;
let connection = loadJson(CONNECTION_KEY, null);
let medicines = loadJson(MEDICINE_KEY, []);
let history = loadJson(HISTORY_KEY, []);

function loadJson(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function saveJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
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
  return [date.getFullYear(), pad(date.getMonth() + 1), pad(date.getDate())].join("-")
    + "T"
    + [pad(date.getHours()), pad(date.getMinutes())].join(":");
}

function setCurrentDateTime(input) {
  input.value = formatDateInputValue(new Date());
  input.removeAttribute("aria-invalid");
}

function medicationDateFromInput(input) {
  const match = input.value.match(/^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2})$/);
  if (!match) {
    input.setAttribute("aria-invalid", "true");
    input.focus();
    return null;
  }
  input.removeAttribute("aria-invalid");
  return `${match[1]}/${match[2]}/${match[3]} ${match[4]}:${match[5]}`;
}
function badgeClass(period) {
  if (period === "朝") return "morning";
  if (period === "昼") return "noon";
  if (period === "寝る前") return "sleep";
  if (period === "必要時") return "as-needed";
  return "night";
}

function setSyncStatus(text, state) {
  syncStatus.textContent = text;
  syncStatus.dataset.state = state;
}

function switchView(viewId) {
  appViews.forEach((view) => view.classList.toggle("active", view.id === viewId));
  viewTabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.view === viewId));
}

function renderMedicineMaster() {
  medicineMasterList.innerHTML = "";
  masterCount.textContent = `${medicines.length}件`;

  if (!medicines.length) {
    medicineMasterList.innerHTML = '<p class="empty-note">登録中の薬はありません</p>';
    return;
  }

  medicines.forEach((medicine) => {
    const name = escapeHtml(medicine.name);
    const timing = escapeHtml(medicine.timing);
    const item = document.createElement("article");
    item.className = "master-card";
    item.innerHTML = `
      <div>
        <strong>${name}</strong>
        <small>${timing}</small>
      </div>
      <button class="delete-button" type="button" aria-label="${name}の服用を終了">終了</button>
    `;
    item.querySelector("button").addEventListener("click", () => deactivateMedicine(medicine));
    medicineMasterList.append(item);
  });
}

function renderAsNeededMedicines() {
  const availableMedicines = medicines.filter((medicine) => medicine.timing === "必要時");
  const selectionExists = availableMedicines.some(
    (medicine) => medicine.id === selectedAsNeededMedicineId,
  );

  if (!selectionExists) selectedAsNeededMedicineId = null;
  asNeededMedicineList.innerHTML = "";

  if (!availableMedicines.length) {
    asNeededMedicineList.innerHTML = '<p class="empty-note">薬リストで「必要時」の薬を登録してください</p>';
    asNeededSaveButton.disabled = true;
    return;
  }

  availableMedicines.forEach((medicine) => {
    const selected = medicine.id === selectedAsNeededMedicineId;
    const button = document.createElement("button");
    button.className = `medicine-item${selected ? " selected" : ""}`;
    button.type = "button";
    button.setAttribute("aria-pressed", String(selected));
    button.innerHTML = `
      <span class="checkmark" aria-hidden="true">✓</span>
      <span>
        <strong>${escapeHtml(medicine.name)}</strong>
        <small>頓服薬</small>
      </span>
    `;
    button.addEventListener("click", () => {
      selectedAsNeededMedicineId = medicine.id;
      asNeededMessage.textContent = "";
      renderAsNeededMedicines();
    });
    asNeededMedicineList.append(button);
  });

  asNeededSaveButton.disabled = !selectedAsNeededMedicineId;
}

function renderAsNeededHistory() {
  const records = history
    .filter((record) => record.period === "必要時")
    .slice(0, 20);
  asNeededHistoryList.innerHTML = "";

  if (!records.length) {
    asNeededHistoryList.innerHTML = '<p class="empty-note neutral">まだ頓服の記録はありません</p>';
    return;
  }

  records.forEach((record) => {
    const medicinesText = record.medicines
      ? `<small class="history-medicines">${escapeHtml(record.medicines)}</small>`
      : "";
    const card = document.createElement("article");
    card.className = "history-card";
    card.innerHTML = `
      <div class="history-main">
        <span class="period-badge as-needed">頓服</span>
        <div>
          <time>${escapeHtml(record.date)}</time>
          <p>頓服を記録</p>
          ${medicinesText}
        </div>
      </div>
    `;
    asNeededHistoryList.append(card);
  });
}

function renderHistory() {
  historyList.innerHTML = "";

  if (!history.length) {
    historyList.innerHTML = '<p class="empty-note neutral">まだ記録はありません</p>';
    return;
  }

  history.slice(0, 20).forEach((record) => {
    const period = escapeHtml(record.period);
    const date = escapeHtml(record.date);
    const medicinesText = record.medicines
      ? `<small class="history-medicines">${escapeHtml(record.medicines)}</small>`
      : "";
    const card = document.createElement("article");
    card.className = "history-card";
    card.innerHTML = `
      <div class="history-main">
        <span class="period-badge ${badgeClass(record.period)}">${period}</span>
        <div>
          <time>${date}</time>
          <p>${period}の服薬を記録</p>
          ${medicinesText}
        </div>
      </div>
    `;
    historyList.append(card);
  });
}

function normalizeEndpoint(value) {
  const endpoint = value.trim();
  const url = new URL(endpoint);
  if (url.protocol !== "https:" || url.hostname !== "script.google.com" || !url.pathname.endsWith("/exec")) {
    throw new Error("Apps ScriptのウェブアプリURLを入力してください");
  }
  return url.toString();
}

function requestBootstrap(targetConnection = connection) {
  if (!targetConnection) return Promise.reject(new Error("未接続です"));

  return new Promise((resolve, reject) => {
    const callbackName = `medicationCallback_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const script = document.createElement("script");
    const timeout = window.setTimeout(() => finish(new Error("接続がタイムアウトしました")), 12000);

    function finish(error, data) {
      window.clearTimeout(timeout);
      script.remove();
      delete window[callbackName];
      if (error) reject(error);
      else resolve(data);
    }

    window[callbackName] = (data) => {
      if (!data?.ok) finish(new Error(data?.message || "スプレッドシートに接続できませんでした"));
      else finish(null, data);
    };
    script.onerror = () => finish(new Error("スプレッドシートに接続できませんでした"));

    const url = new URL(targetConnection.endpoint);
    url.searchParams.set("action", "bootstrap");
    url.searchParams.set("key", targetConnection.key);
    url.searchParams.set("callback", callbackName);
    url.searchParams.set("_", Date.now());
    script.src = url.toString();
    document.head.append(script);
  });
}

async function postRemote(action, payload = {}) {
  const body = new URLSearchParams({ action, key: connection.key, ...payload });
  await fetch(connection.endpoint, {
    method: "POST",
    mode: "no-cors",
    body,
  });
  await new Promise((resolve) => window.setTimeout(resolve, 500));
  return syncFromRemote();
}

function applyRemoteData(data) {
  medicines = Array.isArray(data.medicines) ? data.medicines : [];
  history = Array.isArray(data.history) ? data.history : [];
  profileLabel.textContent = data.profile || "服薬管理";
  renderMedicineMaster();
  renderAsNeededMedicines();
  renderHistory();
  renderAsNeededHistory();
  setSyncStatus("スプレッドシートと同期済み", "synced");
}

async function syncFromRemote() {
  if (!connection) {
    renderMedicineMaster();
    renderAsNeededMedicines();
    renderHistory();
    renderAsNeededHistory();
    profileLabel.textContent = "服薬管理";
    setSyncStatus("この端末内に保存", "local");
    return;
  }

  setSyncStatus("同期中", "loading");
  try {
    applyRemoteData(await requestBootstrap());
  } catch (error) {
    setSyncStatus("同期できません", "error");
    throw error;
  }
}

async function deactivateMedicine(medicine) {
  if (!window.confirm(`${medicine.name}を「使用終了」にしますか？`)) return;

  if (connection) {
    try {
      setSyncStatus("同期中", "loading");
      await postRemote("deactivateMedicine", { id: medicine.id });
    } catch {
      setSyncStatus("更新できませんでした", "error");
    }
    return;
  }

  medicines = medicines.filter((current) => current.id !== medicine.id);
  saveJson(MEDICINE_KEY, medicines);
  renderMedicineMaster();
  renderAsNeededMedicines();
}

function openConnectionDialog() {
  endpointInput.value = connection?.endpoint || "";
  accessKeyInput.value = connection?.key || "";
  connectionMessage.textContent = "";
  disconnectButton.hidden = !connection;
  connectionDialog.showModal();
}

nowButton.addEventListener("click", () => {
  setCurrentDateTime(dateInput);
});

asNeededNowButton.addEventListener("click", () => {
  setCurrentDateTime(asNeededDateInput);
});

refreshButton.addEventListener("click", () => {
  syncFromRemote().catch(() => {});
});

connectionButton.addEventListener("click", openConnectionDialog);
syncStatus.addEventListener("click", openConnectionDialog);
closeConnectionButton.addEventListener("click", () => connectionDialog.close());

periodButtons.forEach((button) => {
  button.addEventListener("click", () => {
    selectedPeriod = button.dataset.period;
    periodButtons.forEach((item) => item.classList.remove("selected"));
    button.classList.add("selected");
  });
});

viewTabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    if (tab.dataset.view === "asNeededView") {
      setCurrentDateTime(asNeededDateInput);
      renderAsNeededMedicines();
    }
    switchView(tab.dataset.view);
  });
});

connectionForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  connectionMessage.textContent = "接続を確認しています";
  try {
    const nextConnection = {
      endpoint: normalizeEndpoint(endpointInput.value),
      key: accessKeyInput.value.trim(),
    };
    if (!nextConnection.key) throw new Error("接続キーを入力してください");
    const data = await requestBootstrap(nextConnection);
    connection = nextConnection;
    saveJson(CONNECTION_KEY, connection);
    applyRemoteData(data);
    connectionDialog.close();
  } catch (error) {
    connectionMessage.textContent = error.message;
  }
});

disconnectButton.addEventListener("click", () => {
  connection = null;
  localStorage.removeItem(CONNECTION_KEY);
  profileLabel.textContent = "服薬管理";
  setSyncStatus("この端末内に保存", "local");
  connectionDialog.close();
  medicines = loadJson(MEDICINE_KEY, []);
  history = loadJson(HISTORY_KEY, []);
  renderMedicineMaster();
  renderAsNeededMedicines();
  renderHistory();
  renderAsNeededHistory();
});

medicineForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = medicineNameInput.value.trim();
  const timing = medicineTimingInput.value;
  if (!name) {
    medicineNameInput.focus();
    return;
  }

  const submitButton = medicineForm.querySelector("button[type='submit']");
  submitButton.disabled = true;
  try {
    if (connection) {
      await postRemote("addMedicine", { name, timing });
    } else {
      medicines.push({
        id: `medicine-${Date.now()}`,
        name,
        timing,
      });
      saveJson(MEDICINE_KEY, medicines);
      renderMedicineMaster();
      renderAsNeededMedicines();
    }
    medicineForm.reset();
    medicineTimingInput.value = "朝";
    switchView(timing === "必要時" ? "asNeededView" : "recordView");
  } catch {
    setSyncStatus("薬を追加できませんでした", "error");
  } finally {
    submitButton.disabled = false;
  }
});

saveButton.addEventListener("click", async () => {
  const medicationDate = medicationDateFromInput(dateInput);
  if (!medicationDate) return;
  saveButton.disabled = true;
  try {
    if (connection) {
      await postRemote("addRecord", {
        date: medicationDate,
        period: selectedPeriod,
      });
    } else {
      const medicineNames = medicines
        .filter((medicine) => medicine.timing === selectedPeriod)
        .map((medicine) => medicine.name)
        .join("、");
      history.unshift({
        id: `history-${Date.now()}`,
        date: medicationDate,
        period: selectedPeriod,
        medicines: medicineNames,
      });
      history = history.slice(0, 100);
      saveJson(HISTORY_KEY, history);
      renderHistory();
      renderAsNeededHistory();
    }
    saveButton.textContent = "記録しました";
    setCurrentDateTime(dateInput);
  } catch {
    saveButton.textContent = "記録できませんでした";
    setSyncStatus("記録を保存できませんでした", "error");
  } finally {
    window.setTimeout(() => {
      saveButton.textContent = "記録する";
      saveButton.disabled = false;
    }, 1200);
  }
});

asNeededSaveButton.addEventListener("click", async () => {
  const medicationDate = medicationDateFromInput(asNeededDateInput);
  if (!medicationDate) return;
  const medicine = medicines.find(
    (item) => item.id === selectedAsNeededMedicineId && item.timing === "必要時",
  );

  if (!medicine) {
    asNeededMessage.textContent = "飲んだ頓服薬を1つ選んでください";
    renderAsNeededMedicines();
    return;
  }

  asNeededSaveButton.disabled = true;
  asNeededMessage.textContent = "";
  try {
    if (connection) {
      await postRemote("addRecord", {
        date: medicationDate,
        period: "必要時",
        medicineId: medicine.id,
      });
    } else {
      history.unshift({
        id: `history-${Date.now()}`,
        date: medicationDate,
        period: "必要時",
        medicines: medicine.name,
      });
      history = history.slice(0, 100);
      saveJson(HISTORY_KEY, history);
      renderHistory();
      renderAsNeededHistory();
    }
    selectedAsNeededMedicineId = null;
    asNeededSaveButton.textContent = "記録しました";
    setCurrentDateTime(asNeededDateInput);
    renderAsNeededMedicines();
  } catch {
    asNeededMessage.textContent = "頓服を記録できませんでした";
    setSyncStatus("記録を保存できませんでした", "error");
  } finally {
    window.setTimeout(() => {
      asNeededSaveButton.textContent = "頓服を記録する";
      renderAsNeededMedicines();
    }, 1200);
  }
});

setCurrentDateTime(dateInput);
setCurrentDateTime(asNeededDateInput);
renderMedicineMaster();
renderAsNeededMedicines();
renderHistory();
renderAsNeededHistory();
syncFromRemote().catch(() => {});

if ("serviceWorker" in navigator && window.location.protocol !== "file:") {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js").catch(() => {
      // The app remains usable online even if offline support cannot be registered.
    });
  });
}
