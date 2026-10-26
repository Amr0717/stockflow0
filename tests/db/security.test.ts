// Security tests: RLS, grants and RPC authorization for anon, the owner, and
// an unrelated signed-in user.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  anon,
  createProduct,
  createUser,
  expectDbError,
  issue,
  pool,
  rpc,
  runAs,
  saveDraft,
  stockOf,
  type Caller,
} from "./helpers";

const TABLES = ["products", "invoices", "invoice_items", "stock_movements", "owner_settings"];

let owner: Caller & { kind: "user" };
let stranger: Caller & { kind: "user" };
let productId: string;
let invoiceId: string;

beforeAll(async () => {
  owner = await createUser();
  stranger = await createUser();
  productId = await createProduct(owner, { sku: "SECRET-1", qty: 20 });
  await rpc(owner, "update_owner_settings", ["My shop", "", "", "", "", "ILS", 5, "ar", "INV-"]);
  invoiceId = await saveDraft(owner, [{ product_id: productId, quantity: 2, unit_price_minor: 100 }]);
  await issue(owner, invoiceId);
});

afterAll(async () => {
  await pool.end();
});

describe("signed-out visitor (anon)", () => {
  it.each(TABLES)("cannot read %s", async (table) => {
    await expectDbError(runAs(anon, `select * from public.${table}`), /permission denied/);
  });

  it("cannot call any operation", async () => {
    await expectDbError(rpc(anon, "create_product", ["X", "X", null, 1, null, 1, 1]), /permission denied/);
    await expectDbError(rpc(anon, "issue_invoice", [invoiceId, 200]), /permission denied/);
    await expectDbError(rpc(anon, "cancel_invoice", [invoiceId, null]), /permission denied/);
    await expectDbError(rpc(anon, "adjust_stock", [productId, "restock", 5, "x"]), /permission denied/);
    await expectDbError(rpc(anon, "get_dashboard_stats", []), /permission denied/);
  });
});

describe("unrelated signed-in user", () => {
  it.each(TABLES)("sees no rows of the owner in %s", async (table) => {
    const rows = await runAs(stranger, `select * from public.${table}`);
    expect(rows).toHaveLength(0);
  });

  it("cannot change the owner's stock or invoices through operations", async () => {
    await expectDbError(rpc(stranger, "adjust_stock", [productId, "restock", 5, "x"]), "product_not_found");
    await expectDbError(rpc(stranger, "update_product", [productId, "H", "Hacked", null, 1, null, 1]), "product_not_found");
    await expectDbError(rpc(stranger, "set_product_archived", [productId, true]), "product_not_found");
    await expectDbError(rpc(stranger, "cancel_invoice", [invoiceId, null]), "invoice_not_found");
    await expectDbError(rpc(stranger, "issue_invoice", [invoiceId, 200]), "invoice_not_found");
    await expectDbError(rpc(stranger, "delete_draft_invoice", [invoiceId]), "invoice_not_found");
    await expectDbError(
      rpc(stranger, "save_draft_invoice", [null, null, null, JSON.stringify([{ product_id: productId, quantity: 1, unit_price_minor: 1 }])]),
      "product_not_found",
    );
    expect(await stockOf(productId)).toBe(18);
  });

  it("dashboard stats only count the caller's own data", async () => {
    const stats = await rpc<Record<string, number>>(stranger, "get_dashboard_stats", []);
    expect(stats).toEqual({ active_products: 0, total_units: 0, issued_invoices: 0, low_stock: 0 });
  });
});

describe("owner", () => {
  it("can read own data", async () => {
    const rows = await runAs(owner, "select * from public.products");
    expect(rows).toHaveLength(1);
    const stats = await rpc<Record<string, number>>(owner, "get_dashboard_stats", []);
    expect(stats).toEqual({ active_products: 1, total_units: 18, issued_invoices: 1, low_stock: 0 });
  });

  it("cannot write tables directly (must use guarded operations)", async () => {
    await expectDbError(runAs(owner, "update public.products set quantity_on_hand = 9999 where id = $1", [productId]), /permission denied/);
    await expectDbError(runAs(owner, "update public.invoices set status = 'cancelled' where id = $1", [invoiceId]), /permission denied/);
    await expectDbError(
      runAs(owner, "insert into public.stock_movements (owner_id, product_id, movement_type, delta, quantity_before, quantity_after, reason, created_by) values ($1, $2, 'restock', 1, 0, 1, 'x', $1)", [owner.id, productId]),
      /permission denied/,
    );
    await expectDbError(runAs(owner, "delete from public.invoices where id = $1", [invoiceId]), /permission denied/);
    await expectDbError(runAs(owner, "update public.owner_settings set next_invoice_number = 1"), /permission denied/);
    expect(await stockOf(productId)).toBe(18);
  });

  it("cannot call internal helpers in the private schema", async () => {
    await expectDbError(runAs(owner, "select private.ensure_settings($1)", [owner.id]), /permission denied/);
  });
});

describe("grants and function hardening (catalog checks)", () => {
  it("anon has no table privileges; authenticated has SELECT only", async () => {
    const { rows } = await pool.query(
      `select grantee, table_name, privilege_type
       from information_schema.role_table_grants
       where table_schema = 'public' and grantee in ('anon', 'authenticated')`,
    );
    expect(rows.filter((r) => r.grantee === "anon")).toEqual([]);
    expect(new Set(rows.map((r) => r.privilege_type))).toEqual(new Set(["SELECT"]));
  });

  it("RLS is enabled on every public table", async () => {
    const { rows } = await pool.query(
      `select relname, relrowsecurity from pg_class
       where relnamespace = 'public'::regnamespace and relkind = 'r'`,
    );
    expect(rows.length).toBe(TABLES.length);
    expect(rows.every((r) => r.relrowsecurity)).toBe(true);
  });

  it("every public function pins search_path and is not executable by anon/public", async () => {
    const { rows } = await pool.query(
      `select p.proname,
              p.proconfig,
              has_function_privilege('anon', p.oid, 'execute') as anon_exec,
              has_function_privilege('public', p.oid, 'execute') as public_exec
       from pg_proc p where p.pronamespace = 'public'::regnamespace`,
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.proconfig, r.proname).toContain("search_path=\"\"");
      expect(r.anon_exec, r.proname).toBe(false);
      expect(r.public_exec, r.proname).toBe(false);
    }
  });
});
