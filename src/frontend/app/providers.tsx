"use client";

import { ThemeProvider } from "next-themes";
import { JobsDrawerProvider } from "@/components/jobs-drawer";
import { LocaleProvider } from "@/lib/i18n";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
      <LocaleProvider>
        <JobsDrawerProvider>{children}</JobsDrawerProvider>
      </LocaleProvider>
    </ThemeProvider>
  );
}
