"use client";

// A React error boundary: a render error in a page shows a card with a retry button instead of a blank page.

import React, { Component, ErrorInfo, ReactNode } from "react";
import { AlertCircle } from "lucide-react";
import { useT } from "@/lib/i18n";
import { Button } from "./button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./card";

interface Props {
  children?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/** The card shown in place of the part that failed to render. */
function ErrorFallback({ error, onRetry }: { error: Error | null; onRetry: () => void }) {
  const t = useT();
  return (
    <Card className="max-w-[600px] mx-auto my-8 bg-danger/5">
      <CardHeader className="flex flex-row items-center gap-3">
        <div className="h-10 w-10 rounded-full bg-danger/10 grid place-items-center text-danger-ink shrink-0">
          <AlertCircle className="h-5 w-5" />
        </div>
        <div>
          <CardTitle className="text-lg font-bold text-danger-ink">{t("common.error_title")}</CardTitle>
          <CardDescription className="text-sm mt-1 text-muted">
            {t("common.error_description")}
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="p-3 bg-bg rounded text-xs font-mono overflow-auto max-h-[200px] text-fg/80">
          {error?.toString() || t("common.error_unknown")}
        </div>
        <div className="flex justify-end">
          <Button onClick={onRetry}>{t("common.try_again")}</Button>
        </div>
      </CardContent>
    </Card>
  );
}

/** Catches render errors below it and shows `ErrorFallback`; "Try again" renders the children anew. */
export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  private handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  public render() {
    if (this.state.hasError) {
      return <ErrorFallback error={this.state.error} onRetry={this.handleRetry} />;
    }

    return this.props.children;
  }
}
