import "server-only";
import { cookies } from "next/headers";
import { DEFAULT_LOCALE, dictionaries, isLocale, type Locale } from "./dictionaries";

export const LOCALE_COOKIE = "sf_locale";

/** Interface language from the cookie set by the language switch. */
export async function getLocale(): Promise<Locale> {
  const value = (await cookies()).get(LOCALE_COOKIE)?.value;
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

export async function getI18n() {
  const locale = await getLocale();
  return { locale, t: dictionaries[locale], dir: locale === "ar" ? ("rtl" as const) : ("ltr" as const) };
}
