import { Suspense } from "react";
import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";
import { AnalysisMemory } from "@/components/back-link";
import { ModeBar } from "@/components/mode-bar";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { APP_DESCRIPTION, APP_NAME } from "@/lib/app-config";

export const metadata: Metadata = {
  // Each route names its page in English; PageHeader renames the tab in the language of the UI.
  title: { default: APP_NAME, template: `%s · ${APP_NAME}` },
  description: APP_DESCRIPTION,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <Providers>
          {/* Reads the query, which needs a boundary, or Next would bail out of prerendering. */}
          <Suspense fallback={null}>
            <AnalysisMemory />
          </Suspense>
          <div className="min-h-screen flex flex-col">
            <SiteHeader />
            <ModeBar />
            {/* Same width and side gutter as the header, the mode bar and the footer, so every
                page starts at the same left edge. */}
            <div className="flex-1 mx-auto max-w-[1600px] w-full">
              <main className="min-w-0 px-4 sm:px-6 py-8">{children}</main>
            </div>
            <SiteFooter />
          </div>
        </Providers>
      </body>
    </html>
  );
}
