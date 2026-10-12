// What the UI says about the published datasets beyond the catalog: how the paper's own tables
// relate to the report the numbers are checked against. The wording lives in the locale files
// under factor.paper_notes, so it can be changed in one place.

type Translate = (key: string, params?: Record<string, string | number>) => string;

/**
 * Keys the server may send as `published_match.paper_tables`, and the text each stands for.
 * Spellings vary on purpose: the key names a fact about the paper, not a fixed vocabulary.
 */
const PAPER_TABLES: { pattern: RegExp; key: string; params?: (m: RegExpExecArray) => Record<string, string> }[] = [
  {
    // "matches_tab_11", "same_as_tab_4_5": the paper prints the numbers of the report.
    pattern: /^(?:matches|same_as|identical)(?:_tab(?:les?)?)?_(\d+(?:_\d+)*)$/,
    key: "matches",
    params: (m) => ({ tables: m[1].split("_").join("/") }),
  },
  { pattern: /^(?:tab_8_)?extra_dup(?:_column)?$/, key: "extra_dup" },
  { pattern: /^(?:tab_14_16_)?other_data$/, key: "other_data" },
  { pattern: /^(?:not_in_paper|repository_only)$/, key: "not_in_paper" },
];

/**
 * The sentence on the paper's own tables for a key of the server; a text the server sent as
 * such is shown as it is, an unknown key not at all.
 */
export function paperTablesText(key: string | null | undefined, t: Translate): string | null {
  if (!key) return null;
  for (const { pattern, key: text, params } of PAPER_TABLES) {
    const m = pattern.exec(key);
    if (m) return t(`factor.paper_notes.tables.${text}`, params?.(m));
  }
  return /\s/.test(key) ? key : null;
}
