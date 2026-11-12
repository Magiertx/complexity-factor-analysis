// Unit tests for nav.ts.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { activeHeaderLink, activeTab, lastAnalysis, rememberAnalysis, TAB_HREFS, TABS } from "./nav";

describe("the active entry of the navigation", () => {
  const ROUTES = ["/", "/log", "/compare", "/inspect", "/runs", "/guide", "/settings"];

  it("is exactly one per route: a tab or a link of the header", () => {
    for (const route of ROUTES) {
      const active = [activeTab(route), activeHeaderLink(route)].filter((x) => x !== null);
      expect(active, route).toHaveLength(1);
    }
  });

  it("names the tab of each page of the tabs", () => {
    for (const id of TABS) expect(activeTab(TAB_HREFS[id])).toBe(id);
    expect(activeTab("/log/")).toBe("log");
  });

  it("makes no tab active on the pages of the header", () => {
    expect(activeTab("/guide")).toBeNull();
    expect(activeHeaderLink("/guide")).toBe("guide");
    expect(activeHeaderLink("/settings")).toBe("settings");
    expect(activeHeaderLink("/")).toBeNull();
  });

  it("gives the print view the tab of its analysis", () => {
    expect(activeTab("/print", "?kind=log&dataset=x")).toBe("log");
    expect(activeTab("/print", "?dataset=x")).toBe("model");
  });

  it("knows nothing of an unknown address", () => {
    expect(activeTab("/nowhere")).toBeNull();
    expect(activeHeaderLink("/nowhere")).toBeNull();
  });
});

describe("the way back from a page of the header", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("leads to the model tab when no tab was visited", () => {
    expect(lastAnalysis()).toBe("/");
  });

  it("leads to the page of the tab visited last, with its query", () => {
    rememberAnalysis("/log", "step=loadings");
    expect(lastAnalysis()).toBe("/log?step=loadings");
    rememberAnalysis("/compare", "?cols=a,b&rule=hair");
    expect(lastAnalysis()).toBe("/compare?cols=a,b&rule=hair");
    rememberAnalysis("/runs", "");
    expect(lastAnalysis()).toBe("/runs");
  });

  it("does not count the pages of the header or the print view", () => {
    rememberAnalysis("/inspect", "job=1");
    rememberAnalysis("/guide", "");
    rememberAnalysis("/settings", "");
    rememberAnalysis("/print", "kind=log&dataset=x");
    expect(lastAnalysis()).toBe("/inspect?job=1");
  });

  it("takes no address that leads elsewhere", () => {
    sessionStorage.setItem("app.last-analysis", "//evil.example/");
    expect(lastAnalysis()).toBe("/");
    sessionStorage.setItem("app.last-analysis", "/guide");
    expect(lastAnalysis()).toBe("/");
  });
});
