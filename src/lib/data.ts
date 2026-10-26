import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { OwnerSettings } from "@/lib/types";
import { DEFAULT_TIMEZONE } from "@/lib/dates";

/**
 * Data Access Layer: every server page calls requireUser() first.
 * The Supabase client sends the user's JWT, so Postgres RLS limits every
 * query to the owner's own rows.
 */
export const requireUser = cache(async () => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (error || !claims?.sub) redirect("/login");
  return { supabase, userId: claims.sub as string, email: (claims.email as string | undefined) ?? "" };
});

const DEFAULT_SETTINGS: Omit<OwnerSettings, "owner_id"> = {
  business_name: "",
  business_address: "",
  business_phone: "",
  business_tax_id: "",
  invoice_footer: "",
  currency_code: "ILS",
  default_low_stock_threshold: 5,
  locale: "ar",
  timezone: DEFAULT_TIMEZONE,
  invoice_prefix: "INV-",
};

/** Owner settings, or defaults if the owner has not saved any yet. */
export const getSettings = cache(async (): Promise<OwnerSettings> => {
  const { supabase, userId } = await requireUser();
  const { data, error } = await supabase.from("owner_settings").select("*").maybeSingle();
  if (error) throw new Error(error.message);
  return data ?? { owner_id: userId, ...DEFAULT_SETTINGS };
});
