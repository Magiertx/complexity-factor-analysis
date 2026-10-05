import { FactorAnalysisView } from "@/components/factor-analysis/factor-analysis-view";
import { ErrorBoundary } from "@/components/ui/error-boundary";

export default function LogComplexityPage() {
  return (
    <div className="mx-auto max-w-[1600px] px-4 sm:px-6 py-8">
      <ErrorBoundary>
        <FactorAnalysisView kind="log" />
      </ErrorBoundary>
    </div>
  );
}
