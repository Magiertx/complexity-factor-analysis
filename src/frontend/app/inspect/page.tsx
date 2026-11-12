// Route `/inspect`: the page of a single log.

import { Suspense } from "react";
import type { Metadata } from "next";
import { Workbench } from "@/components/workbench";
import { InspectHeader, InspectLoading } from "@/components/inspect-header";
import { ErrorBoundary } from "@/components/ui/error-boundary";

/** Page title in English; the page header renames the tab to the UI language. */
export const metadata: Metadata = { title: "Inspect a single log" };

/** The single-log page; the header and a loading state show while the workbench reads the address. */
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
