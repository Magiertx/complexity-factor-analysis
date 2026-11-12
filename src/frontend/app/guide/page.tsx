// Route `/guide`: the user guide.

import type { Metadata } from "next";
import { GuideView } from "@/components/guide-view";
import { ErrorBoundary } from "@/components/ui/error-boundary";

/** Page title in English; the page header renames the tab to the UI language. */
export const metadata: Metadata = { title: "User guide" };

/** The user guide page. */
export default function GuidePage() {
  return (
    <ErrorBoundary>
      <GuideView />
    </ErrorBoundary>
  );
}
