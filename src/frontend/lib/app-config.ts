// Product name and links, defined once for the whole frontend. The backend
// has its own copy of the name in src/AlgoService/config.py.

export const APP_NAME = "XCom";

/** Short mark for the header logo, derived from the name (the initials of its words; the first letter of a one-word name). */
export const APP_INITIALS = APP_NAME.split(/\s+/)
  .map((word) => word[0])
  .join("")
  .slice(0, 3)
  .toUpperCase();

export const APP_DESCRIPTION =
  "XCom, a tool for the exploration of event log and process model complexity: factor analysis of complexity measures, in your browser.";

/** Public source repository: the link in the settings, and where feedback goes as an issue
 * when the server has no mail set up (the desktop app). Leave empty to hide both. */
export const REPO_URL: string = "https://github.com/Magiertx/complexity-factor-analysis";
