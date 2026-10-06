import type { Metadata } from "next";
import { RunHistoryView } from "@/components/run-history-view";
import { ErrorBoundary } from "@/components/ui/error-boundary";

export const metadata: Metadata = { title: "Runs" };

export default function RunsPage() {
  return (
    <ErrorBoundary>
      <RunHistoryView />
    </ErrorBoundary>
  );
}
