import type { Metadata } from "next";
import { GuideView } from "@/components/guide-view";
import { ErrorBoundary } from "@/components/ui/error-boundary";

export const metadata: Metadata = { title: "User guide" };

export default function GuidePage() {
  return (
    <ErrorBoundary>
      <GuideView />
    </ErrorBoundary>
  );
}
