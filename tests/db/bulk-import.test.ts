// Adding many products at once: same checks as one by one, all-or-nothing.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { anon, createProduct, createUser, expectDbError, movementsOf, pool, rpc, type Caller } from "./helpers";

let owner: Caller & { kind: "user" };

beforeEach(async () => {
  owner = await createUser();
});

afterAll(async () => {
  await pool.end();
});

const item = (sku: string, extra: Record<string, unknown> = {}) => ({
  sku,
  name: `Product ${sku}`,
  unit_price_minor: 1995,
  quantity: 3,
  cost_minor: null,
  ...extra,
});

async function countProducts(caller: Caller & { kind: "user" }) {
  const { rows } = await pool.query("select count(*)::int as n from products where owner_id = $1", [caller.id]);
  return rows[0].n as number;
}

describe("create_products_bulk", () => {
  it("creates every row with its opening-stock movement and keeps leading zeros", async () => {
    const items = Array.from({ length: 144 }, (_, i) => item(String(i).padStart(6, "0")));
    expect(await rpc(owner, "create_products_bulk", [JSON.stringify(items)])).toBe(144);
    expect(await countProducts(owner)).toBe(144);
    const { rows } = await pool.query("select id, sku, quantity_on_hand from products where owner_id = $1 and sku = '000007'", [owner.id]);
    expect(rows[0]).toMatchObject({ sku: "000007", quantity_on_hand: 3 });
    expect(await movementsOf(rows[0].id)).toEqual([
      expect.objectContaining({ movement_type: "initial", delta: 3, quantity_before: 0, quantity_after: 3 }),
    ]);
  });

  it("zero quantity creates no movement", async () => {
    await rpc(owner, "create_products_bulk", [JSON.stringify([item("Z", { quantity: 0 })])]);
    const { rows } = await pool.query("select id from products where owner_id = $1", [owner.id]);
    expect(await movementsOf(rows[0].id)).toEqual([]);
  });

  it("is all-or-nothing and reports the failing row", async () => {
    await createProduct(owner, { sku: "EXISTS" });
    const err = await expectDbError(
      rpc(owner, "create_products_bulk", [JSON.stringify([item("A"), item("B"), item("exists")])]),
      "duplicate_sku",
    );
    expect(JSON.parse(err.detail!)).toEqual({ line: 3, sku: "exists" });
    expect(await countProducts(owner)).toBe(1);
  });

  it("rejects a SKU repeated inside the same batch", async () => {
    const err = await expectDbError(rpc(owner, "create_products_bulk", [JSON.stringify([item("R-1"), item("r-1")])]), "duplicate_sku");
    expect(JSON.parse(err.detail!)).toMatchObject({ line: 2 });
    expect(await countProducts(owner)).toBe(0);
  });

  it.each([
    ["empty SKU", { sku: " " }],
    ["empty name", { name: "" }],
    ["negative quantity", { quantity: -1 }],
    ["decimal quantity", { quantity: 1.5 }],
    ["text price", { unit_price_minor: "19.95" }],
    ["negative cost", { cost_minor: -5 }],
    ["name too long", { name: "x".repeat(201) }],
  ])("rejects a row with %s", async (_label, extra) => {
    const err = await expectDbError(
      rpc(owner, "create_products_bulk", [JSON.stringify([item("OK"), item("BAD", extra)])]),
      "invalid_row",
    );
    expect(JSON.parse(err.detail!)).toMatchObject({ line: 2 });
    expect(await countProducts(owner)).toBe(0);
  });

  it("limits a batch to 1000 rows and rejects an empty batch", async () => {
    const many = Array.from({ length: 1001 }, (_, i) => item(`M${i}`));
    await expectDbError(rpc(owner, "create_products_bulk", [JSON.stringify(many)]), "too_many_rows");
    await expectDbError(rpc(owner, "create_products_bulk", [JSON.stringify([])]), "invalid_input");
    expect(await countProducts(owner)).toBe(0);
  });

  it("signed-out visitors cannot call it", async () => {
    await expectDbError(rpc(anon, "create_products_bulk", [JSON.stringify([item("X")])]), /permission denied/);
  });
});
