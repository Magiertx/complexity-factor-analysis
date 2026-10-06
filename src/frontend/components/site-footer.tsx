"use client";

import { useT } from "@/lib/i18n";

export function SiteFooter() {
  const t = useT();
  return (
    <footer className="border-t border-border">
      <div className="mx-auto max-w-[1600px] px-4 sm:px-6 py-4 text-xs text-muted">
        {t("footer.credit")}
      </div>
    </footer>
  );
}
