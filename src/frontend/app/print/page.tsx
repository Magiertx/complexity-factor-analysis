import { Suspense } from "react";
import type { Metadata } from "next";
import { PrintView } from "@/components/factor-analysis/print-view";
import { ErrorBoundary } from "@/components/ui/error-boundary";

export const metadata: Metadata = { title: "Print view" };

export default function PrintPage() {
  return (
    <ErrorBoundary>
      {/* The view reads its analysis from the address. */}
      <Suspense fallback={null}>
        <PrintView />
      </Suspense>
    </ErrorBoundary>
  );
}
