// Parsing and formatting of quantities and money WITHOUT floating point.
// Money is always handled as integer minor units (agorot / cents).

export const CURRENCIES = ["ILS", "USD", "EUR"] as const;
export type CurrencyCode = (typeof CURRENCIES)[number];

export const CURRENCY_SYMBOLS: Record<CurrencyCode, string> = { ILS: "₪", USD: "$", EUR: "€" };

const MAX_MINOR = 999_999_999_999n; // ~ 10 billion in major units, well inside JS safe range
const MAX_QUANTITY = 1_000_000_000;

/** Converts Arabic-Indic / Persian digits and the Arabic decimal mark to ASCII. */
export function normalizeDigits(input: string): string {
  return input
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/٫/g, ".")
    .replace(/٬/g, "")
    .trim();
}

/**
 * "19.95" -> 1995, "7" -> 700, "0.5" -> 50. Returns null for anything that is
 * not a non-negative amount with at most 2 decimals.
 */
export function parseMoneyToMinor(input: string | null | undefined): number | null {
  if (input == null) return null;
  const s = normalizeDigits(String(input));
  const match = /^(\d{1,12})(?:\.(\d{0,2}))?$/.exec(s);
  if (!match) return null;
  const minor = BigInt(match[1]) * 100n + BigInt((match[2] ?? "").padEnd(2, "0"));
  if (minor > MAX_MINOR) return null;
  return Number(minor);
}

/** 1995 -> "19.95" (for prefilling inputs). */
export function minorToInput(minor: number | null | undefined): string {
  if (minor == null) return "";
  const v = BigInt(minor);
  const sign = v < 0n ? "-" : "";
  const abs = v < 0n ? -v : v;
  return `${sign}${abs / 100n}.${String(abs % 100n).padStart(2, "0")}`;
}

/** Whole positive number ("12" -> 12). Rejects 0, negatives, decimals, text. */
export function parsePositiveInt(input: string | null | undefined): number | null {
  if (input == null) return null;
  const s = normalizeDigits(String(input));
  if (!/^\d{1,10}$/.test(s)) return null;
  const n = Number(s);
  return n > 0 && n <= MAX_QUANTITY ? n : null;
}

/** Whole number >= 0. */
export function parseNonNegativeInt(input: string | null | undefined): number | null {
  if (input == null) return null;
  const s = normalizeDigits(String(input));
  if (s === "") return null;
  if (!/^\d{1,10}$/.test(s)) return null;
  const n = Number(s);
  return n <= MAX_QUANTITY ? n : null;
}

/** Exact line total in minor units. */
export function lineTotalMinor(quantity: number, unitPriceMinor: number): number {
  return Number(BigInt(quantity) * BigInt(unitPriceMinor));
}

/** Exact sum of minor-unit amounts. */
export function sumMinor(values: number[]): number {
  return Number(values.reduce((acc, v) => acc + BigInt(v), 0n));
}

function numberLocale(locale: string) {
  // Western digits in both languages keep SKUs, prices and quantities unambiguous.
  return locale === "ar" ? "ar-u-nu-latn" : "en-US";
}

/** 1995, "ILS" -> "₪19.95" (locale-aware, exact: formats a decimal string). */
export function formatMoney(minor: number, currency: string, locale: string): string {
  const decimal = minorToInput(minor);
  return new Intl.NumberFormat(numberLocale(locale), {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(decimal as unknown as number);
}

export function formatNumber(value: number, locale: string): string {
  return new Intl.NumberFormat(numberLocale(locale)).format(value);
}
