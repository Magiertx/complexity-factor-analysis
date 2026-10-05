import { Suspense } from "react";
import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";
import { ModeBar } from "@/components/mode-bar";
import { JobsDrawer } from "@/components/jobs-drawer";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { APP_DESCRIPTION, APP_NAME } from "@/lib/app-config";

export const metadata: Metadata = {
  title: APP_NAME,
  description: APP_DESCRIPTION,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <Providers>
          <div className="min-h-screen flex flex-col">
            <SiteHeader />
            <ModeBar />
            <div className="flex-1 flex mx-auto max-w-[1920px] w-full">
              <main className="flex-1 min-w-0">{children}</main>
              {/* Suspense: JobsDrawer reads useSearchParams (active job);
                  without a boundary Next would bail out of prerendering. */}
              <Suspense fallback={null}>
                <JobsDrawer />
              </Suspense>
            </div>
            <SiteFooter />
          </div>
        </Providers>
      </body>
    </html>
  );
}
