"use client";

import { useT } from "@/lib/i18n";
import { PageHeader } from "./page-header";

export function InspectHeader() {
  const t = useT();
  return (
    <PageHeader
      title={t("inspect.title")}
      subtitle={t("inspect.subtitle")}
    />
  );
}

/** Shown while the workbench waits for the query of the URL. */
export function InspectLoading() {
  const t = useT();
  return <div className="text-sm text-muted">{t("common.loading")}</div>;
}
