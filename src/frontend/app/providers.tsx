"use client";

// Client-side providers of the whole app: theme, language, toasts, feedback dialog, background jobs and the one tooltip layer.

import { ThemeProvider } from "next-themes";
import { FeedbackProvider } from "@/components/feedback/feedback-provider";
import { JobsProvider } from "@/components/jobs-provider";
import { TipLayer } from "@/components/ui/tip";
import { ToastProvider } from "@/components/ui/toasts";
import { LocaleProvider } from "@/lib/i18n";

/** Nests the providers around `children`; used by `app/layout.tsx`. */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <LocaleProvider>
        <ToastProvider>
          <FeedbackProvider>
            <JobsProvider>{children}</JobsProvider>
          </FeedbackProvider>
        </ToastProvider>
        <TipLayer />
      </LocaleProvider>
    </ThemeProvider>
  );
}
