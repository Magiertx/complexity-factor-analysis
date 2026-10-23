"use client";

// A client module itself: as a server page importing the view, the production build on Linux
// (Next.js 15.5) failed to prerender /runs with "Could not find the module ... in the React
// Client Manifest", once the page of a single log listed its recent runs as well.
import { Suspense } from "react";
import { RunHistoryView } from "@/components/run-history-view";
import { ErrorBoundary } from "@/components/ui/error-boundary";

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
