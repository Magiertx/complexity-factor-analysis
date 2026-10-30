// The navigation of the app: the tabs of the mode bar and the links of the header, which one of
// them a route makes active, and the page of the tabs that a page of the header leads back to.

/**
 * The tabs of the mode bar, in their order: the analyses, then the tools of the app (the comparison
 * and the History), set apart at the end.
 */
export const ANALYSIS_TABS = ["model", "log", "inspect"] as const;
export const TOOL_TABS = ["compare", "history"] as const;
export const TABS = [...ANALYSIS_TABS, ...TOOL_TABS] as const;
export type TabId = (typeof TABS)[number];

export const TAB_HREFS: Record<TabId, string> = {
  model: "/",
  log: "/log",
  compare: "/compare",
  inspect: "/inspect",
  history: "/runs",
};

/** The pages of the header, which belong to no tab. */
export const HEADER_LINKS = ["guide", "settings"] as const;
export type HeaderLinkId = (typeof HEADER_LINKS)[number];

export const HEADER_HREFS: Record<HeaderLinkId, string> = {
  guide: "/guide",
  settings: "/settings",
};

function path(pathname: string): string {
  return pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
}

/**
 * The tab a route belongs to, or null for a page of the header and an unknown address. The print
 * view (`search` is its query) belongs to the tab of its analysis.
 */
export function activeTab(pathname: string, search = ""): TabId | null {
  const p = path(pathname);
  const tab = TABS.find((id) => TAB_HREFS[id] === p);
  if (tab) return tab;
  if (p === "/print") return new URLSearchParams(search).get("kind") === "log" ? "log" : "model";
  return null;
}

/** The link of the header a route belongs to, or null for a page of the tabs. */
export function activeHeaderLink(pathname: string): HeaderLinkId | null {
  const p = path(pathname);
  return HEADER_LINKS.find((id) => HEADER_HREFS[id] === p) ?? null;
}

const LAST_KEY = "app.last-analysis";

/**
 * Remembers the page of a tab with its query (the step, the dataset, the comparison), so the pages
 * of the header lead back to it. Kept per browser tab, like the history of the browser.
 */
export function rememberAnalysis(pathname: string, search: string): void {
  if (path(pathname) === "/print" || activeTab(pathname) === null) return;
  const query = search.replace(/^\?/, "");
  try {
    sessionStorage.setItem(LAST_KEY, `${path(pathname)}${query ? `?${query}` : ""}`);
  } catch {
    /* storage blocked */
  }
}

/** The page of a tab visited last, with its query; the model tab when there is none. */
export function lastAnalysis(): string {
  try {
    const saved = sessionStorage.getItem(LAST_KEY);
    // Only an address of this app, never one to elsewhere.
    if (saved && saved.startsWith("/") && !saved.startsWith("//") && activeTab(saved.split("?")[0]) !== null) {
      return saved;
    }
  } catch {
    /* storage blocked */
  }
  return "/";
}
