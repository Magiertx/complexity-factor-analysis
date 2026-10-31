// The code of the last error the API answered with, for the feedback form: with "technical
// details" on, it goes along with a report. One value in memory; nothing is stored in the browser
// and nothing is read from the data of an analysis.

let last: string | null = null;

/** Errors that are part of normal operation and say nothing about a problem. */
const BENIGN = new Set(["superseded"]);

/**
 * Remembers the error of a failed request: its code, or `http_<status>` where the server gave none.
 */
export function noteError(status: number, code?: string | null): void {
  if (code && BENIGN.has(code)) return;
  last = code || `http_${status}`;
}

/** The code of the last error since the page was opened, or null. */
export function lastErrorCode(): string | null {
  return last;
}

/** For tests. */
export function forgetLastError(): void {
  last = null;
}
