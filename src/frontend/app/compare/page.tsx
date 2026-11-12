// Route `/compare`: comparison of factor structures across datasets.

import { Suspense } from "react";
import type { Metadata } from "next";
import { CompareView } from "@/components/factor-analysis/compare-view";
import { ErrorBoundary } from "@/components/ui/error-boundary";

/** Page title in English; the page header renames the tab to the UI language. */
export const metadata: Metadata = { title: "Compare factor structures" };

/** The comparison page. */
export default function ComparePage() {
  return (
    <ErrorBoundary>
      {/* The view reads the columns and the rule from the address. */}
      <Suspense fallback={null}>
        <CompareView />
      </Suspense>
    </ErrorBoundary>
  );
}
