"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useT } from "@/lib/i18n";

export function InspectHeader() {
  const t = useT();
  return (
    <header className="flex items-center gap-3">
      <Link
        href="/"
        className="h-9 w-9 grid place-items-center rounded-md bg-tile hover:bg-accent/[0.08] transition text-muted hover:text-fg shrink-0"
        aria-label={t("inspect.back_aria")}
        title={t("inspect.back_aria")}
      >
        <ArrowLeft className="h-4 w-4" />
      </Link>
      <div className="min-w-0">
        <h1 className="text-lg font-semibold tracking-tight">{t("inspect.title")}</h1>
        <p className="text-xs text-muted mt-0.5">{t("inspect.subtitle")}</p>
      </div>
    </header>
  );
}
