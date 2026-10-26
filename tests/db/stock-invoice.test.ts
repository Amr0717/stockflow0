// Acceptance tests for stock and invoice integrity. They run against a real
// PostgreSQL database with the real migrations, as role `authenticated`/`anon`,
// and always check the database state afterwards (not just return values).
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Client } from "pg";
import { testDbUrl } from "./config";
import {
  createProduct,
  createUser,
  draftTotal,
  expectDbError,
  issue,
  movementsOf,
  pool,
  rpc,
  runAs,
  saveDraft,
  setCaller,
  statusOf,
  stockOf,
  type Caller,
} from "./helpers";

let owner: Caller & { kind: "user" };

beforeEach(async () => {
  owner = await createUser();
});

afterAll(async () => {
  await pool.end();
});

describe("products", () => {
  it("keeps SKU '000123' exactly as text and finds it by search", async () => {
    const id = await createProduct(owner, { sku: "000123", qty: 1 });
    const rows = await runAs<{ sku: string }>(owner, "select sku from products where id = $1", [id]);
    expect(rows[0].sku).toBe("000123");
    const found = await runAs<{ id: string }>(owner, "select id from products where sku ilike $1", ["%0001%"]);
    expect(found.map((r) => r.id)).toContain(id);
  });

  it("rejects a duplicate SKU for the same owner (case-insensitive)", async () => {
    await createProduct(owner, { sku: "AB-1" });
    await expectDbError(createProduct(owner, { sku: "AB-1" }), "duplicate_sku");
    await expectDbError(createProduct(owner, { sku: "ab-1" }), "duplicate_sku");
  });

  it("allows the same SKU for a different owner", async () => {
    const other = await createUser();
    await createProduct(owner, { sku: "SAME" });
    await expect(createProduct(other, { sku: "SAME" })).resolves.toBeTruthy();
  });

  it("records the opening stock as an 'initial' movement", async () => {
    const id = await createProduct(owner, { qty: 50 });
    expect(await stockOf(id)).toBe(50);
    const moves = await movementsOf(id);
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({ movement_type: "initial", delta: 50, quantity_before: 0, quantity_after: 50 });
  });

  it("restock and adjustment are audited and can never go negative", async () => {
    const id = await createProduct(owner, { qty: 3 });
    await rpc(owner, "adjust_stock", [id, "restock", 7, "Supplier delivery"]);
    expect(await stockOf(id)).toBe(10);
    await rpc(owner, "adjust_stock", [id, "adjustment", -4, "Damaged"]);
    expect(await stockOf(id)).toBe(6);
    await expectDbError(rpc(owner, "adjust_stock", [id, "adjustment", -7, "Too many"]), "insufficient_stock");
    await expectDbError(rpc(owner, "adjust_stock", [id, "restock", -1, "x"]), "invalid_quantity");
    await expectDbError(rpc(owner, "adjust_stock", [id, "restock", 0, "x"]), "invalid_quantity");
    await expectDbError(rpc(owner, "adjust_stock", [id, "restock", 1, "  "]), "reason_required");
    await expectDbError(rpc(owner, "adjust_stock", [id, "sale", -1, "fake sale"]), "invalid_movement_type");
    expect(await stockOf(id)).toBe(6);
    const moves = await movementsOf(id);
    expect(moves.map((m) => [m.movement_type, m.delta])).toEqual([
      ["initial", 3],
      ["restock", 7],
      ["adjustment", -4],
    ]);
  });

  it("update_product cannot change quantity", async () => {
    const id = await createProduct(owner, { sku: "P1", qty: 9, price: 500 });
    await rpc(owner, "update_product", [id, "P1", "Renamed", null, 700, null, 2]);
    const { rows } = await pool.query("select name, unit_price_minor, quantity_on_hand from products where id=$1", [id]);
    expect(rows[0]).toMatchObject({ name: "Renamed", unit_price_minor: "700", quantity_on_hand: 9 });
  });
});

describe("invoices: draft and issue", () => {
  it("a draft invoice changes nothing", async () => {
    const a = await createProduct(owner, { qty: 50 });
    const inv = await saveDraft(owner, [{ product_id: a, quantity: 5, unit_price_minor: 1000 }]);
    expect(await statusOf(inv)).toBe("draft");
    expect(await stockOf(a)).toBe(50);
    expect((await movementsOf(a)).filter((m) => m.movement_type === "sale")).toHaveLength(0);
  });

  it("issuing 5 of 50 leaves 45 with exactly one sale movement", async () => {
    const a = await createProduct(owner, { qty: 50 });
    const inv = await saveDraft(owner, [{ product_id: a, quantity: 5, unit_price_minor: 1000 }]);
    const res = await issue(owner, inv);
    expect(res.status).toBe("issued");
    expect(res.invoice_number).toMatch(/^INV-\d{6}$/);
    // A fresh connection (= after refresh / another device) sees the same value.
    const fresh = new Client({ connectionString: testDbUrl() });
    await fresh.connect();
    const { rows } = await fresh.query("select quantity_on_hand from products where id=$1", [a]);
    await fresh.end();
    expect(rows[0].quantity_on_hand).toBe(45);
    const sales = (await movementsOf(a)).filter((m) => m.movement_type === "sale");
    expect(sales).toHaveLength(1);
    expect(sales[0]).toMatchObject({ delta: -5, quantity_before: 50, quantity_after: 45, invoice_id: inv });
  });

  it("fails atomically when one of two products lacks stock", async () => {
    const a = await createProduct(owner, { qty: 10 });
    const b = await createProduct(owner, { qty: 2 });
    const inv = await saveDraft(owner, [
      { product_id: a, quantity: 3, unit_price_minor: 100 },
      { product_id: b, quantity: 5, unit_price_minor: 100 },
    ]);
    const err = await expectDbError(issue(owner, inv), "insufficient_stock");
    expect(JSON.parse(err.detail!)).toMatchObject({ available: 2, requested: 5 });
    expect(await stockOf(a)).toBe(10);
    expect(await stockOf(b)).toBe(2);
    expect(await statusOf(inv)).toBe("draft");
    const { rows } = await pool.query("select count(*)::int as n from stock_movements where invoice_id=$1", [inv]);
    expect(rows[0].n).toBe(0);
  });

  it.each([
    ["zero", 0],
    ["negative", -1],
    ["fractional", 1.5],
    ["text", "2"],
    ["null", null],
  ])("rejects %s quantity", async (_label, quantity) => {
    const a = await createProduct(owner, { qty: 10 });
    await expectDbError(saveDraft(owner, [{ product_id: a, quantity, unit_price_minor: 100 }]), "invalid_quantity");
    expect(await stockOf(a)).toBe(10);
  });

  it("rejects quantity greater than available at issue time", async () => {
    const a = await createProduct(owner, { qty: 10 });
    const inv = await saveDraft(owner, [{ product_id: a, quantity: 11, unit_price_minor: 100 }]);
    await expectDbError(issue(owner, inv), "insufficient_stock");
    expect(await stockOf(a)).toBe(10);
  });

  it("checks the aggregate when the same SKU appears on two lines", async () => {
    const a = await createProduct(owner, { qty: 4 });
    const inv = await saveDraft(owner, [
      { product_id: a, quantity: 2, unit_price_minor: 100 },
      { product_id: a, quantity: 3, unit_price_minor: 100 },
    ]);
    const err = await expectDbError(issue(owner, inv), "insufficient_stock");
    expect(JSON.parse(err.detail!)).toMatchObject({ available: 4, requested: 5 });
    expect(await stockOf(a)).toBe(4);
  });

  it("repeating the issue request cannot subtract twice", async () => {
    const a = await createProduct(owner, { qty: 10 });
    const inv = await saveDraft(owner, [{ product_id: a, quantity: 3, unit_price_minor: 100 }]);
    const total = await draftTotal(inv);
    const first = await issue(owner, inv, total);
    const second = await issue(owner, inv, total);
    expect(first.already_processed).toBe(false);
    expect(second.already_processed).toBe(true);
    expect(second.invoice_number).toBe(first.invoice_number);
    expect(await stockOf(a)).toBe(7);
    expect((await movementsOf(a)).filter((m) => m.movement_type === "sale")).toHaveLength(1);
  });

  it("two tabs issuing the same invoice at the same time subtract once", async () => {
    const a = await createProduct(owner, { qty: 10 });
    const inv = await saveDraft(owner, [{ product_id: a, quantity: 3, unit_price_minor: 100 }]);
    const total = await draftTotal(inv);
    const results = await Promise.all(Array.from({ length: 8 }, () => issue(owner, inv, total)));
    expect(results.filter((r) => !r.already_processed)).toHaveLength(1);
    expect(await stockOf(a)).toBe(7);
    expect((await movementsOf(a)).filter((m) => m.movement_type === "sale")).toHaveLength(1);
  });

  it("refuses to issue if the draft total differs from what was reviewed", async () => {
    const a = await createProduct(owner, { qty: 10 });
    const inv = await saveDraft(owner, [{ product_id: a, quantity: 2, unit_price_minor: 100 }]);
    await expectDbError(issue(owner, inv, 100), "total_mismatch");
    expect(await stockOf(a)).toBe(10);
    expect(await statusOf(inv)).toBe("draft");
  });

  it("an issued invoice's lines and content cannot be edited", async () => {
    const a = await createProduct(owner, { qty: 10 });
    const inv = await saveDraft(owner, [{ product_id: a, quantity: 2, unit_price_minor: 100 }]);
    await issue(owner, inv);
    await expectDbError(saveDraft(owner, [{ product_id: a, quantity: 1, unit_price_minor: 1 }], inv), "invoice_not_draft");
    await expectDbError(rpc(owner, "delete_draft_invoice", [inv]), "invoice_not_draft");
    // Even the database owner (bypassing grants) is stopped by the triggers.
    await expectDbError(pool.query("update invoice_items set quantity = 1 where invoice_id=$1", [inv]), "immutable_record");
    await expectDbError(pool.query("update invoices set total_minor = 1 where id=$1", [inv]), "immutable_record");
    await expectDbError(pool.query("update invoices set status = 'draft' where id=$1", [inv]), "invalid_status_transition");
    await expectDbError(pool.query("delete from stock_movements where invoice_id=$1", [inv]), "immutable_record");
  });

  it("invoice numbers are sequential and unique under concurrency", async () => {
    const a = await createProduct(owner, { qty: 100 });
    const invoices: string[] = [];
    for (let i = 0; i < 6; i++) {
      invoices.push(await saveDraft(owner, [{ product_id: a, quantity: 1, unit_price_minor: 100 }]));
    }
    const results = await Promise.all(invoices.map((inv) => issue(owner, inv, 100)));
    const numbers = results.map((r) => r.invoice_number).sort();
    expect(numbers).toEqual(["INV-000001", "INV-000002", "INV-000003", "INV-000004", "INV-000005", "INV-000006"]);
    expect(await stockOf(a)).toBe(94);
  });
});

describe("concurrency: no overselling", () => {
  it("two competing invoices of 4 with stock 5: only one issues", async () => {
    const a = await createProduct(owner, { qty: 5 });
    const inv1 = await saveDraft(owner, [{ product_id: a, quantity: 4, unit_price_minor: 100 }]);
    const inv2 = await saveDraft(owner, [{ product_id: a, quantity: 4, unit_price_minor: 100 }]);

    // Deterministic race: tab 1 holds its transaction open; tab 2 must wait
    // on the row lock and then see the reduced stock.
    const tab1 = new Client({ connectionString: testDbUrl() });
    const tab2 = new Client({ connectionString: testDbUrl() });
    await Promise.all([tab1.connect(), tab2.connect()]);
    try {
      await tab1.query("begin");
      await setCaller(tab1, owner);
      await tab1.query("select public.issue_invoice($1, 400)", [inv1]);

      await tab2.query("begin");
      await setCaller(tab2, owner);
      const tab2Result = tab2.query("select public.issue_invoice($1, 400)", [inv2]).then(
        () => "issued",
        (e: Error) => e.message,
      );
      await new Promise((r) => setTimeout(r, 300));
      await tab1.query("commit");
      expect(await tab2Result).toBe("insufficient_stock");
      await tab2.query("rollback");
    } finally {
      await Promise.all([tab1.end(), tab2.end()]);
    }

    expect(await stockOf(a)).toBe(1);
    expect(await statusOf(inv1)).toBe("issued");
    expect(await statusOf(inv2)).toBe("draft");
  });

  it("20 simultaneous one-unit invoices against stock 10: exactly 10 succeed, stock ends at 0", async () => {
    const a = await createProduct(owner, { qty: 10 });
    const invs: string[] = [];
    for (let i = 0; i < 20; i++) {
      invs.push(await saveDraft(owner, [{ product_id: a, quantity: 1, unit_price_minor: 100 }]));
    }
    const settled = await Promise.allSettled(invs.map((inv) => issue(owner, inv, 100)));
    const ok = settled.filter((s) => s.status === "fulfilled");
    const failed = settled.filter((s) => s.status === "rejected") as PromiseRejectedResult[];
    expect(ok).toHaveLength(10);
    expect(failed.every((f) => (f.reason as Error).message === "insufficient_stock")).toBe(true);
    expect(await stockOf(a)).toBe(0);
    expect((await movementsOf(a)).filter((m) => m.movement_type === "sale")).toHaveLength(10);
  });

  it("overlapping multi-product invoices in opposite line order do not deadlock", async () => {
    const a = await createProduct(owner, { qty: 100 });
    const b = await createProduct(owner, { qty: 100 });
    const invs: string[] = [];
    for (let i = 0; i < 10; i++) {
      const lines = [
        { product_id: a, quantity: 1, unit_price_minor: 100 },
        { product_id: b, quantity: 1, unit_price_minor: 100 },
      ];
      invs.push(await saveDraft(owner, i % 2 ? lines.reverse() : lines));
    }
    await Promise.all(invs.map((inv) => issue(owner, inv, 200)));
    expect(await stockOf(a)).toBe(90);
    expect(await stockOf(b)).toBe(90);
  });
});

describe("cancellation", () => {
  it("restores stock exactly once; a repeated cancel changes nothing", async () => {
    const a = await createProduct(owner, { qty: 10 });
    const inv = await saveDraft(owner, [{ product_id: a, quantity: 4, unit_price_minor: 100 }]);
    await issue(owner, inv);
    expect(await stockOf(a)).toBe(6);

    const first = await rpc<{ already_processed: boolean }>(owner, "cancel_invoice", [inv, "Customer returned"]);
    expect(first.already_processed).toBe(false);
    expect(await stockOf(a)).toBe(10);

    const second = await rpc<{ already_processed: boolean }>(owner, "cancel_invoice", [inv, "again"]);
    expect(second.already_processed).toBe(true);
    expect(await stockOf(a)).toBe(10);

    const moves = await movementsOf(a);
    expect(moves.filter((m) => m.movement_type === "cancellation")).toHaveLength(1);
    expect(moves.filter((m) => m.movement_type === "cancellation")[0]).toMatchObject({
      delta: 4,
      quantity_before: 6,
      quantity_after: 10,
      invoice_id: inv,
    });
    expect(await statusOf(inv)).toBe("cancelled");
    // The cancelled invoice and its lines are still there.
    const { rows } = await pool.query("select count(*)::int as n from invoice_items where invoice_id=$1", [inv]);
    expect(rows[0].n).toBe(1);
  });

  it("concurrent cancels restore once", async () => {
    const a = await createProduct(owner, { qty: 10 });
    const inv = await saveDraft(owner, [{ product_id: a, quantity: 4, unit_price_minor: 100 }]);
    await issue(owner, inv);
    await Promise.all(Array.from({ length: 6 }, () => rpc(owner, "cancel_invoice", [inv, null])));
    expect(await stockOf(a)).toBe(10);
    expect((await movementsOf(a)).filter((m) => m.movement_type === "cancellation")).toHaveLength(1);
  });

  it("a draft cannot be cancelled and a cancelled invoice cannot be re-issued", async () => {
    const a = await createProduct(owner, { qty: 10 });
    const inv = await saveDraft(owner, [{ product_id: a, quantity: 1, unit_price_minor: 100 }]);
    await expectDbError(rpc(owner, "cancel_invoice", [inv, null]), "invoice_not_issued");
    await issue(owner, inv);
    await rpc(owner, "cancel_invoice", [inv, null]);
    await expectDbError(issue(owner, inv, 100), "invoice_cancelled");
    expect(await stockOf(a)).toBe(10);
  });
});

describe("history and money", () => {
  it("issued invoice keeps the original name and price after the product is edited", async () => {
    const a = await createProduct(owner, { sku: "P-1", name: "Old name", qty: 10, price: 1995 });
    const inv = await saveDraft(owner, [{ product_id: a, quantity: 1, unit_price_minor: 1995 }]);
    await issue(owner, inv);
    await rpc(owner, "update_product", [a, "P-1-NEW", "New name", null, 2200, null, 5]);
    const rows = await runAs<{ sku: string; product_name: string; unit_price_minor: string; line_total_minor: string }>(
      owner,
      "select sku, product_name, unit_price_minor, line_total_minor from invoice_items where invoice_id=$1",
      [inv],
    );
    expect(rows[0]).toEqual({ sku: "P-1", product_name: "Old name", unit_price_minor: "1995", line_total_minor: "1995" });
  });

  it("totals are exact integer minor units across several lines with agorot", async () => {
    const a = await createProduct(owner, { qty: 100, price: 1995 });
    const b = await createProduct(owner, { qty: 100, price: 10 });
    const c = await createProduct(owner, { qty: 100, price: 33 });
    // 3 x 19.95 + 7 x 0.10 + 3 x 0.33 = 59.85 + 0.70 + 0.99 = 61.54
    const inv = await saveDraft(owner, [
      { product_id: a, quantity: 3, unit_price_minor: 1995 },
      { product_id: b, quantity: 7, unit_price_minor: 10 },
      { product_id: c, quantity: 3, unit_price_minor: 33 },
    ]);
    expect(await draftTotal(inv)).toBe(6154);
    await issue(owner, inv, 6154);
    const { rows } = await pool.query("select total_minor from invoices where id=$1", [inv]);
    expect(rows[0].total_minor).toBe("6154");
  });

  it("archiving keeps history readable and products are never hard-deleted", async () => {
    const a = await createProduct(owner, { qty: 10 });
    const inv = await saveDraft(owner, [{ product_id: a, quantity: 1, unit_price_minor: 100 }]);
    await issue(owner, inv);
    await rpc(owner, "set_product_archived", [a, true]);
    const items = await runAs(owner, "select * from invoice_items where invoice_id=$1", [inv]);
    expect(items).toHaveLength(1);
    // A hard delete is impossible even for the database owner while history exists.
    await expectDbError(pool.query("delete from products where id=$1", [a]), /foreign key/);
    // Archived products cannot be sold.
    const inv2 = await saveDraft(owner, [{ product_id: a, quantity: 1, unit_price_minor: 100 }]).catch((e) => e);
    expect((inv2 as Error).message).toBe("product_archived");
  });

  it("cannot issue a draft whose product was archived after the draft was saved", async () => {
    const a = await createProduct(owner, { qty: 10 });
    const inv = await saveDraft(owner, [{ product_id: a, quantity: 1, unit_price_minor: 100 }]);
    await rpc(owner, "set_product_archived", [a, true]);
    await expectDbError(issue(owner, inv, 100), "product_archived");
    expect(await stockOf(a)).toBe(10);
  });
});
