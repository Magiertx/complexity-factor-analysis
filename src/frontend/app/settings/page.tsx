import { SettingsView } from "@/components/settings-view";
import { ErrorBoundary } from "@/components/ui/error-boundary";

export default function SettingsPage() {
  return (
    <div className="mx-auto max-w-[1100px] px-6 py-8">
      <ErrorBoundary>
        <SettingsView />
      </ErrorBoundary>
    </div>
  );
}
