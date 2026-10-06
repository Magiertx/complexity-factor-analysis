import type { Metadata } from "next";
import { SettingsView } from "@/components/settings-view";
import { ErrorBoundary } from "@/components/ui/error-boundary";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <ErrorBoundary>
      <SettingsView />
    </ErrorBoundary>
  );
}
