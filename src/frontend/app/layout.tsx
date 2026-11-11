import { Suspense } from "react";
import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";
import { AnalysisMemory } from "@/components/back-link";
import { ModeBar } from "@/components/mode-bar";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { SkipLink } from "@/components/skip-link";
import { APP_DESCRIPTION, APP_NAME } from "@/lib/app-config";

export const metadata: Metadata = {
  // Each route names its page in English; PageHeader renames the tab in the language of the UI.
  title: { default: APP_NAME, template: `%s · ${APP_NAME}` },
  description: APP_DESCRIPTION,
};

// The language of the page before the first paint, by the rule of detectLocale (lib/i18n/provider.tsx).
const LANG_SCRIPT =
  'try{var l=localStorage.getItem("app.locale");if(l!=="en"&&l!=="de")l=/^de(-|$)/i.test(navigator.language)?"de":"en";document.documentElement.lang=l}catch(e){}';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // translate="no": the app has its own languages; Edge and Chrome offered to translate every page
    // (and a translated page shows measure names and codes that do not exist).
    <html lang="en" translate="no" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: LANG_SCRIPT }} />
      </head>
      <body>
        <Providers>
          {/* Reads the query, which needs a boundary, or Next would bail out of prerendering. */}
          <Suspense fallback={null}>
            <AnalysisMemory />
          </Suspense>
          <SkipLink />
          <div className="min-h-screen flex flex-col">
            <SiteHeader />
            <ModeBar />
            {/* Same width and side gutter as the header, the mode bar and the footer, so every
                page starts at the same left edge. */}
            <div className="flex-1 mx-auto max-w-[1600px] w-full">
              <main id="main-content" tabIndex={-1} className="min-w-0 px-4 sm:px-6 py-8 focus:outline-none">
                {children}
              </main>
            </div>
            <SiteFooter />
          </div>
        </Providers>
      </body>
    </html>
  );
}
