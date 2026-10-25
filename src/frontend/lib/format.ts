// Numbers, dates and times in the UI language. Every formatter takes the locale of the UI
// (useLocale().locale), never the browser's, so a German UI shows "0,35" and "72,7 %" on any
// system and an English UI "0.35" and "72.7%".

/** Shown for a value that is missing or not a finite number. */
export const NO_VALUE = "–";

const numberFormats = new Map<string, Intl.NumberFormat>();

// Building an Intl.NumberFormat is far slower than using one, and tables format thousands of cells.
function numberFormat(locale: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let format = numberFormats.get(key);
  if (!format) {
    format = new Intl.NumberFormat(locale, options);
    numberFormats.set(key, format);
  }
  return format;
}

/**
 * A minus sign that lines up with the digits in a column; none for a value that rounds to
 * zero, so -0.001 with two digits reads "0.00", not "−0.00".
 */
function signed(text: string): string {
  return /[1-9]/.test(text) ? text.replace("-", "−") : text.replace("-", "");
}

/**
 * A number with `digits` fixed decimals, or as many as it has (up to six) without `digits`.
 * Groups thousands as the locale does: 2,112 in English, 2.112 in German.
 */
export function formatNumber(value: number, locale: string, digits?: number): string {
  if (!Number.isFinite(value)) return NO_VALUE;
  const options =
    digits === undefined
      ? { maximumFractionDigits: 6 }
      : { minimumFractionDigits: digits, maximumFractionDigits: digits };
  return signed(numberFormat(locale, options).format(value));
}

/**
 * A value of the descriptive statistics: up to three decimals, none from a thousand on, and never
 * grouped. With a separator for thousands, "1,000" (a thousand) would sit next to "1.000" (one) in
 * the same column, and the German UI reads them the other way round; without it a separator is
 * always the decimal mark: 1000 and 1, 17248 and 17.248 (de: 17248 and 17,248).
 */
export function formatStatistic(value: number, locale: string): string {
  if (!Number.isFinite(value)) return NO_VALUE;
  const options = { useGrouping: false, maximumFractionDigits: Math.abs(value) >= 1000 ? 0 : 3 };
  return signed(numberFormat(locale, options).format(value));
}

/**
 * A number as a field shows it for editing: without thousands grouping, which
 * parseInputNumber does not read, and with the minus a keyboard types.
 */
export function formatInputNumber(value: number, locale: string): string {
  if (!Number.isFinite(value)) return "";
  const text = numberFormat(locale, { maximumFractionDigits: 6, useGrouping: false }).format(value);
  return /[1-9]/.test(text) ? text : text.replace("-", "");
}

/**
 * The number typed into a field, or null. A comma and a point both count as the decimal
 * separator, whatever the language: fields take no grouping, so neither can mean one.
 */
export function parseInputNumber(text: string): number | null {
  const s = text.trim().replace("−", "-");
  if (!/^[+-]?(\d+([.,]\d*)?|[.,]\d+)$/.test(s)) return null;
  return Number(s.replace(",", "."));
}

/** A share of 1 as a percentage: 0.727 is "72.7%" in English and "72,7 %" in German. */
export function formatPercent(share: number, locale: string, digits = 1): string {
  if (!Number.isFinite(share)) return NO_VALUE;
  return signed(
    numberFormat(locale, { style: "percent", minimumFractionDigits: digits, maximumFractionDigits: digits }).format(share),
  );
}

/** A p-value with three decimals; smaller ones as "< 0.001". */
export function formatPValue(p: number, locale: string): string {
  if (!Number.isFinite(p)) return NO_VALUE;
  if (p < 0.001) return `< ${formatNumber(0.001, locale, 3)}`;
  return formatNumber(p, locale, 3);
}

/** A file size in bytes, kB, MB or GB, e.g. "740 kB" or "12.5 MB". */
export function formatFileSize(bytes: number, locale: string): string {
  if (!Number.isFinite(bytes)) return NO_VALUE;
  // The unit follows the value as shown, so 1,048,575 bytes read "1.0 MB", not "1,024 kB".
  const mb = bytes / (1024 * 1024);
  const [unit, value, digits] =
    Math.round(bytes) < 1024
      ? (["byte", bytes, 0] as const)
      : Math.round(bytes / 1024) < 1024
        ? (["kilobyte", bytes / 1024, 0] as const)
        : Math.round(mb * 10) / 10 < 1024
          ? (["megabyte", mb, 1] as const)
          : (["gigabyte", mb / 1024, 1] as const);
  return numberFormat(locale, {
    style: "unit",
    unit,
    unitDisplay: "short",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

type DateInput = string | number | Date;

/** A date from an ISO string, epoch milliseconds or a Date; null if it cannot be read. */
function toDate(input: DateInput): Date | null {
  const date = input instanceof Date ? input : new Date(input);
  return Number.isFinite(date.getTime()) ? date : null;
}

const dateFormats = new Map<string, Intl.DateTimeFormat>();

function dateFormat(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let format = dateFormats.get(key);
  if (!format) {
    format = new Intl.DateTimeFormat(locale, options);
    dateFormats.set(key, format);
  }
  return format;
}

/**
 * Date and time of a moment, the one format for timestamps across the UI: "Oct 6, 2026,
 * 1:34 AM" in English, "06.10.2026, 01:34" in German. Empty for a date that cannot be read.
 */
export function formatDateTime(input: DateInput, locale: string): string {
  const date = toDate(input);
  return date ? dateFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(date) : "";
}

/** The date alone, in the format of formatDateTime. Empty for a date that cannot be read. */
export function formatDate(input: DateInput, locale: string): string {
  const date = toDate(input);
  return date ? dateFormat(locale, { dateStyle: "medium" }).format(date) : "";
}

const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["week", 7 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
];

/** "3 hours ago" in the given locale; an empty string for a date that cannot be read. */
export function formatRelative(input: DateInput, locale: string, now = Date.now()): string {
  const date = toDate(input);
  if (!date) return "";
  const seconds = (date.getTime() - now) / 1000;
  const format = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  for (const [unit, size] of RELATIVE_UNITS) {
    if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit);
  }
  return format.format(0, "second");
}

/**
 * The first sentence of a text and the rest, for a line that shows the first sentence and puts the
 * whole text behind an (i). A sentence ends at ".", "!" or "?" before a capital letter, so an
 * abbreviation such as "Tab. 17" or "z. B." before a lower-case word does not end one.
 */
export function splitSentence(text: string): [string, string] {
  const m = /^(.+?[.!?])\s+(?=[A-ZÄÖÜ])/.exec(text);
  return m ? [m[1], text.slice(m[0].length)] : [text, ""];
}
