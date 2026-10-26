"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { isLocale } from "@/lib/i18n/dictionaries";
import { getI18n, LOCALE_COOKIE } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";

export type LoginState = { error?: string; email?: string };

export async function signInAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const { t } = await getI18n();
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { error: t.errors.required, email };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    // Same message for every failure, so the form does not reveal which accounts exist.
    return { error: error.status && error.status >= 500 ? t.errors.network : t.auth.invalid, email };
  }

  // Use the language the owner saved in Settings.
  const { data: settings } = await supabase.from("owner_settings").select("locale").maybeSingle();
  if (settings && isLocale(settings.locale)) {
    (await cookies()).set(LOCALE_COOKIE, settings.locale, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  }
  redirect("/");
}

export async function signOutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
