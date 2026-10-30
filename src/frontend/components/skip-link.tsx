"use client";

import { useT } from "@/lib/i18n";

/**
 * The first stop of the keyboard on every page: it moves past the header and the tabs to the
 * content. Hidden until it has the focus.
 */
export function SkipLink() {
  const t = useT();
  return (
    <a
      href="#main-content"
      className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-3 focus:z-50 focus:rounded-md focus:bg-accent focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-accent-fg focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-accent focus:ring-offset-bg print:hidden"
    >
      {t("common.skip_to_content")}
    </a>
  );
}
