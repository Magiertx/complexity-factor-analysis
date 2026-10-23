import { Suspense } from "react";
import type { Metadata } from "next";
import { RunHistoryView } from "@/components/run-history-view";
import { ErrorBoundary } from "@/components/ui/error-boundary";

export const metadata: Metadata = { title: "History" };

export default function RunsPage() {
  return (
    <ErrorBoundary>
      {/* The view reads the type of rows to show from the address (?type=single). */}
      <Suspense fallback={null}>
        <RunHistoryView />
      </Suspense>
    </ErrorBoundary>
  );
}
