"use client";

import { ThemeProvider } from "next-themes";
import { JobsDrawerProvider } from "@/components/jobs-drawer";
import { TipLayer } from "@/components/ui/tip";
import { LocaleProvider } from "@/lib/i18n";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <LocaleProvider>
        <JobsDrawerProvider>{children}</JobsDrawerProvider>
        <TipLayer />
      </LocaleProvider>
    </ThemeProvider>
  );
}
