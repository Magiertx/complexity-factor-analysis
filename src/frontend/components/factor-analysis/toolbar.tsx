"use client";

import { useRouter } from "next/navigation";
import {
  BookOpen,
  CircleHelp,
  Columns3,
  Download,
  Ellipsis,
  FileArchive,
  FileCode2,
  FileSpreadsheet,
  FileText,
  FolderOpen,
  Microscope,
  Printer,
  Route,
  Sheet,
  Signpost,
  Tag,
} from "lucide-react";
import type { CompareExportFormat, FactorKind } from "@/lib/api";
import { COMPARE_HREF } from "@/lib/compare";
import type { ExportFormat } from "@/lib/factor-analysis";
import { useT } from "@/lib/i18n";
import { IconButton, IconLink, ToolSeparator } from "@/components/ui/icon-button";
import { Menu, type MenuItem } from "@/components/ui/menu";
import { CopyLink } from "./copy-link";

/** Where the user guide lives in the app. */
export const GUIDE_HREF = "/guide";

export interface ExportState {
  /** Why nothing can be downloaded yet, e.g. no dataset; null when the dataset can. */
  datasetReason: string | null;
  /** Why the loadings cannot be downloaded yet; null when they can. */
  loadingsReason: string | null;
  /** Why the ZIP, the report and the print view cannot be had yet, e.g. while the analysis is updated. */
  zipReason: string | null;
  /** The cleaned dataset as CSV, a link the browser downloads itself. */
  datasetHref: string | null;
  /** The print view of the analysis on screen, opened in a tab of its own. */
  printHref: string | null;
  exporting: ExportFormat | null;
  onExport: (format: ExportFormat) => void;
}

/** The switch between the names of the measures and the short codes of the papers. */
export interface ShortCodesSwitch {
  on: boolean;
  /** Why it changes nothing, e.g. no measure of the dataset has a code; null when it does. */
  reason: string | null;
  onToggle: () => void;
}

/**
 * The tools of a factor analysis tab as icons in one row, in groups: the way in (Start here, My
 * datasets), the view and the downloads (short codes, link, download menu), and help (guide and
 * tour) with the pages beside the tab (the comparison of miners, a single log). Each icon is
 * named by its tooltip. On a phone only the link and the
 * downloads stay in the row; the rest goes into a "more" menu.
 */
export function FactorToolbar({
  kind,
  linkQuery,
  exports,
  shortCodes,
  onStartHere,
  onMyDatasets,
  myDatasetsReason,
  onTour,
}: {
  kind: FactorKind;
  linkQuery: string | null;
  exports: ExportState;
  shortCodes: ShortCodesSwitch;
  onStartHere: () => void;
  onMyDatasets: () => void;
  /** Why My datasets has nothing to open; null when it has. */
  myDatasetsReason: string | null;
  onTour: () => void;
}) {
  const t = useT();
  const router = useRouter();
  const { exporting } = exports;
  const busy = exporting !== null;

  const exportItems: MenuItem[] = [
    {
      id: "zip",
      label: t("factor.toolbar.export_zip"),
      hint: exports.zipReason ?? t("factor.toolbar.export_zip_hint"),
      icon: FileArchive,
      disabled: !!exports.zipReason || busy,
      onSelect: () => exports.onExport("zip"),
    },
    {
      id: "report",
      label: t("factor.toolbar.export_report"),
      hint: exports.zipReason ?? t("factor.toolbar.export_report_hint"),
      icon: FileText,
      disabled: !!exports.zipReason || busy,
      onSelect: () => exports.onExport("report"),
    },
    {
      id: "print",
      label: t("factor.toolbar.print"),
      hint: exports.zipReason ?? t("factor.toolbar.print_hint"),
      icon: Printer,
      href: exports.printHref ?? undefined,
      newTab: true,
      disabled: !!exports.zipReason || !exports.printHref,
    },
    {
      id: "csv",
      label: t("factor.toolbar.export_loadings_csv"),
      hint: exports.loadingsReason,
      icon: FileSpreadsheet,
      disabled: !!exports.loadingsReason || busy,
      onSelect: () => exports.onExport("csv"),
      separated: true,
    },
    {
      id: "latex",
      label: t("factor.toolbar.export_loadings_latex"),
      hint: exports.loadingsReason,
      icon: FileCode2,
      disabled: !!exports.loadingsReason || busy,
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
      busy={busy}
      width={320}
    />
  );

  const helpItems: MenuItem[] = [
    { id: "guide", label: t("factor.toolbar.guide"), hint: t("factor.toolbar.guide_hint"), icon: BookOpen, href: GUIDE_HREF, newTab: true },
    { id: "tour", label: t("factor.tour_button"), hint: t("factor.tour_title"), icon: Route, onSelect: onTour },
  ];

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
    {
      id: "codes",
      label: t(shortCodes.on ? "factor.toolbar.codes_off" : "factor.toolbar.codes_on"),
      hint: shortCodes.reason,
      icon: Tag,
      disabled: !!shortCodes.reason,
      onSelect: shortCodes.onToggle,
      separated: true,
    },
    { id: "guide", label: t("factor.toolbar.guide"), icon: BookOpen, href: GUIDE_HREF, newTab: true, separated: true },
    { id: "tour", label: t("factor.tour_button"), icon: Route, onSelect: onTour },
    ...(kind === "model"
      ? [
          { id: "compare", label: t("factor.toolbar.compare"), icon: Columns3, href: COMPARE_HREF, separated: true },
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
        <IconButton
          icon={Tag}
          name={t("factor.toolbar.codes")}
          more={t("factor.toolbar.codes_more")}
          reason={shortCodes.reason}
          aria-pressed={shortCodes.on}
          onClick={shortCodes.onToggle}
          className={shortCodes.on ? "bg-tile" : undefined}
        />
      </span>
      <CopyLink query={linkQuery} />
      {exportMenu}
      <span className="hidden sm:contents">
        <ToolSeparator />
        <Menu icon={CircleHelp} name={t("factor.toolbar.help")} more={t("factor.toolbar.help_more")} items={helpItems} />
        {kind === "model" && (
          <>
            <IconLink icon={Columns3} name={t("factor.toolbar.compare")} more={t("factor.toolbar.compare_more")} href={COMPARE_HREF} />
            <IconLink icon={Microscope} name={t("factor.model.inspect_link")} more={t("factor.model.inspect_title")} href="/inspect" />
          </>
        )}
      </span>
      <span className="sm:hidden contents">
        <Menu icon={Ellipsis} name={t("factor.toolbar.more")} items={moreItems} />
      </span>
    </div>
  );
}

/**
 * The tools of the comparison of factor structures, in the header like those of a tab: the short
 * codes, the link, the downloads (CSV, LaTeX like Tab. 17, ZIP) and the guide.
 */
export function CompareToolbar({
  linkQuery,
  exportReason,
  exporting,
  onExport,
  shortCodes,
}: {
  linkQuery: string;
  /** Why nothing can be downloaded yet, e.g. while the comparison is computed; null when it can. */
  exportReason: string | null;
  exporting: CompareExportFormat | null;
  onExport: (format: CompareExportFormat) => void;
  shortCodes: ShortCodesSwitch;
}) {
  const t = useT();
  const busy = exporting !== null;
  const items: MenuItem[] = [
    {
      id: "csv",
      label: t("compare.export.csv"),
      hint: exportReason ?? t("compare.export.csv_hint"),
      icon: FileSpreadsheet,
      disabled: !!exportReason || busy,
      onSelect: () => onExport("csv"),
    },
    {
      id: "latex",
      label: t("compare.export.latex"),
      hint: exportReason ?? t("compare.export.latex_hint"),
      icon: FileCode2,
      disabled: !!exportReason || busy,
      onSelect: () => onExport("latex"),
    },
    {
      id: "zip",
      label: t("compare.export.zip"),
      hint: exportReason ?? t("compare.export.zip_hint"),
      icon: FileArchive,
      disabled: !!exportReason || busy,
      onSelect: () => onExport("zip"),
      separated: true,
    },
  ];
  return (
    <div role="group" aria-label={t("factor.toolbar.aria")} className="flex items-center gap-0.5">
      <IconButton
        icon={Tag}
        name={t("factor.toolbar.codes")}
        more={t("compare.codes_more")}
        reason={shortCodes.reason}
        aria-pressed={shortCodes.on}
        onClick={shortCodes.onToggle}
        className={shortCodes.on ? "bg-tile" : undefined}
      />
      <ToolSeparator />
      <CopyLink query={linkQuery} />
      <Menu
        icon={Download}
        name={t("factor.toolbar.export")}
        more={t("compare.export.more")}
        items={items}
        busy={busy}
        width={320}
      />
      <ToolSeparator />
      <IconLink icon={BookOpen} name={t("factor.toolbar.guide")} more={t("factor.toolbar.guide_hint")} href={`${GUIDE_HREF}#guide-compare`} />
    </div>
  );
}
