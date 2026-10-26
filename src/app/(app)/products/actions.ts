"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/data";
import { translateDbError } from "@/lib/errors";
import { fill } from "@/lib/i18n/dictionaries";
import { getI18n } from "@/lib/i18n/server";
import { parseMoneyToMinor, parseNonNegativeInt, parsePositiveInt } from "@/lib/numbers";

export type FormState = {
  ok?: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
  values?: Record<string, string>;
};

function text(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}

/** Shared validation for create/edit. The database re-checks everything. */
async function readProductForm(formData: FormData, withInitialQuantity: boolean) {
  const { t } = await getI18n();
  const values = {
    sku: text(formData, "sku"),
    name: text(formData, "name"),
    description: text(formData, "description"),
    price: text(formData, "price"),
    cost: text(formData, "cost"),
    threshold: text(formData, "threshold"),
    initial_quantity: text(formData, "initial_quantity"),
  };
  const fieldErrors: Record<string, string> = {};

  if (!values.sku) fieldErrors.sku = t.errors.required;
  else if (values.sku.length > 64) fieldErrors.sku = t.errors.invalid_input;
  if (!values.name) fieldErrors.name = t.errors.required;
  else if (values.name.length > 200) fieldErrors.name = t.errors.invalid_input;

  const price = parseMoneyToMinor(values.price || "0");
  if (price === null) fieldErrors.price = t.errors.invalid_price;

  const cost = values.cost ? parseMoneyToMinor(values.cost) : null;
  if (values.cost && cost === null) fieldErrors.cost = t.errors.invalid_price;

  const threshold = parseNonNegativeInt(values.threshold || "0");
  if (threshold === null) fieldErrors.threshold = t.errors.invalid_number;

  const initialQuantity = withInitialQuantity ? parseNonNegativeInt(values.initial_quantity || "0") : 0;
  if (initialQuantity === null) fieldErrors.initial_quantity = t.errors.invalid_number;

  return { t, values, fieldErrors, price, cost, threshold, initialQuantity };
}

export async function createProductAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { supabase } = await requireUser();
  const f = await readProductForm(formData, true);
  if (Object.keys(f.fieldErrors).length) return { fieldErrors: f.fieldErrors, values: f.values };

  const { data, error } = await supabase.rpc("create_product", {
    p_sku: f.values.sku,
    p_name: f.values.name,
    p_description: f.values.description || null,
    p_unit_price_minor: f.price,
    p_cost_minor: f.cost,
    p_low_stock_threshold: f.threshold,
    p_initial_quantity: f.initialQuantity,
  });
  if (error) {
    const message = translateDbError(error, f.t);
    return {
      message,
      values: f.values,
      fieldErrors: error.message === "duplicate_sku" ? { sku: message } : undefined,
    };
  }
  revalidatePath("/products");
  redirect(`/products/${data}?created=1`);
}

export async function updateProductAction(productId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const { supabase } = await requireUser();
  const f = await readProductForm(formData, false);
  if (Object.keys(f.fieldErrors).length) return { fieldErrors: f.fieldErrors, values: f.values };

  const { error } = await supabase.rpc("update_product", {
    p_product_id: productId,
    p_sku: f.values.sku,
    p_name: f.values.name,
    p_description: f.values.description || null,
    p_unit_price_minor: f.price,
    p_cost_minor: f.cost,
    p_low_stock_threshold: f.threshold,
  });
  if (error) {
    const message = translateDbError(error, f.t);
    return {
      message,
      values: f.values,
      fieldErrors: error.message === "duplicate_sku" ? { sku: message } : undefined,
    };
  }
  revalidatePath("/products");
  revalidatePath(`/products/${productId}`);
  return { ok: true, message: f.t.products.updated_ok, values: f.values };
}

export async function setArchivedAction(productId: string, archived: boolean): Promise<FormState> {
  const { supabase } = await requireUser();
  const { t } = await getI18n();
  const { error } = await supabase.rpc("set_product_archived", { p_product_id: productId, p_archived: archived });
  if (error) return { message: translateDbError(error, t) };
  revalidatePath("/products");
  revalidatePath(`/products/${productId}`);
  return { ok: true, message: archived ? t.products.archived_ok : t.products.restored_ok };
}

export async function adjustStockAction(productId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const { supabase } = await requireUser();
  const { t } = await getI18n();
  const values = {
    type: text(formData, "type"),
    direction: text(formData, "direction"),
    amount: text(formData, "amount"),
    reason: text(formData, "reason"),
  };
  const fieldErrors: Record<string, string> = {};
  const amount = parsePositiveInt(values.amount);
  if (amount === null) fieldErrors.amount = t.errors.invalid_quantity;
  if (!values.reason) fieldErrors.reason = t.errors.reason_required;
  if (values.type !== "restock" && values.type !== "adjustment") fieldErrors.type = t.errors.invalid_movement_type;
  if (Object.keys(fieldErrors).length) return { fieldErrors, values };

  const delta = values.type === "adjustment" && values.direction === "decrease" ? -amount! : amount!;
  const { data, error } = await supabase.rpc("adjust_stock", {
    p_product_id: productId,
    p_movement_type: values.type,
    p_delta: delta,
    p_reason: values.reason,
  });
  if (error) return { message: translateDbError(error, t), values };

  revalidatePath("/products");
  revalidatePath(`/products/${productId}`);
  const result = data as { quantity_before: number; quantity_after: number };
  return {
    ok: true,
    message: fill(t.stock.done, { before: result.quantity_before, after: result.quantity_after }),
    values: { type: values.type, direction: "increase", amount: "", reason: "" },
  };
}
