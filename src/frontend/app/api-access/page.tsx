import type { Metadata } from "next";
import { ApiAccessView } from "@/components/api-access-view";
import { ErrorBoundary } from "@/components/ui/error-boundary";

export const metadata: Metadata = { title: "API access" };

export default function ApiAccessPage() {
  return (
    <ErrorBoundary>
      <ApiAccessView />
    </ErrorBoundary>
  );
}
