// Public entry of the i18n module: language provider and hooks, the locale overlays for backend content.

export {
  LocaleProvider,
  useLocale,
  useT,
  useTMaybe,
  LOCALES,
  DEFAULT_LOCALE,
  type Locale,
} from "./provider";
export {
  localizedAlgoName,
  localizedAlgoDescription,
  localizedAlgoText,
  localizedParamLabel,
  localizedParamHelp,
  localizedSampleLog,
  type AlgoContentMap,
  type AlgoContentOverride,
} from "./algo-content";
export { localizeCatalog } from "./catalog-content";
