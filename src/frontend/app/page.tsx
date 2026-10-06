import type { Metadata } from "next";
import { FactorAnalysisView } from "@/components/factor-analysis/factor-analysis-view";
import { ErrorBoundary } from "@/components/ui/error-boundary";

export const metadata: Metadata = { title: "Model complexity" };

export default function ModelComplexityPage() {
  return (
    <ErrorBoundary>
      <FactorAnalysisView kind="model" />
    </ErrorBoundary>
  );
}
