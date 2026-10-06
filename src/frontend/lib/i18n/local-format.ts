// Numbers, dates and times in the language of the UI, never in that of the browser: an English
// UI in a German browser shows "Oct 6, 2026" and "0.75", a German one "6. Okt. 2026" and "0,75".
// Covers the app shell and the single-log pages.

import type { Locale } from "./provider";

const TAGS: Record<Locale, string> = { en: "en-US", de: "de-DE" };

function toDate(value: Date | number | string): Date {
  return value instanceof Date ? value : new Date(value);
}

/** One format for every point in time the UI shows: when a run started, a log was uploaded or a preset saved. */
export function formatDateTime(value: Date | number | string, locale: Locale): string {
  const date = toDate(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(TAGS[locale], { dateStyle: "medium", timeStyle: "short" }).format(date);
}

/** A calendar day, such as the first and last day of a log. */
export function formatDay(value: Date | number | string, locale: Locale): string {
  const date = toDate(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(TAGS[locale], { dateStyle: "medium" }).format(date);
}

/** A number with a fixed count of decimals; a value that rounds to zero never shows a minus. */
export function formatNumber(value: number, locale: Locale, digits = 0): string {
  if (!Number.isFinite(value)) return "–";
  return new Intl.NumberFormat(TAGS[locale], {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
    signDisplay: "negative",
  }).format(value);
}

/** A share between 0 and 1 as a percentage: "72.7%" in English, "72,7 %" in German. */
export function formatPercent(share: number, locale: Locale, digits = 0): string {
  if (!Number.isFinite(share)) return "–";
  return new Intl.NumberFormat(TAGS[locale], {
    style: "percent",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
    signDisplay: "negative",
  }).format(share);
}

/** A file size in kilobytes with one decimal. */
export function formatKilobytes(bytes: number, locale: Locale): string {
  return `${formatNumber(bytes / 1024, locale, 1)} KB`;
}
