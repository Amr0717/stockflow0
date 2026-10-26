import { randomUUID } from "node:crypto";
import { Client, Pool } from "pg";
import { testDbUrl } from "./config";

export const pool = new Pool({ connectionString: testDbUrl(), max: 30 });

export type Caller = { kind: "anon" } | { kind: "user"; id: string };
export const anon: Caller = { kind: "anon" };

/** Creates a row in auth.users (like the Supabase dashboard "Add user"). */
export async function createUser(): Promise<Caller & { kind: "user" }> {
  const id = randomUUID();
  await pool.query("insert into auth.users (id, email) values ($1, $2)", [id, `${id}@test.local`]);
  return { kind: "user", id };
}

/**
 * Runs SQL exactly the way a request through the Supabase Data API runs:
 * inside a transaction, as role anon/authenticated, with JWT claims set.
 */
export async function runAs<T = Record<string, unknown>>(
  caller: Caller,
  sql: string,
  params: unknown[] = [],
  client?: Client,
): Promise<T[]> {
  const conn = client ?? (await pool.connect());
  try {
    await conn.query("begin");
    await setCaller(conn, caller);
    const res = await conn.query(sql, params);
    await conn.query("commit");
    return res.rows as T[];
  } catch (err) {
    await conn.query("rollback");
    throw err;
  } finally {
    if (!client) (conn as unknown as { release: () => void }).release();
  }
}

export async function setCaller(conn: { query: Client["query"] }, caller: Caller) {
  if (caller.kind === "anon") {
    await conn.query("set local role anon");
  } else {
    await conn.query("set local role authenticated");
    // PostgREST sets request.jwt.claims; older auth.uid() versions read request.jwt.claim.sub.
    await conn.query(
      "select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true)",
      [JSON.stringify({ sub: caller.id, role: "authenticated" }), caller.id],
    );
  }
}

/** Calls a public function as the caller and returns its single value. */
export async function rpc<T = unknown>(caller: Caller, fn: string, args: unknown[]): Promise<T> {
  const placeholders = args.map((_, i) => `$${i + 1}`).join(", ");
  const rows = await runAs<{ result: T }>(caller, `select public.${fn}(${placeholders}) as result`, args);
  return rows[0].result;
}

export async function createProduct(
  owner: Caller,
  opts: { sku?: string; name?: string; price?: number; qty?: number } = {},
): Promise<string> {
  return rpc<string>(owner, "create_product", [
    opts.sku ?? `SKU-${randomUUID().slice(0, 8)}`,
    opts.name ?? "Test product",
    null,
    opts.price ?? 1000,
    null,
    5,
    opts.qty ?? 0,
  ]);
}

export type Line = { product_id: string; quantity: unknown; unit_price_minor: unknown };

export async function saveDraft(owner: Caller, items: Line[], invoiceId: string | null = null) {
  return rpc<string>(owner, "save_draft_invoice", [invoiceId, "Customer", null, JSON.stringify(items)]);
}

export async function draftTotal(invoiceId: string): Promise<number> {
  const { rows } = await pool.query("select total_minor from invoices where id = $1", [invoiceId]);
  return Number(rows[0].total_minor);
}

export async function issue(owner: Caller, invoiceId: string, expected?: number) {
  return rpc<{ invoice_number: string; already_processed: boolean; status: string }>(
    owner,
    "issue_invoice",
    [invoiceId, expected ?? (await draftTotal(invoiceId))],
  );
}

/** Reads directly as the database owner (bypasses RLS) to verify real state. */
export async function stockOf(productId: string): Promise<number> {
  const { rows } = await pool.query("select quantity_on_hand from products where id = $1", [productId]);
  return rows[0].quantity_on_hand;
}

export async function movementsOf(productId: string) {
  const { rows } = await pool.query(
    "select movement_type, delta, quantity_before, quantity_after, invoice_id from stock_movements where product_id = $1 order by created_at, id",
    [productId],
  );
  return rows as {
    movement_type: string;
    delta: number;
    quantity_before: number;
    quantity_after: number;
    invoice_id: string | null;
  }[];
}

export async function statusOf(invoiceId: string): Promise<string> {
  const { rows } = await pool.query("select status from invoices where id = $1", [invoiceId]);
  return rows[0].status;
}

/** Asserts that a promise rejects with a Postgres error whose message matches. */
export async function expectDbError(promise: Promise<unknown>, message: RegExp | string) {
  try {
    await promise;
  } catch (err) {
    const msg = (err as Error).message;
    const ok = typeof message === "string" ? msg === message : message.test(msg);
    if (!ok) throw new Error(`Expected error ${message}, got: ${msg}`);
    return err as Error & { code?: string; detail?: string };
  }
  throw new Error(`Expected error ${message}, but the call succeeded`);
}

/** The management PIN the tests use (set with setPin). */
export const TEST_PIN = "4321";

/** Sets the caller's management PIN for the first time. */
export async function setPin(caller: Caller, pin = TEST_PIN) {
  await rpc(caller, "set_manage_pin", [null, pin]);
}
