"use client";

import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { activeTab, lastAnalysis, rememberAnalysis } from "@/lib/nav";
import { useT } from "@/lib/i18n";

/**
 * Remembers the page of a tab with its query whenever it changes, e.g. the step of an analysis, so
 * the pages of the header lead back to it. Its own component, since it waits for the query.
 */
export function AnalysisMemory() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  useEffect(() => rememberAnalysis(pathname, search), [pathname, search]);
  return null;
}

/** "← Back: Log complexity", to the page of the tab visited last, for the pages of the header. */
export function useBackToAnalysis(): { href: string; label: string } {
  const t = useT();
  // The model tab until the browser says otherwise, as on the server.
  const [href, setHref] = useState("/");
  useEffect(() => setHref(lastAnalysis()), []);
  const tab = activeTab(href.split("?")[0]) ?? "model";
  return { href, label: t("nav.back_to", { page: t(`mode_bar.${tab}_label`) }) };
}
