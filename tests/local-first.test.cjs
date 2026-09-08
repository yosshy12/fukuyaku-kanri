const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const baseUrl = process.env.TEST_URL || "http://127.0.0.1:4176/index.html";
const artifacts = path.join(__dirname, "..", ".test-artifacts");
fs.mkdirSync(artifacts, { recursive: true });

async function queueCount(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open("medication-manager");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const transaction = request.result.transaction("syncQueue");
      const count = transaction.objectStore("syncQueue").count();
      count.onerror = () => reject(count.error);
      count.onsuccess = () => resolve(count.result);
    };
  }));
}

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.evaluate(() => navigator.serviceWorker.ready);

  await page.getByRole("button", { name: "薬リスト" }).click();
  await page.locator("#medicineNameInput").fill("テスト薬");
  await page.locator("#medicineTimingInput").selectOption("朝");
  await page.getByRole("button", { name: "薬を追加する" }).click();
  await page.getByText("テスト薬", { exact: true }).waitFor();
  assert.equal(await queueCount(page), 1, "薬の追加は同期キューへ1件入る");

  await page.getByRole("button", { name: "テスト薬を編集" }).click();
  await page.locator("#medicineEditNameInput").fill("テスト薬・変更後");
  await page.getByRole("button", { name: "変更を保存" }).click();
  await page.getByText("テスト薬・変更後", { exact: true }).waitFor();
  assert.equal(await queueCount(page), 1, "同じ薬の連続編集はキューを重複させない");

  await page.getByRole("button", { name: "記録" }).click();
  await page.locator('[data-period="朝"]').click();
  await page.getByRole("button", { name: "記録する" }).click();
  await page.getByText("朝の服薬を記録", { exact: true }).waitFor();
  assert.equal(await queueCount(page), 2, "服薬記録が端末へ即時保存される");

  await page.getByRole("button", { name: "この記録を編集" }).click();
  await page.locator("#recordEditDateInput").fill("2026-09-09T20:00");
  await page.locator("#recordEditPeriodInput").selectOption("夜");
  await page.getByRole("button", { name: "変更を保存" }).click();
  await page.getByText("夜の服薬を記録", { exact: true }).waitFor();
  assert.equal(await queueCount(page), 2, "記録の編集も同じキュー項目へまとまる");

  await page.reload({ waitUntil: "networkidle" });
  await page.getByText("夜の服薬を記録", { exact: true }).waitFor();
  assert.equal(await queueCount(page), 2, "再起動後も未同期キューが残る");

  await page.reload({ waitUntil: "networkidle" });
  await context.setOffline(true);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByText("夜の服薬を記録", { exact: true }).waitFor();
  await page.screenshot({ path: path.join(artifacts, "local-first-mobile.png"), fullPage: true });

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "この記録を編集" }).click();
  await page.getByRole("button", { name: "この記録を削除" }).click();
  await page.getByText("夜の服薬を記録", { exact: true }).waitFor({ state: "detached" });
  assert.equal(await queueCount(page), 2, "オフライン削除も端末キューへ保存される");
  assert.match(await page.locator("#syncStatus").textContent(), /未同期 2件/);

  await context.setOffline(false);
  assert.deepEqual(pageErrors, [], `画面エラー: ${pageErrors.join(", ")}`);
  await browser.close();
  console.log("PASS: local-first add/edit/delete/reload/offline flow");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
