"use client";

// A client module, like app/runs/page.tsx: the localised text needs the language of the UI, and a
// server module importing client views is what broke the production build there.
import Link from "next/link";
import { Compass, Home } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { buttonClass } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { useT } from "@/lib/i18n";

/** The 404 page, in the language of the UI. */
export default function NotFound() {
  const t = useT();
  return (
    <div className="space-y-6">
      <PageHeader title={t("not_found.title")} />
      <EmptyState
        icon={<Compass className="h-6 w-6" aria-hidden />}
        action={
          <Link href="/" className={buttonClass("primary", "md")}>
            <Home className="h-4 w-4" aria-hidden />
            {t("not_found.home")}
          </Link>
        }
      >
        {t("not_found.text")}
      </EmptyState>
    </div>
  );
}
