// Route `/print`: the print view of one analysis.

import { Suspense } from "react";
import type { Metadata } from "next";
import { PrintView } from "@/components/factor-analysis/print-view";
import { ErrorBoundary } from "@/components/ui/error-boundary";

/** Page title in English; the print view renames the tab to the UI language once the analysis is known. */
export const metadata: Metadata = { title: "Print view" };

/** The print view page. */
export default function PrintPage() {
  return (
    <ErrorBoundary>
      {/* The view reads its analysis from the address. */}
      <Suspense fallback={null}>
        <PrintView />
      </Suspense>
    </ErrorBoundary>
  );
}
