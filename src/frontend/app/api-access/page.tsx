import { ApiAccessView } from "@/components/api-access-view";
import { ErrorBoundary } from "@/components/ui/error-boundary";

export default function ApiAccessPage() {
  return (
    <div className="mx-auto max-w-[1100px] px-6 py-8">
      <ErrorBoundary>
        <ApiAccessView />
      </ErrorBoundary>
    </div>
  );
}
