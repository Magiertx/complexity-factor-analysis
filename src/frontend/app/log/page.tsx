// Route `/log`: the factor analysis of event logs.

import type { Metadata } from "next";
import { FactorAnalysisView } from "@/components/factor-analysis/factor-analysis-view";
import { ErrorBoundary } from "@/components/ui/error-boundary";

/** Page title in English; the page header renames the tab to the UI language. */
export const metadata: Metadata = { title: "Log complexity" };

/** Factor analysis of log complexity measures (`kind="log"`). */
export default function LogComplexityPage() {
  return (
    <ErrorBoundary>
      <FactorAnalysisView kind="log" />
    </ErrorBoundary>
  );
}
