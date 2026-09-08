(function () {
  "use strict";

  const DATABASE_NAME = "medication-manager";
  const DATABASE_VERSION = 1;
  const STORES = {
    medicines: "medicines",
    records: "records",
    queue: "syncQueue",
    meta: "meta",
    conflicts: "conflicts",
  };

  let databasePromise;

  function open() {
    if (databasePromise) return databasePromise;
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("ローカルデータベースを更新できません"));
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORES.medicines)) {
          const store = database.createObjectStore(STORES.medicines, { keyPath: "id" });
          store.createIndex("byUpdatedAt", "updatedAt");
        }
        if (!database.objectStoreNames.contains(STORES.records)) {
          const store = database.createObjectStore(STORES.records, { keyPath: "id" });
          store.createIndex("byDate", "date");
          store.createIndex("byUpdatedAt", "updatedAt");
        }
        if (!database.objectStoreNames.contains(STORES.queue)) {
          const store = database.createObjectStore(STORES.queue, { keyPath: "changeId" });
          store.createIndex("byCreatedAt", "createdAt");
          store.createIndex("byEntity", ["entityType", "entityId"]);
        }
        if (!database.objectStoreNames.contains(STORES.meta)) {
          database.createObjectStore(STORES.meta, { keyPath: "key" });
        }
        if (!database.objectStoreNames.contains(STORES.conflicts)) {
          const store = database.createObjectStore(STORES.conflicts, { keyPath: "id" });
          store.createIndex("byCreatedAt", "createdAt");
        }
      };
      request.onsuccess = () => resolve(request.result);
    });
    return databasePromise;
  }

  function requestResult(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function transactionDone(transaction) {
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error("ローカル保存に失敗しました"));
    });
  }

  async function get(storeName, key) {
    const database = await open();
    return requestResult(database.transaction(storeName).objectStore(storeName).get(key));
  }

  async function getAll(storeName) {
    const database = await open();
    return requestResult(database.transaction(storeName).objectStore(storeName).getAll());
  }

  async function put(storeName, value) {
    const database = await open();
    const transaction = database.transaction(storeName, "readwrite");
    transaction.objectStore(storeName).put(value);
    await transactionDone(transaction);
    return value;
  }

  async function setMeta(key, value) {
    return put(STORES.meta, { key, value });
  }

  async function getMeta(key, fallback = null) {
    const item = await get(STORES.meta, key);
    return item ? item.value : fallback;
  }

  async function getRecentRecords(limit = 100, search = "") {
    const database = await open();
    const transaction = database.transaction(STORES.records);
    const index = transaction.objectStore(STORES.records).index("byDate");
    const query = search.trim().toLocaleLowerCase("ja");
    return new Promise((resolve, reject) => {
      const results = [];
      const request = index.openCursor(null, "prev");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor || results.length >= limit) {
          resolve(results);
          return;
        }
        const record = cursor.value;
        const text = `${record.date} ${record.period} ${record.medicines || ""}`.toLocaleLowerCase("ja");
        if (!record.deletedAt && (!query || text.includes(query))) results.push(record);
        cursor.continue();
      };
    });
  }

  async function getActiveMedicines() {
    const values = await getAll(STORES.medicines);
    return values
      .filter((value) => !value.deletedAt)
      .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0) || a.name.localeCompare(b.name, "ja"));
  }

  async function saveLocalChange(entityType, entity, operation) {
    const database = await open();
    const storeName = entityType === "record" ? STORES.records : STORES.medicines;
    const transaction = database.transaction([storeName, STORES.queue], "readwrite");
    const changeId = crypto.randomUUID();
    const queuedEntity = { ...entity, syncStatus: "pending" };
    const queueStore = transaction.objectStore(STORES.queue);
    const existing = await requestResult(
      queueStore.index("byEntity").getAll([entityType, entity.id]),
    );
    existing.forEach((item) => queueStore.delete(item.changeId));
    const baseVersion = existing.length
      ? Math.min(...existing.map((item) => Number(item.baseVersion || 0)))
      : Number(entity.version || 0);
    transaction.objectStore(storeName).put(queuedEntity);
    queueStore.put({
      changeId,
      entityType,
      entityId: entity.id,
      operation,
      baseVersion,
      entity: queuedEntity,
      createdAt: Date.now(),
      attempts: 0,
    });
    await transactionDone(transaction);
    return queuedEntity;
  }

  async function updateQueueAttempt(changeId) {
    const database = await open();
    const transaction = database.transaction(STORES.queue, "readwrite");
    const store = transaction.objectStore(STORES.queue);
    const item = await requestResult(store.get(changeId));
    if (item) store.put({ ...item, attempts: Number(item.attempts || 0) + 1, lastAttemptAt: Date.now() });
    await transactionDone(transaction);
  }

  async function applyRemoteChanges(changes) {
    if (!changes.length) return;
    const database = await open();
    const transaction = database.transaction(
      [STORES.records, STORES.medicines, STORES.queue, STORES.conflicts],
      "readwrite",
    );
    const records = transaction.objectStore(STORES.records);
    const medicines = transaction.objectStore(STORES.medicines);
    const queue = transaction.objectStore(STORES.queue);
    const conflicts = transaction.objectStore(STORES.conflicts);

    for (const change of changes) {
      const store = change.entityType === "record" ? records : medicines;
      const local = await requestResult(store.get(change.entityId));
      const queued = change.changeId ? await requestResult(queue.get(change.changeId)) : null;

      if (change.conflictPayload) {
        conflicts.put({
          id: change.changeId || crypto.randomUUID(),
          entityType: change.entityType,
          entityId: change.entityId,
          localCopy: change.conflictPayload,
          serverCopy: change.entity,
          createdAt: Number(change.updatedAt || Date.now()),
        });
      }

      const localIsPendingOtherChange = local?.syncStatus === "pending" && !queued;
      const remoteIsNewer = Number(change.version || 0) >= Number(local?.version || 0);
      if (!localIsPendingOtherChange && remoteIsNewer && change.entity) {
        store.put({ ...change.entity, version: Number(change.version || 0), syncStatus: "synced" });
      }
      if (queued) queue.delete(change.changeId);
    }
    await transactionDone(transaction);
  }

  async function importRemoteSnapshot(snapshot) {
    const database = await open();
    const transaction = database.transaction([STORES.records, STORES.medicines], "readwrite");
    const records = transaction.objectStore(STORES.records);
    const medicines = transaction.objectStore(STORES.medicines);
    let importedRecords = 0;
    let importedMedicines = 0;

    for (const remote of snapshot.history || []) {
      const local = await requestResult(records.get(remote.id));
      if (local?.syncStatus === "pending") continue;
      if (!local || Number(remote.updatedAt || 0) >= Number(local.updatedAt || 0)) {
        records.put(normalizeRemoteRecord(remote));
        importedRecords += 1;
      }
    }
    for (const remote of snapshot.medicines || []) {
      const local = await requestResult(medicines.get(remote.id));
      if (local?.syncStatus === "pending") continue;
      if (!local || Number(remote.updatedAt || 0) >= Number(local.updatedAt || 0)) {
        medicines.put(normalizeRemoteMedicine(remote));
        importedMedicines += 1;
      }
    }
    await transactionDone(transaction);
    return { importedRecords, importedMedicines };
  }

  function normalizeRemoteRecord(record) {
    const createdAt = Number(record.createdAt || Date.now());
    return {
      id: String(record.id),
      date: String(record.date),
      period: String(record.period),
      medicines: String(record.medicines || ""),
      medicineId: record.medicineId ? String(record.medicineId) : "",
      createdAt,
      updatedAt: Number(record.updatedAt || createdAt),
      deletedAt: record.deletedAt ? Number(record.deletedAt) : null,
      version: Number(record.version || 0),
      syncStatus: "synced",
    };
  }

  function normalizeRemoteMedicine(medicine) {
    const createdAt = Number(medicine.createdAt || Date.now());
    return {
      id: String(medicine.id),
      name: String(medicine.name),
      timing: String(medicine.timing),
      sortOrder: Number(medicine.sortOrder || 0),
      createdAt,
      updatedAt: Number(medicine.updatedAt || createdAt),
      deletedAt: medicine.deletedAt ? Number(medicine.deletedAt) : null,
      version: Number(medicine.version || 0),
      syncStatus: "synced",
    };
  }

  async function migrateLegacyLocalStorage() {
    if (await getMeta("legacyLocalStorageMigrated", false)) return;
    const read = (key, fallback) => {
      try {
        return JSON.parse(localStorage.getItem(key)) || fallback;
      } catch {
        return fallback;
      }
    };
    const medicines = read("medicationApp.medicines.v2", []);
    const history = read("medicationApp.history.v2", []);
    const pending = read("medicationApp.pendingRecords.v1", []);
    const pendingIds = new Set(pending.map((item) => item.id || item.record?.id));
    const now = Date.now();
    const database = await open();
    const transaction = database.transaction(
      [STORES.records, STORES.medicines, STORES.queue, STORES.meta],
      "readwrite",
    );
    const recordStore = transaction.objectStore(STORES.records);
    const medicineStore = transaction.objectStore(STORES.medicines);
    const queueStore = transaction.objectStore(STORES.queue);

    medicines.forEach((medicine, index) => medicineStore.put({
      id: String(medicine.id || crypto.randomUUID()),
      name: String(medicine.name || ""),
      timing: String(medicine.timing || "朝"),
      sortOrder: Number(medicine.sortOrder || index + 1),
      createdAt: Number(medicine.createdAt || now),
      updatedAt: Number(medicine.updatedAt || medicine.createdAt || now),
      deletedAt: null,
      version: Number(medicine.version || 0),
      syncStatus: "synced",
    }));
    history.forEach((record) => recordStore.put({
      id: String(record.id || crypto.randomUUID()),
      date: String(record.date || ""),
      period: String(record.period || "朝"),
      medicines: String(record.medicines || ""),
      medicineId: String(record.medicineId || ""),
      createdAt: Number(record.createdAt || now),
      updatedAt: Number(record.updatedAt || record.createdAt || now),
      deletedAt: null,
      version: Number(record.version || 0),
      syncStatus: pendingIds.has(record.id) ? "pending" : "synced",
    }));
    pending.forEach((item) => {
      const record = item.record || item;
      if (!record?.id) return;
      queueStore.put({
        changeId: crypto.randomUUID(),
        entityType: "record",
        entityId: String(record.id),
        operation: "upsert",
        baseVersion: Number(record.version || 0),
        entity: {
          ...record,
          createdAt: Number(record.createdAt || now),
          updatedAt: Number(record.updatedAt || now),
          deletedAt: null,
          version: Number(record.version || 0),
          syncStatus: "pending",
        },
        createdAt: now,
        attempts: 0,
      });
    });
    transaction.objectStore(STORES.meta).put({ key: "legacyLocalStorageMigrated", value: true });
    await transactionDone(transaction);
  }

  window.MedicationDB = {
    STORES,
    open,
    get,
    getAll,
    put,
    getMeta,
    setMeta,
    getRecentRecords,
    getActiveMedicines,
    saveLocalChange,
    updateQueueAttempt,
    applyRemoteChanges,
    importRemoteSnapshot,
    migrateLegacyLocalStorage,
  };
}());
