import { fill, type Dictionary } from "@/lib/i18n/dictionaries";

type DbError = { message?: string; code?: string; details?: string | null } | null | undefined;

const KNOWN = new Set([
  "not_authenticated",
  "duplicate_sku",
  "invalid_quantity",
  "invalid_price",
  "insufficient_stock",
  "product_not_found",
  "product_archived",
  "invoice_not_found",
  "invoice_not_draft",
  "invoice_not_issued",
  "invoice_cancelled",
  "invoice_empty",
  "too_many_items",
  "total_mismatch",
  "reason_required",
  "invalid_movement_type",
  "invalid_pin",
  "pin_not_set",
  "invalid_pin_format",
  "invalid_row",
  "too_many_rows",
  "invalid_input",
]);

/**
 * Turns a database error (from a guarded function) into a friendly,
 * translated message. Unknown errors are logged on the server only.
 */
export function translateDbError(error: DbError, t: Dictionary): string {
  const code = error?.message ?? "";
  if (!KNOWN.has(code)) {
    // 23514 = check constraint, 22P02 = invalid text representation
    if (error?.code === "23514" || error?.code === "22P02" || error?.code === "22003") {
      return t.errors.invalid_input;
    }
    if (error?.code === "PGRST301" || error?.code === "42501") return t.errors.not_authenticated;
    console.error("Unexpected database error", { code: error?.code, message: error?.message });
    return t.errors.unknown;
  }

  let detail: Record<string, string | number> = {};
  try {
    detail = error?.details ? JSON.parse(error.details) : {};
  } catch {
    detail = {};
  }

  if (code === "insufficient_stock" && detail.sku === undefined) {
    return t.errors.insufficient_stock_simple;
  }
  return fill(t.errors[code as keyof Dictionary["errors"]], detail);
}
