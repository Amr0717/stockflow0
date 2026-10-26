// Browser smoke test of the real app (Playwright + Chromium).
// Runs the daily workflow and checks the DATABASE after each step.
//
// Required env:
//   APP_URL            e.g. http://127.0.0.1:3000 (app connected to a LOCAL/TEST Supabase)
//   E2E_EMAIL / E2E_PASSWORD               owner account
//   E2E_OTHER_EMAIL / E2E_OTHER_PASSWORD   a second, unrelated account
//   TEST_DATABASE_URL  direct Postgres URL of the same local/test database
// Optional: SCREENSHOT_DIR
//
// Never run this against production: it creates products and invoices.
import { createRequire } from "node:module";
import pg from "pg";
import { mkdirSync } from "node:fs";
import path from "node:path";

// Playwright is optional (install with: npm i -D playwright && npx playwright install chromium).
const { chromium } = createRequire(import.meta.url)("playwright");

const APP = process.env.APP_URL ?? "http://127.0.0.1:3000";
const SHOTS = process.env.SCREENSHOT_DIR ?? "test-results/screenshots";
mkdirSync(SHOTS, { recursive: true });
const db = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
await db.connect();

// Start in Arabic regardless of what a previous run saved.
await db.query("update public.owner_settings set locale = 'ar'");

const run = Date.now().toString().slice(-5);
const SKU_A = process.env.E2E_SKU_A ?? `000123-${run}`; // leading zeros must survive
const SKU_B = `B-${run}`;
const results = [];
let failed = false;

async function step(name, fn) {
  try {
    await fn();
    results.push(`PASS  ${name}`);
  } catch (err) {
    failed = true;
    await page?.screenshot({ path: path.join(SHOTS, `FAIL-${results.length + 1}.png`), fullPage: true }).catch(() => {});
    results.push(`FAIL  ${name}\n      ${String(err?.message ?? err).split("\n")[0]}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
async function stock(sku) {
  const { rows } = await db.query("select quantity_on_hand from public.products where sku = $1", [sku]);
  return rows[0]?.quantity_on_hand;
}
async function movementCount(sku, type) {
  const { rows } = await db.query(
    "select count(*)::int n from public.stock_movements m join public.products p on p.id = m.product_id where p.sku = $1 and m.movement_type = $2",
    [sku, type],
  );
  return rows[0].n;
}

const browser = await chromium.launch();
const context = await browser.newContext({ locale: "ar", viewport: { width: 1366, height: 900 } });
const page = await context.newPage();
page.setDefaultTimeout(15000);

async function login(p, email, password) {
  await p.goto(`${APP}/login`);
  await p.fill("#email", email);
  await p.fill("#password", password);
  await Promise.all([p.waitForURL(`${APP}/`), p.click("button[type=submit]")]);
}

async function addLine(sku, qty) {
  await page.fill("#product-search", sku);
  await page.waitForSelector(`[role=option]:has-text("${sku}")`);
  await page.press("#product-search", "Enter");
  const qtyInput = page.locator(`li:has-text("${sku}") input[inputmode=numeric]`);
  await qtyInput.fill(String(qty));
}

await step("signed-out visitor is redirected to /login; Arabic RTL by default", async () => {
  await page.goto(`${APP}/products`);
  assert(page.url().startsWith(`${APP}/login`), `expected /login, got ${page.url()}`);
  assert((await page.getAttribute("html", "dir")) === "rtl", "html dir should be rtl");
  assert((await page.getAttribute("html", "lang")) === "ar", "html lang should be ar");
  await page.screenshot({ path: path.join(SHOTS, "01-login-ar.png") });
});

await step("wrong password is rejected with a clear message", async () => {
  await page.fill("#email", process.env.E2E_EMAIL);
  await page.fill("#password", "wrong-password");
  await page.click("button[type=submit]");
  await page.waitForSelector("[role=alert]");
  assert(page.url().startsWith(`${APP}/login`), "should stay on login");
});

await step("owner signs in and sees the live dashboard", async () => {
  await login(page, process.env.E2E_EMAIL, process.env.E2E_PASSWORD);
  await page.waitForSelector("h1");
  await page.screenshot({ path: path.join(SHOTS, "02-dashboard-ar.png"), fullPage: true });
});

await step(`create product ${SKU_A} (qty 50, price 19.95) — SKU kept as text`, async () => {
  await page.goto(`${APP}/products/new`);
  await page.fill("#sku", SKU_A);
  await page.fill("#name", "قميص أزرق");
  await page.fill("#price", "19.95");
  await page.fill("#initial_quantity", "50");
  await Promise.all([page.waitForURL(/\/products\/[0-9a-f-]{36}/), page.click("main button[type=submit]")]);
  assert((await page.textContent("h1")).includes(SKU_A), "product heading shows SKU");
  assert((await stock(SKU_A)) === 50, "DB stock should be 50");
  assert((await movementCount(SKU_A, "initial")) === 1, "one initial movement");
});

await step("duplicate SKU is rejected", async () => {
  await page.goto(`${APP}/products/new`);
  await page.fill("#sku", SKU_A);
  await page.fill("#name", "Duplicate");
  await page.click("main button[type=submit]");
  await page.waitForSelector("text=موجود مسبقًا");
  const { rows } = await db.query("select count(*)::int n from public.products where sku = $1", [SKU_A]);
  assert(rows[0].n === 1, "still exactly one product with that SKU");
});

await step(`create product ${SKU_B} (qty 2, price 0.10)`, async () => {
  await page.goto(`${APP}/products/new`);
  await page.fill("#sku", SKU_B);
  await page.fill("#name", "Cable");
  await page.fill("#price", "0.10");
  await page.fill("#initial_quantity", "2");
  await Promise.all([page.waitForURL(/\/products\/[0-9a-f-]{36}/), page.click("main button[type=submit]")]);
  assert((await stock(SKU_B)) === 2, "DB stock should be 2");
});

await step("search finds the product by SKU", async () => {
  await page.goto(`${APP}/products?q=${encodeURIComponent(SKU_A)}`);
  await page.waitForSelector(`text=${SKU_A}`);
  await page.screenshot({ path: path.join(SHOTS, "03-inventory-ar.png"), fullPage: true });
});

let invoiceUrl = "";
await step("issue invoice: 5 × 19.95 + 1 × 0.10 = 99.85; stock 50 → 45, one sale movement", async () => {
  await page.goto(`${APP}/invoices/new`);
  await addLine(SKU_A, 5);
  await addLine(SKU_B, 1);
  await page.fill("#customer", "أحمد");
  await page.waitForFunction(() => document.body.innerText.includes("99.85"));
  await page.screenshot({ path: path.join(SHOTS, "04-invoice-editor-ar.png"), fullPage: true });
  await page.click("button:has-text('إصدار الفاتورة')");
  await page.waitForSelector("dialog[open]");
  await Promise.all([
    page.waitForURL(/\/invoices\/[0-9a-f-]{36}\?issued=1/),
    page.click("dialog[open] button:has-text('إصدار الفاتورة')"),
  ]);
  invoiceUrl = page.url().split("?")[0];
  assert((await stock(SKU_A)) === 45, `DB stock A should be 45, got ${await stock(SKU_A)}`);
  assert((await stock(SKU_B)) === 1, "DB stock B should be 1");
  assert((await movementCount(SKU_A, "sale")) === 1, "exactly one sale movement for A");
  const { rows } = await db.query(
    "select total_minor, status, invoice_number from public.invoices where id = $1",
    [invoiceUrl.split("/").pop()],
  );
  assert(rows[0].status === "issued" && Number(rows[0].total_minor) === 9985, "invoice issued with total 9985");
});

await step("issued invoice persists after reload and prints to an A4 PDF", async () => {
  await page.goto(invoiceUrl);
  await page.waitForSelector("text=99.85");
  await page.screenshot({ path: path.join(SHOTS, "05-invoice-issued-ar.png"), fullPage: true });
  await page.emulateMedia({ media: "print" });
  await page.screenshot({ path: path.join(SHOTS, "06-invoice-print-preview-ar.png"), fullPage: true });
  await page.pdf({ path: path.join(SHOTS, "invoice-ar.pdf"), format: "A4", printBackground: true });
  await page.emulateMedia({ media: "screen" });
});

await step("a saved draft does not change stock", async () => {
  await page.goto(`${APP}/invoices/new`);
  await addLine(SKU_A, 3);
  await page.click("button:has-text('حفظ كمسودة')");
  await page.waitForSelector("text=تم حفظ المسودة");
  assert((await stock(SKU_A)) === 45, "stock unchanged by draft");
});

await step("cannot issue more than available (button disabled, warning shown)", async () => {
  await page.goto(`${APP}/invoices/new`);
  await addLine(SKU_B, 5);
  await page.waitForSelector("text=المتوفر 1 فقط");
  assert(await page.isDisabled("button:has-text('إصدار الفاتورة')"), "issue button disabled");
  assert((await stock(SKU_B)) === 1, "stock B unchanged");
});

await step("editing the product price does not change the issued invoice", async () => {
  const { rows } = await db.query("select id from public.products where sku = $1", [SKU_A]);
  await page.goto(`${APP}/products/${rows[0].id}`);
  await page.fill("#price", "22.00");
  await page.click("main form button[type=submit]:has-text('حفظ')");
  await page.waitForSelector("text=تم تحديث المنتج");
  await page.goto(invoiceUrl);
  await page.waitForSelector("text=19.95");
  assert(!(await page.textContent("article")).includes("22.00"), "invoice must keep 19.95");
});

await step("restock is audited with a reason", async () => {
  const { rows } = await db.query("select id from public.products where sku = $1", [SKU_B]);
  await page.goto(`${APP}/products/${rows[0].id}`);
  await page.fill("#amount", "10");
  await page.fill("#reason", "توريد من المورد");
  await page.click("button:has-text('تسجيل العملية')");
  await page.waitForSelector("dialog[open]");
  await page.click("dialog[open] button:has-text('تأكيد')");
  await page.waitForSelector("text=تم تحديث المخزون");
  assert((await stock(SKU_B)) === 11, "stock B 1 → 11");
  assert((await movementCount(SKU_B, "restock")) === 1, "one restock movement");
});

await step("cancel the issued invoice: stock restored once (45 → 50)", async () => {
  await page.goto(invoiceUrl);
  await page.click("button:has-text('إلغاء الفاتورة')");
  await page.waitForSelector("dialog[open]");
  await page.fill("#cancel-reason", "إرجاع من الزبون");
  await page.click("dialog[open] button:has-text('إلغاء الفاتورة')");
  await page.waitForSelector("text=تم إلغاء الفاتورة");
  assert((await stock(SKU_A)) === 50, `stock A should be 50, got ${await stock(SKU_A)}`);
  assert((await movementCount(SKU_A, "cancellation")) === 1, "one cancellation movement");
  await page.reload();
  await page.waitForSelector("article");
  assert((await page.locator("button:visible:has-text('إلغاء الفاتورة')").count()) === 0, "no cancel button on a cancelled invoice");
  await page.screenshot({ path: path.join(SHOTS, "07-invoice-cancelled-ar.png"), fullPage: true });
});

await step("stock history lists sale, cancellation and restock", async () => {
  await page.goto(`${APP}/movements`);
  for (const label of ["بيع", "إلغاء فاتورة", "توريد"]) await page.waitForSelector(`table >> text=${label}`);
  await page.screenshot({ path: path.join(SHOTS, "08-movements-ar.png"), fullPage: true });
});

await step("double-clicking the issue button deducts stock only once (50 → 48)", async () => {
  const before = await movementCount(SKU_A, "sale");
  await page.goto(`${APP}/invoices/new`);
  await addLine(SKU_A, 2);
  await page.click("button:has-text('إصدار الفاتورة')");
  await page.waitForSelector("dialog[open]");
  await Promise.all([
    page.waitForURL(/\/invoices\/[0-9a-f-]{36}\?issued=1/),
    page.dblclick("dialog[open] button:has-text('إصدار الفاتورة')"),
  ]);
  await page.waitForTimeout(1500); // give a duplicate request time to land, if one was sent
  assert((await stock(SKU_A)) === 48, `DB stock A should be 48, got ${await stock(SKU_A)}`);
  assert((await movementCount(SKU_A, "sale")) === before + 1, "exactly one new sale movement");
});

await step("language switch: English uses LTR", async () => {
  await page.goto(`${APP}/`);
  await page.click("aside button[aria-label='تغيير اللغة']");
  await page.waitForFunction(() => document.documentElement.dir === "ltr");
  await page.waitForSelector("aside >> text=Inventory");
  await page.screenshot({ path: path.join(SHOTS, "09-dashboard-en.png"), fullPage: true });
  await page.goto(invoiceUrl);
  await page.pdf({ path: path.join(SHOTS, "invoice-en.pdf"), format: "A4", printBackground: true });
  await page.click("aside button[aria-label='Switch language']");
  await page.waitForFunction(() => document.documentElement.dir === "rtl");
});

await step("mobile: menu drawer opens and navigation works", async () => {
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await mobile.addCookies(await context.cookies());
  const m = await mobile.newPage();
  await m.goto(`${APP}/`);
  await m.screenshot({ path: path.join(SHOTS, "10-mobile-dashboard-ar.png"), fullPage: true });
  await m.click("header button[aria-expanded]");
  await m.waitForSelector("#mobile-drawer");
  await m.screenshot({ path: path.join(SHOTS, "11-mobile-menu-ar.png") });
  await m.click("#mobile-drawer >> text=سجل المخزون");
  await m.waitForURL(`${APP}/movements`);
  assert((await m.locator("#mobile-drawer").count()) === 0, "drawer closes after navigation");
  await m.goto(`${APP}/invoices/new`);
  await m.screenshot({ path: path.join(SHOTS, "12-mobile-new-invoice-ar.png"), fullPage: true });
  const overflow = await m.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  assert(!overflow, "no horizontal page scroll on mobile");
  await mobile.close();
});

await step("sign out, then protected pages redirect to login", async () => {
  await page.goto(`${APP}/settings`);
  await page.click("aside button:has-text('تسجيل الخروج')");
  await page.waitForURL(`${APP}/login`);
  await page.goto(`${APP}/invoices`);
  assert(page.url().startsWith(`${APP}/login`), "redirected after sign-out");
});

await step("an unrelated signed-in user sees none of the owner's data", async () => {
  const other = await browser.newContext({ locale: "ar" });
  const p = await other.newPage();
  await login(p, process.env.E2E_OTHER_EMAIL, process.env.E2E_OTHER_PASSWORD);
  await p.goto(`${APP}/products?q=${encodeURIComponent(SKU_A)}`);
  assert((await p.locator(`text=${SKU_A}`).count()) === 0, "stranger must not see owner's product");
  await p.goto(invoiceUrl);
  assert((await p.textContent("body")).includes("404"), "stranger gets 404 for owner's invoice");
  await other.close();
});

await browser.close();
await db.end();
console.log(results.join("\n"));
console.log(failed ? "\nSMOKE TEST FAILED" : `\nAll ${results.length} smoke steps passed.`);
process.exit(failed ? 1 : 0);
