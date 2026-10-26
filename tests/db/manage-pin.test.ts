// Management PIN: editing, archiving and deleting products require it, and
// deleting never breaks invoices or the stock history.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  createProduct,
  createUser,
  expectDbError,
  issue,
  movementsOf,
  pool,
  rpc,
  runAs,
  saveDraft,
  setPin,
  stockOf,
  TEST_PIN,
  type Caller,
} from "./helpers";

let owner: Caller & { kind: "user" };

beforeEach(async () => {
  owner = await createUser();
});

afterAll(async () => {
  await pool.end();
});

async function productRow(id: string) {
  const { rows } = await pool.query("select name, archived_at from products where id = $1", [id]);
  return rows[0] as { name: string; archived_at: Date | null } | undefined;
}

describe("setting the PIN", () => {
  it("protected operations are refused until a PIN is set", async () => {
    const id = await createProduct(owner, { name: "Before" });
    expect(await rpc(owner, "has_manage_pin", [])).toBe(false);
    await expectDbError(rpc(owner, "update_product", [id, "S", "After", null, 1, null, 1, "1212"]), "pin_not_set");
    await expectDbError(rpc(owner, "set_product_archived", [id, true, "1212"]), "pin_not_set");
    await expectDbError(rpc(owner, "delete_product", [id, "1212"]), "pin_not_set");
    expect(await productRow(id)).toMatchObject({ name: "Before", archived_at: null });
  });

  it("accepts 4 to 12 digits only", async () => {
    for (const bad of ["123", "abcd", "12 34", "1234567890123", "", null]) {
      await expectDbError(rpc(owner, "set_manage_pin", [null, bad]), "invalid_pin_format");
    }
    await setPin(owner, "1212");
    expect(await rpc(owner, "has_manage_pin", [])).toBe(true);
  });

  it("changing the PIN requires the current one", async () => {
    await setPin(owner, "1212");
    await expectDbError(rpc(owner, "set_manage_pin", [null, "5555"]), "invalid_pin");
    await expectDbError(rpc(owner, "set_manage_pin", ["0000", "5555"]), "invalid_pin");
    await rpc(owner, "set_manage_pin", ["1212", "5555"]);
    const id = await createProduct(owner);
    await expectDbError(rpc(owner, "set_product_archived", [id, true, "1212"]), "invalid_pin");
    await rpc(owner, "set_product_archived", [id, true, "5555"]);
  });

  it("the PIN hash is not readable through the Data API", async () => {
    await setPin(owner);
    await expectDbError(runAs(owner, "select * from private.owner_pins"), /permission denied/);
    const { rows } = await pool.query("select pin_hash from private.owner_pins where owner_id = $1", [owner.id]);
    expect(rows[0].pin_hash).not.toContain(TEST_PIN);
  });

  it("each owner has their own PIN", async () => {
    const other = await createUser();
    await setPin(owner, "1111");
    await setPin(other, "2222");
    const id = await createProduct(owner);
    await expectDbError(rpc(owner, "set_product_archived", [id, true, "2222"]), "invalid_pin");
  });
});

describe("edit and delete with the PIN", () => {
  beforeEach(async () => {
    await setPin(owner);
  });

  it("a wrong PIN changes nothing", async () => {
    const id = await createProduct(owner, { name: "Original", qty: 4 });
    await expectDbError(rpc(owner, "update_product", [id, "S", "Changed", null, 1, null, 1, "0000"]), "invalid_pin");
    await expectDbError(rpc(owner, "update_product", [id, "S", "Changed", null, 1, null, 1, null]), "invalid_pin");
    await expectDbError(rpc(owner, "set_product_archived", [id, true, "0000"]), "invalid_pin");
    await expectDbError(rpc(owner, "delete_product", [id, "0000"]), "invalid_pin");
    expect(await productRow(id)).toMatchObject({ name: "Original", archived_at: null });
    expect(await stockOf(id)).toBe(4);
  });

  it("the right PIN edits the product", async () => {
    const id = await createProduct(owner, { name: "Original" });
    await rpc(owner, "update_product", [id, "NEW-SKU", "Changed", null, 1, null, 1, TEST_PIN]);
    expect(await productRow(id)).toMatchObject({ name: "Changed" });
  });

  it("deletes a product nothing refers to", async () => {
    const id = await createProduct(owner, { qty: 0 });
    expect(await rpc(owner, "delete_product", [id, TEST_PIN])).toBe("deleted");
    expect(await productRow(id)).toBeUndefined();
  });

  it("archives (not deletes) a product with stock history, keeping the history", async () => {
    const id = await createProduct(owner, { qty: 7 });
    expect(await rpc(owner, "delete_product", [id, TEST_PIN])).toBe("archived");
    expect((await productRow(id))?.archived_at).not.toBeNull();
    expect(await movementsOf(id)).toHaveLength(1);
    expect(await stockOf(id)).toBe(7);
  });

  it("archives a product on an issued invoice; the invoice stays intact and it cannot be sold again", async () => {
    const id = await createProduct(owner, { sku: "KEEP-1", name: "Kept", qty: 10, price: 500 });
    const inv = await saveDraft(owner, [{ product_id: id, quantity: 2, unit_price_minor: 500 }]);
    await issue(owner, inv);
    expect(await rpc(owner, "delete_product", [id, TEST_PIN])).toBe("archived");

    const items = await runAs(owner, "select sku, product_name, quantity from invoice_items where invoice_id = $1", [inv]);
    expect(items).toEqual([{ sku: "KEEP-1", product_name: "Kept", quantity: 2 }]);
    await expectDbError(saveDraft(owner, [{ product_id: id, quantity: 1, unit_price_minor: 500 }]), "product_archived");

    // Cancelling the old invoice still restores the stock exactly once.
    await rpc(owner, "cancel_invoice", [inv, null]);
    expect(await stockOf(id)).toBe(10);
  });

  it("archives a product that is only on a draft, and that draft can no longer be issued", async () => {
    const id = await createProduct(owner, { qty: 0 });
    await rpc(owner, "adjust_stock", [id, "restock", 3, "delivery"]);
    const inv = await saveDraft(owner, [{ product_id: id, quantity: 1, unit_price_minor: 100 }]);
    expect(await rpc(owner, "delete_product", [id, TEST_PIN])).toBe("archived");
    await expectDbError(issue(owner, inv, 100), "product_archived");
    expect(await stockOf(id)).toBe(3);
  });

  it("restoring an archived product needs the PIN too", async () => {
    const id = await createProduct(owner, { qty: 1 });
    await rpc(owner, "delete_product", [id, TEST_PIN]);
    await expectDbError(rpc(owner, "set_product_archived", [id, false, "0000"]), "invalid_pin");
    await rpc(owner, "set_product_archived", [id, false, TEST_PIN]);
    expect((await productRow(id))?.archived_at).toBeNull();
  });
});
