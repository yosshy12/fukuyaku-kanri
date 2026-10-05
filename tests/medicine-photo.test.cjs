const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(process.env.TEST_URL || "http://127.0.0.1:4176/index.html");
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.getByRole("button", { name: "薬リスト", exact: true }).click();
    await page.locator("#medicineNameInput").fill("写真テスト薬");
    await page.locator("#medicinePhotoField input").setInputFiles(path.join(__dirname, "..", "icons", "icon-512.png"));
    await page.locator("#medicinePhotoField .photo-preview").waitFor({ state: "visible" });
    await page.getByRole("button", { name: "薬を追加する" }).click();
    const photo = page.getByRole("button", { name: "写真テスト薬の写真を拡大", exact: true });
    await photo.waitFor();
    const stored = await page.evaluate(async () => (await MedicationDB.getActiveMedicines())[0]);
    assert.match(stored.photo, /^data:image\/jpeg;base64,/);
    assert.ok(stored.photo.length <= 32000);
    assert.equal(await photo.locator("img").evaluate((img) => img.naturalWidth > 0), true);
    await photo.click();
    await page.locator("#photoDialog").waitFor({ state: "visible" });
    await page.getByRole("button", { name: "写真を閉じる" }).click();
    await page.reload();
    await page.getByRole("button", { name: "薬リスト", exact: true }).click();
    await photo.waitFor();
    await context.setOffline(true);
    await page.getByRole("button", { name: "写真テスト薬を編集", exact: true }).click();
    await page.locator("#medicineEditNameInput").fill("写真テスト薬変更");
    await page.getByRole("button", { name: "変更を保存", exact: true }).click();
    await page.getByRole("button", { name: "写真テスト薬変更の写真を拡大", exact: true }).waitFor();
    for (const width of [320, 390, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      const imageBounds = await page.locator("button.medicine-photo").boundingBox();
      assert.equal(imageBounds.width, imageBounds.height);
      fs.mkdirSync(path.join(__dirname, "..", ".test-artifacts"), { recursive: true });
      await page.screenshot({ path: path.join(__dirname, "..", ".test-artifacts", `medicine-photo-${width}.png`), fullPage: true });
    }
    await page.getByRole("button", { name: "写真テスト薬変更を編集", exact: true }).click();
    await page.getByRole("button", { name: "写真を削除", exact: true }).click();
    await page.getByRole("button", { name: "変更を保存", exact: true }).click();
    await page.getByText("写真なし", { exact: true }).waitFor();
    assert.equal(await page.evaluate(async () => (await MedicationDB.getActiveMedicines())[0].photo), "");
    assert.deepEqual(errors, []);

    const backend = vm.createContext({ console, Date });
    vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "apps-script", "Code.gs"), "utf8"), backend);
    backend.latestSyncState_ = () => ({ entity: { photo: stored.photo } });
    const entity = { ...stored, photo: undefined };
    assert.equal(backend.normalizeMedicineEntity_(entity, 2, Date.now(), null).photo, stored.photo, "Older clients preserve photos");
    assert.equal(backend.normalizeMedicineEntity_({ ...entity, photo: "" }, 2, Date.now(), null).photo, "");
    assert.throws(() => backend.validateMedicinePhoto_("https://example.com/photo.jpg"));
    assert.throws(() => backend.validateMedicinePhoto_("data:image/jpeg;base64," + "A".repeat(32000)));
    const row = [stored.id, stored.name, stored.timing, true, 1, new Date(), new Date()];
    assert.equal(backend.medicineFromRow_(row, 2, null).photo, stored.photo, "Conflict and sheet edits preserve photos");
    assert.equal(backend.medicineFromRow_(row, 2, null, stored.photo).photo, stored.photo, "Initial snapshot preserves photos");
    await page.evaluate(async (medicine) => {
      await MedicationDB.importRemoteSnapshot({ medicines: [{ ...medicine, id: "remote-photo" }] });
    }, stored);
    assert.equal(await page.evaluate(async () => (await MedicationDB.get("medicines", "remote-photo")).photo), stored.photo);
    console.log("PASS: photo add, resize, enlarge, reload, offline edit/remove, responsive layout, remote snapshot and server validation");
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
