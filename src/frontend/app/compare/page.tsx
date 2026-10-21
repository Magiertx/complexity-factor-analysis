import { Suspense } from "react";
import type { Metadata } from "next";
import { CompareView } from "@/components/factor-analysis/compare-view";
import { ErrorBoundary } from "@/components/ui/error-boundary";

export const metadata: Metadata = { title: "Compare factor structures" };

export default function ComparePage() {
  return (
    <ErrorBoundary>
      {/* The view reads the columns and the rule from the address. */}
      <Suspense fallback={null}>
        <CompareView />
      </Suspense>
    </ErrorBoundary>
  );
}
