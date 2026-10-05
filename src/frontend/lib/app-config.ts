// Product name and links, defined once for the whole frontend. The backend
// has its own copy of the name in src/AlgoService/config.py.

export const APP_NAME = "Complexity Factor Analysis";

/** Short mark for the header logo, derived from the name. */
export const APP_INITIALS = APP_NAME.split(/\s+/)
  .map((word) => word[0])
  .join("")
  .slice(0, 3)
  .toUpperCase();

export const APP_DESCRIPTION =
  "Complexity measures of process models discovered from event logs, in your browser.";

/** Public source repository. Leave empty to hide the link in the settings. */
export const REPO_URL = "";
