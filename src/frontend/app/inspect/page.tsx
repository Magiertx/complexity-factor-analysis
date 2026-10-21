import { Suspense } from "react";
import type { Metadata } from "next";
import { Workbench } from "@/components/workbench";
import { InspectHeader, InspectLoading } from "@/components/inspect-header";
import { ErrorBoundary } from "@/components/ui/error-boundary";

export const metadata: Metadata = { title: "Inspect a single log" };

export default function InspectPage() {
  return (
    <div className="space-y-6">
      <ErrorBoundary>
        <Suspense
          fallback={
            <>
              <InspectHeader />
              <InspectLoading />
            </>
          }
        >
          <Workbench />
        </Suspense>
      </ErrorBoundary>
    </div>
  );
}
