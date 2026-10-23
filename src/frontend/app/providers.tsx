"use client";

import { ThemeProvider } from "next-themes";
import { JobsProvider } from "@/components/jobs-provider";
import { TipLayer } from "@/components/ui/tip";
import { ToastProvider } from "@/components/ui/toasts";
import { LocaleProvider } from "@/lib/i18n";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <LocaleProvider>
        <ToastProvider>
          <JobsProvider>{children}</JobsProvider>
        </ToastProvider>
        <TipLayer />
      </LocaleProvider>
    </ThemeProvider>
  );
}
