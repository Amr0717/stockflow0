// Timestamps are stored in UTC and shown in the owner's time zone.
export const DEFAULT_TIMEZONE = "Asia/Hebron";

function dateLocale(locale: string) {
  return locale === "ar" ? "ar-u-nu-latn" : "en-GB";
}

export function formatDateTime(iso: string | null | undefined, locale: string, timeZone = DEFAULT_TIMEZONE) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat(dateLocale(locale), {
    timeZone,
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function formatDate(iso: string | null | undefined, locale: string, timeZone = DEFAULT_TIMEZONE) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat(dateLocale(locale), {
    timeZone,
    year: "numeric",
    month: "long",
    day: "2-digit",
  }).format(new Date(iso));
}

/** Offset (ms) of a time zone from UTC at a given instant. */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - instant.getTime();
}

/**
 * "2026-10-26" in Asia/Hebron -> the UTC instant when that local day starts.
 * Returns null for invalid input.
 */
export function zonedDayStartUtc(day: string, timeZone = DEFAULT_TIMEZONE): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return null;
  const guess = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(guess)) return null;
  // Two passes handle days where the offset changes (DST).
  let utc = guess - zoneOffsetMs(new Date(guess), timeZone);
  utc = guess - zoneOffsetMs(new Date(utc), timeZone);
  return new Date(utc);
}

export function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 86_400_000);
}
