"use client";

import { useRouter } from "next/navigation";
import {
  CircleHelp,
  Download,
  Ellipsis,
  FileArchive,
  FileCode2,
  FileSpreadsheet,
  FolderOpen,
  Microscope,
  Sheet,
  Signpost,
} from "lucide-react";
import type { FactorKind } from "@/lib/api";
import type { ExportFormat } from "@/lib/factor-analysis";
import { useT } from "@/lib/i18n";
import { IconButton, IconLink, ToolSeparator } from "@/components/ui/icon-button";
import { Menu, type MenuItem } from "@/components/ui/menu";
import { CopyLink } from "./copy-link";

export interface ExportState {
  /** Why nothing can be downloaded yet, e.g. no dataset; null when the dataset can. */
  datasetReason: string | null;
  /** Why the loadings cannot be downloaded yet; null when they can. */
  loadingsReason: string | null;
  /** Why the ZIP cannot be downloaded yet, e.g. while the analysis is updated; null when it can. */
  zipReason: string | null;
  /** The cleaned dataset as CSV, a link the browser downloads itself. */
  datasetHref: string | null;
  exporting: ExportFormat | null;
  onExport: (format: ExportFormat) => void;
}

/**
 * The tools of a factor analysis tab as icons in one row, in groups: the way in (Start here, My
 * datasets), sharing and downloads (link, export menu), and help (tour, a single log). Each icon is
 * named by its tooltip. On a phone only the link and the downloads stay in the row; the rest goes
 * into a "more" menu.
 */
export function FactorToolbar({
  kind,
  linkQuery,
  exports,
  onStartHere,
  onMyDatasets,
  myDatasetsReason,
  onTour,
}: {
  kind: FactorKind;
  linkQuery: string | null;
  exports: ExportState;
  onStartHere: () => void;
  onMyDatasets: () => void;
  /** Why My datasets has nothing to open; null when it has. */
  myDatasetsReason: string | null;
  onTour: () => void;
}) {
  const t = useT();
  const router = useRouter();
  const { exporting } = exports;

  const exportItems: MenuItem[] = [
    {
      id: "zip",
      label: t("factor.toolbar.export_zip"),
      hint: exports.zipReason ?? t("factor.toolbar.export_zip_hint"),
      icon: FileArchive,
      disabled: !!exports.zipReason || exporting !== null,
      onSelect: () => exports.onExport("zip"),
    },
    {
      id: "csv",
      label: t("factor.toolbar.export_loadings_csv"),
      hint: exports.loadingsReason,
      icon: FileSpreadsheet,
      disabled: !!exports.loadingsReason || exporting !== null,
      onSelect: () => exports.onExport("csv"),
      separated: true,
    },
    {
      id: "latex",
      label: t("factor.toolbar.export_loadings_latex"),
      hint: exports.loadingsReason,
      icon: FileCode2,
      disabled: !!exports.loadingsReason || exporting !== null,
      onSelect: () => exports.onExport("latex"),
    },
    {
      id: "dataset",
      label: t("factor.toolbar.export_dataset"),
      hint: exports.datasetReason ?? t("factor.toolbar.export_dataset_hint"),
      icon: Sheet,
      href: exports.datasetHref ?? undefined,
      download: true,
      disabled: !!exports.datasetReason,
      separated: true,
    },
  ];
  const exportMenu = (
    <Menu
      icon={Download}
      name={t("factor.toolbar.export")}
      more={t("factor.toolbar.export_more")}
      items={exportItems}
      busy={exporting !== null}
      width={300}
    />
  );

  const moreItems: MenuItem[] = [
    { id: "start", label: t("factor.start.title"), icon: Signpost, onSelect: onStartHere },
    {
      id: "mine",
      label: t("factor.data.source.mine"),
      icon: FolderOpen,
      hint: myDatasetsReason,
      disabled: !!myDatasetsReason,
      onSelect: onMyDatasets,
    },
    { id: "tour", label: t("factor.tour_button"), icon: CircleHelp, onSelect: onTour, separated: true },
    ...(kind === "model"
      ? [
          {
            id: "inspect",
            label: t("factor.model.inspect_link"),
            icon: Microscope,
            onSelect: () => router.push("/inspect"),
          },
        ]
      : []),
  ];

  return (
    <div role="group" aria-label={t("factor.toolbar.aria")} className="flex items-center gap-0.5">
      <span className="hidden sm:contents">
        <IconButton icon={Signpost} name={t("factor.start.title")} more={t("factor.start.collapsed_hint")} onClick={onStartHere} />
        <IconButton
          icon={FolderOpen}
          name={t("factor.data.source.mine")}
          more={t("factor.toolbar.mine_more")}
          reason={myDatasetsReason}
          onClick={onMyDatasets}
        />
        <ToolSeparator />
      </span>
      <CopyLink query={linkQuery} />
      {exportMenu}
      <span className="hidden sm:contents">
        <ToolSeparator />
        <IconButton icon={CircleHelp} name={t("factor.tour_button")} more={t("factor.tour_title")} onClick={onTour} />
        {kind === "model" && (
          <IconLink icon={Microscope} name={t("factor.model.inspect_link")} more={t("factor.model.inspect_title")} href="/inspect" />
        )}
      </span>
      <span className="sm:hidden contents">
        <Menu icon={Ellipsis} name={t("factor.toolbar.more")} items={moreItems} />
      </span>
    </div>
  );
}
