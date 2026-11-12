// Route `/settings`: the settings.

import type { Metadata } from "next";
import { SettingsView } from "@/components/settings-view";
import { ErrorBoundary } from "@/components/ui/error-boundary";

/** Page title in English; the page header renames the tab to the UI language. */
export const metadata: Metadata = { title: "Settings" };

/** The settings page. */
export default function SettingsPage() {
  return (
    <ErrorBoundary>
      <SettingsView />
    </ErrorBoundary>
  );
}
