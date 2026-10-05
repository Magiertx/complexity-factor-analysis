import { Suspense } from "react";
import { Workbench } from "@/components/workbench";
import { InspectHeader } from "@/components/inspect-header";
import { ErrorBoundary } from "@/components/ui/error-boundary";

export default function InspectPage() {
  return (
    <div className="mx-auto max-w-[1920px] px-4 sm:px-6 py-8 space-y-6">
      <InspectHeader />
      <ErrorBoundary>
        <Suspense fallback={<div className="text-sm text-muted">Loading…</div>}>
          <Workbench />
        </Suspense>
      </ErrorBoundary>
    </div>
  );
}
