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

/** Public source repository. Leave empty to hide the link in the settings. */
export const REPO_URL = "";
