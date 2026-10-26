"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/data";
import { translateDbError } from "@/lib/errors";
import { dictionaries, isLocale } from "@/lib/i18n/dictionaries";
import { getI18n, LOCALE_COOKIE } from "@/lib/i18n/server";
import { CURRENCIES, parseNonNegativeInt } from "@/lib/numbers";

export type SettingsState = { ok?: boolean; message?: string; fieldErrors?: Record<string, string> };

export async function saveSettingsAction(_prev: SettingsState, formData: FormData): Promise<SettingsState> {
  const { supabase } = await requireUser();
  const { t } = await getI18n();
  const get = (k: string) => String(formData.get(k) ?? "").trim();

  const fieldErrors: Record<string, string> = {};
  const currency = get("currency_code");
  if (!(CURRENCIES as readonly string[]).includes(currency)) fieldErrors.currency_code = t.errors.invalid_input;
  const threshold = parseNonNegativeInt(get("default_low_stock_threshold"));
  if (threshold === null) fieldErrors.default_low_stock_threshold = t.errors.invalid_number;
  const locale = get("locale");
  if (!isLocale(locale)) fieldErrors.locale = t.errors.invalid_input;
  const prefix = get("invoice_prefix");
  if (!/^[A-Za-z0-9-]{0,12}$/.test(prefix)) fieldErrors.invoice_prefix = t.errors.invalid_input;
  if (Object.keys(fieldErrors).length) return { fieldErrors };

  const { error } = await supabase.rpc("update_owner_settings", {
    p_business_name: get("business_name"),
    p_business_address: get("business_address"),
    p_business_phone: get("business_phone"),
    p_business_tax_id: get("business_tax_id"),
    p_invoice_footer: get("invoice_footer"),
    p_currency_code: currency,
    p_default_low_stock_threshold: threshold,
    p_locale: locale,
    p_invoice_prefix: prefix,
  });
  if (error) return { message: translateDbError(error, t) };

  (await cookies()).set(LOCALE_COOKIE, locale, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  revalidatePath("/", "layout");
  // Confirm in the newly chosen language.
  return { ok: true, message: dictionaries[locale as "ar" | "en"].settings.saved };
}
