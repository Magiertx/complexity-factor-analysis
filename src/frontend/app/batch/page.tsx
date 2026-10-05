import { Suspense } from "react";
import { BatchBuilder } from "@/components/batch-builder";
import { ErrorBoundary } from "@/components/ui/error-boundary";

export default function BatchPage() {
  return (
    <div className="mx-auto max-w-[1920px] px-6 py-8">
      <ErrorBoundary>
        <Suspense fallback={<div className="text-sm text-muted">Loading…</div>}>
          <BatchBuilder />
        </Suspense>
      </ErrorBoundary>
    </div>
  );
}
