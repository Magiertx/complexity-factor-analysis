// The text side of the user guide: an item that starts with its term ("Dataset: what cleaning left
// out") is split there, so the guide can set the term apart without a second text per item.

/** A term is a name, not a sentence. */
const TERM_MAX = 40;

/**
 * The term and the text of an item that starts with a term, split at the first colon, or null for
 * an item that does not ("Open Model complexity or Log complexity.").
 */
export function splitTerm(text: string): { term: string; body: string } | null {
  const at = text.indexOf(": ");
  if (at < 1 || at > TERM_MAX) return null;
  const term = text.slice(0, at);
  // "Choose a dataset. In Data: ..." is a sentence with a colon, not a term.
  if (/[.!?] /.test(term)) return null;
  return { term, body: text.slice(at + 2) };
}

/**
 * The text after a term starts a sentence of its own, so a plain lowercase word gets its capital;
 * "report.tex" and the like keep theirs.
 */
export function sentence(text: string): string {
  return /^[a-zäöü][a-zäöüß]*[,;]?(\s|$)/.test(text) ? text[0].toUpperCase() + text.slice(1) : text;
}
