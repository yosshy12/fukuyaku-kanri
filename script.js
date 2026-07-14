const dateValue = document.querySelector("#dateValue");
const nowButton = document.querySelector("#nowButton");
const refreshButton = document.querySelector("#refreshButton");
const connectionButton = document.querySelector("#connectionButton");
const periodButtons = document.querySelectorAll(".segment");
const saveButton = document.querySelector("#saveButton");
const historyList = document.querySelector("#historyList");
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

function formatDate(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return [date.getFullYear(), pad(date.getMonth() + 1), pad(date.getDate())].join("/")
    + " "
    + [pad(date.getHours()), pad(date.getMinutes())].join(":");
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

function renderHistory() {
  historyList.innerHTML = "";

  if (!history.length) {
    historyList.innerHTML = '<p class="empty-note neutral">まだ記録はありません</p>';
    return;
  }

  history.forEach((record) => {
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
  renderHistory();
  setSyncStatus("スプレッドシートと同期済み", "synced");
}

async function syncFromRemote() {
  if (!connection) {
    renderMedicineMaster();
    renderHistory();
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
}

function openConnectionDialog() {
  endpointInput.value = connection?.endpoint || "";
  accessKeyInput.value = connection?.key || "";
  connectionMessage.textContent = "";
  disconnectButton.hidden = !connection;
  connectionDialog.showModal();
}

nowButton.addEventListener("click", () => {
  dateValue.textContent = formatDate(new Date());
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
  tab.addEventListener("click", () => switchView(tab.dataset.view));
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
  renderHistory();
});

medicineForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = medicineNameInput.value.trim();
  if (!name) {
    medicineNameInput.focus();
    return;
  }

  const submitButton = medicineForm.querySelector("button[type='submit']");
  submitButton.disabled = true;
  try {
    if (connection) {
      await postRemote("addMedicine", { name, timing: medicineTimingInput.value });
    } else {
      medicines.push({
        id: `medicine-${Date.now()}`,
        name,
        timing: medicineTimingInput.value,
      });
      saveJson(MEDICINE_KEY, medicines);
      renderMedicineMaster();
    }
    medicineForm.reset();
    medicineTimingInput.value = "朝";
    switchView("recordView");
  } catch {
    setSyncStatus("薬を追加できませんでした", "error");
  } finally {
    submitButton.disabled = false;
  }
});

saveButton.addEventListener("click", async () => {
  saveButton.disabled = true;
  try {
    if (connection) {
      await postRemote("addRecord", {
        date: dateValue.textContent,
        period: selectedPeriod,
      });
    } else {
      const medicineNames = medicines
        .filter((medicine) => medicine.timing === selectedPeriod)
        .map((medicine) => medicine.name)
        .join("、");
      history.unshift({
        id: `history-${Date.now()}`,
        date: dateValue.textContent,
        period: selectedPeriod,
        medicines: medicineNames,
      });
      history = history.slice(0, 20);
      saveJson(HISTORY_KEY, history);
      renderHistory();
    }
    saveButton.textContent = "記録しました";
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

dateValue.textContent = formatDate(new Date());
renderMedicineMaster();
renderHistory();
syncFromRemote().catch(() => {});

if ("serviceWorker" in navigator && window.location.protocol !== "file:") {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js").catch(() => {
      // The app remains usable online even if offline support cannot be registered.
    });
  });
}
