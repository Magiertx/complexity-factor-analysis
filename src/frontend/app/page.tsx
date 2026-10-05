import { Suspense } from "react";
import { Workbench } from "@/components/workbench";
import { ErrorBoundary } from "@/components/ui/error-boundary";

export default function Home() {
  return (
    <div className="mx-auto max-w-[1920px] px-6 py-8">
      <ErrorBoundary>
        <Suspense fallback={<div className="text-sm text-muted">Loading…</div>}>
          <Workbench />
        </Suspense>
      </ErrorBoundary>
    </div>
  );
}
