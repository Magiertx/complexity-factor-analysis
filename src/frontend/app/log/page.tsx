import type { Metadata } from "next";
import { FactorAnalysisView } from "@/components/factor-analysis/factor-analysis-view";
import { ErrorBoundary } from "@/components/ui/error-boundary";

export const metadata: Metadata = { title: "Log complexity" };

export default function LogComplexityPage() {
  return (
    <ErrorBoundary>
      <FactorAnalysisView kind="log" />
    </ErrorBoundary>
  );
}
