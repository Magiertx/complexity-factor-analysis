import { RunHistoryView } from "@/components/run-history-view";
import { ErrorBoundary } from "@/components/ui/error-boundary";

export default function RunsPage() {
  return (
    <div className="mx-auto max-w-[1400px] px-6 py-8">
      <ErrorBoundary>
        <RunHistoryView />
      </ErrorBoundary>
    </div>
  );
}
