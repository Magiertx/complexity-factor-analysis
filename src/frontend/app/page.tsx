// Route `/`: the factor analysis of process models.

import type { Metadata } from "next";
import { FactorAnalysisView } from "@/components/factor-analysis/factor-analysis-view";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { APP_NAME } from "@/lib/app-config";

// The title template of the layout does not reach a page in the layout's own segment.
export const metadata: Metadata = { title: { absolute: `Model complexity · ${APP_NAME}` } };

/** Factor analysis of model complexity measures (`kind="model"`). */
export default function ModelComplexityPage() {
  return (
    <ErrorBoundary>
      <FactorAnalysisView kind="model" />
    </ErrorBoundary>
  );
}
