"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/data";
import { translateDbError } from "@/lib/errors";
import { fill } from "@/lib/i18n/dictionaries";
import { getI18n } from "@/lib/i18n/server";
import { lineTotalMinor, parseMoneyToMinor, parsePositiveInt, sumMinor } from "@/lib/numbers";

export type ProductOption = {
  id: string;
  sku: string;
  name: string;
  quantity_on_hand: number;
  unit_price_minor: number;
};

export type DraftLineInput = { product_id: string; quantity: string; unit_price: string };

export type InvoiceActionResult = {
  ok: boolean;
  message?: string;
  invoiceId?: string;
  totalMinor?: number;
  invoiceNumber?: string;
  alreadyProcessed?: boolean;
};

/** Product finder for the invoice editor (active products only). */
export async function searchProductsAction(query: string): Promise<ProductOption[]> {
  const { supabase } = await requireUser();
  const q = query.trim().slice(0, 64);
  let request = supabase
    .from("products")
    .select("id, sku, name, quantity_on_hand, unit_price_minor")
    .is("archived_at", null)
    .order("sku")
    .limit(8);
  if (q) {
    const escaped = q.replace(/[\\%_]/g, (c) => `\\${c}`).replace(/"/g, '\\"');
    request = request.or(`sku.ilike."${escaped}%",name.ilike."%${escaped}%"`);
  }
  const { data, error } = await request;
  if (error) return [];
  // Exact SKU match first, so "Enter" picks the product the owner typed.
  const rows = (data ?? []) as ProductOption[];
  return rows.sort((a, b) => Number(b.sku.toLowerCase() === q.toLowerCase()) - Number(a.sku.toLowerCase() === q.toLowerCase()));
}

/** Saves (creates or replaces) a draft. Drafts never change stock. */
export async function saveDraftAction(input: {
  invoiceId: string | null;
  customerName: string;
  notes: string;
  lines: DraftLineInput[];
}): Promise<InvoiceActionResult> {
  const { supabase } = await requireUser();
  const { t } = await getI18n();

  if (input.lines.length === 0) return { ok: false, message: t.errors.invoice_empty };
  const items = [];
  for (const line of input.lines) {
    const quantity = parsePositiveInt(line.quantity);
    if (quantity === null) return { ok: false, message: t.errors.invalid_quantity };
    const price = parseMoneyToMinor(line.unit_price);
    if (price === null) return { ok: false, message: t.errors.invalid_price };
    items.push({ product_id: line.product_id, quantity, unit_price_minor: price });
  }

  const { data, error } = await supabase.rpc("save_draft_invoice", {
    p_invoice_id: input.invoiceId,
    p_customer_name: input.customerName.slice(0, 200),
    p_notes: input.notes.slice(0, 2000),
    p_items: items,
  });
  if (error) return { ok: false, message: translateDbError(error, t) };

  revalidatePath("/invoices");
  return {
    ok: true,
    invoiceId: data as string,
    totalMinor: sumMinor(items.map((i) => lineTotalMinor(i.quantity, i.unit_price_minor))),
    message: t.invoices.draft_saved,
  };
}

/**
 * Issues a saved draft. All checks and the stock deduction happen inside one
 * database transaction (issue_invoice). Safe to call twice.
 */
export async function issueInvoiceAction(invoiceId: string, expectedTotalMinor: number): Promise<InvoiceActionResult> {
  const { supabase } = await requireUser();
  const { t } = await getI18n();
  const { data, error } = await supabase.rpc("issue_invoice", {
    p_invoice_id: invoiceId,
    p_expected_total_minor: expectedTotalMinor,
  });
  if (error) return { ok: false, invoiceId, message: translateDbError(error, t) };

  const result = data as { invoice_number: string; already_processed: boolean };
  revalidatePath("/", "layout");
  return {
    ok: true,
    invoiceId,
    invoiceNumber: result.invoice_number,
    alreadyProcessed: result.already_processed,
    message: result.already_processed
      ? t.invoices.already_issued
      : fill(t.invoices.issued_ok, { number: result.invoice_number }),
  };
}

export async function cancelInvoiceAction(invoiceId: string, reason: string): Promise<InvoiceActionResult> {
  const { supabase } = await requireUser();
  const { t } = await getI18n();
  const { data, error } = await supabase.rpc("cancel_invoice", {
    p_invoice_id: invoiceId,
    p_reason: reason.slice(0, 500),
  });
  if (error) return { ok: false, message: translateDbError(error, t) };
  const result = data as { already_processed: boolean };
  revalidatePath("/", "layout");
  return { ok: true, message: result.already_processed ? t.invoices.already_cancelled : t.invoices.cancelled_ok };
}

export async function deleteDraftAction(invoiceId: string): Promise<InvoiceActionResult> {
  const { supabase } = await requireUser();
  const { t } = await getI18n();
  const { error } = await supabase.rpc("delete_draft_invoice", { p_invoice_id: invoiceId });
  if (error) return { ok: false, message: translateDbError(error, t) };
  revalidatePath("/invoices");
  redirect("/invoices");
}
