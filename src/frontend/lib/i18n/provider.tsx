"use client";

// The language of the UI: provider, hooks and the lookup of texts in lib/i18n/locales/{en,de}.json.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { formatNumber } from "../format";
import en from "./locales/en.json";
import de from "./locales/de.json";

/** The languages of the UI. */
export type Locale = "en" | "de";
/** All languages, in the order the language switch lists them. */
export const LOCALES: Locale[] = ["en", "de"];
/** The language used before the person's choice is known, and for a text the other language lacks. */
export const DEFAULT_LOCALE: Locale = "en";
const STORAGE_KEY = "app.locale";

type Dict = Record<string, unknown>;
const DICTIONARIES: Record<Locale, Dict> = { en, de };

type TParams = Record<string, string | number>;

interface LocaleContextValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: string, params?: TParams) => string;
  /** Like `t`, but undefined for a missing key, for texts that have an untranslated fallback. */
  tMaybe: (key: string, params?: TParams) => string | undefined;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

function lookup(dict: Dict, key: string): string | undefined {
  const parts = key.split(".");
  let cur: unknown = dict;
  for (const p of parts) {
    if (cur && typeof cur === "object" && p in (cur as Dict)) {
      cur = (cur as Dict)[p];
    } else {
      return undefined;
    }
  }
  return typeof cur === "string" ? cur : undefined;
}

/** Fills in the params; numbers in the format of the UI language ("0,05" in German). */
function interpolate(template: string, locale: Locale, params?: TParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (m, k) => {
    if (!Object.prototype.hasOwnProperty.call(params, k)) return m;
    const v = params[k];
    return typeof v === "number" ? formatNumber(v, locale) : String(v);
  });
}

/**
 * The language of the UI: the one stored when the person chose it, else German for a German
 * browser (de, de-AT, ...) and English otherwise. Read after hydration, never while rendering, so
 * the server's page and the first render of the client agree.
 */
export function detectLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "en" || saved === "de") return saved;
  } catch {
    /* ignore */
  }
  return typeof navigator !== "undefined" && /^de(-|$)/i.test(navigator.language) ? "de" : DEFAULT_LOCALE;
}

/** Holds the language (detected after hydration, stored when the person switches it) and provides `t` and `tMaybe`. A missing text falls back to English, then to the key itself. */
export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);

  useEffect(() => {
    setLocaleState(detectLocale());
  }, []);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {
      /* ignore */
    }
    if (typeof document !== "undefined") {
      document.documentElement.lang = l;
    }
  }, []);

  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.lang = locale;
    }
  }, [locale]);

  const t = useCallback(
    (key: string, params?: TParams) => {
      const fromActive = lookup(DICTIONARIES[locale], key);
      if (fromActive !== undefined) return interpolate(fromActive, locale, params);
      const fromFallback = lookup(DICTIONARIES[DEFAULT_LOCALE], key);
      if (fromFallback !== undefined) return interpolate(fromFallback, locale, params);
      if (process.env.NODE_ENV !== "production") {
        console.warn(`[i18n] missing key: ${key}`);
      }
      return key;
    },
    [locale],
  );

  const tMaybe = useCallback(
    (key: string, params?: TParams) => {
      const found = lookup(DICTIONARIES[locale], key) ?? lookup(DICTIONARIES[DEFAULT_LOCALE], key);
      return found === undefined ? undefined : interpolate(found, locale, params);
    },
    [locale],
  );

  const value = useMemo(() => ({ locale, setLocale, t, tMaybe }), [locale, setLocale, t, tMaybe]);

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

/** The language, its setter and the lookup functions; throws outside `LocaleProvider`. */
export function useLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error("useLocale must be used within LocaleProvider");
  return ctx;
}

/** The text lookup `t(key, params)`; a number in `params` is formatted in the UI language. */
export function useT() {
  return useLocale().t;
}

/** Like `useT`, but returns undefined for a key that has no text in either language. */
export function useTMaybe() {
  return useLocale().tMaybe;
}
