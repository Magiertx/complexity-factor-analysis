"use client";

import React, { Component, ErrorInfo, ReactNode } from "react";
import { AlertCircle } from "lucide-react";
import { Button } from "./button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./card";

interface Props {
  children?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error inside Workbench:", error, errorInfo);
  }

  private handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  public render() {
    if (this.state.hasError) {
      return (
        <Card className="max-w-[600px] mx-auto my-8 border-danger/40 bg-danger/5">
          <CardHeader className="flex flex-row items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-danger/10 grid place-items-center text-danger shrink-0">
              <AlertCircle className="h-5 w-5" />
            </div>
            <div>
              <CardTitle className="text-lg font-bold text-danger">Something went wrong</CardTitle>
              <CardDescription className="text-sm mt-1 text-muted/80">
                The Workbench application encountered an unexpected error.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="p-3 bg-bg border border-border rounded text-xs font-mono overflow-auto max-h-[200px] text-fg/80">
              {this.state.error?.toString() || "Unknown Error"}
            </div>
            <div className="flex justify-end">
              <Button onClick={this.handleRetry}>
                Try again
              </Button>
            </div>
          </CardContent>
        </Card>
      );
    }

    return this.props.children;
  }
}
