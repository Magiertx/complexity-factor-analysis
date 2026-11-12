"use client";

// The toolbars above the analysis and the comparison: downloads, print view, short codes and the guide.

import {
  BookOpen,
  ClipboardCopy,
  Download,
  FileArchive,
  FileCode2,
  FileSpreadsheet,
  FileText,
  Printer,
  Quote,
  Compass,
  Sheet,
  Tag,
} from "lucide-react";
import type { CompareExportFormat } from "@/lib/api";
import type { ExportFormat } from "@/lib/factor-analysis";
import { useT } from "@/lib/i18n";
import { IconButton, IconLink, ToolSeparator } from "@/components/ui/icon-button";
import { Menu, type MenuItem } from "@/components/ui/menu";
import { CopyLink } from "./copy-link";

/** Where the user guide lives in the app. */
export const GUIDE_HREF = "/guide";

/** What the download menu needs to know: which downloads are possible now, and why not where they are not. */
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
  /** Not shown at all, where it could never change anything. */
  hidden?: boolean;
  onToggle: () => void;
}

/**
 * The tools of the analysis on a factor analysis tab, as icons in one row: the short codes, the
 * link and the downloads, and the tour of the steps at the end. Each icon is named by its tooltip.
 * The ways to other pages are elsewhere: the tabs for the comparison and a single log, the header
 * for the guide, the data step for Get started and My datasets.
 */
export function FactorToolbar({
  linkQuery,
  exports,
  shortCodes,
  onTour,
}: {
  linkQuery: string | null;
  exports: ExportState;
  shortCodes: ShortCodesSwitch;
  onTour: () => void;
}) {
  const t = useT();
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
      id: "methods",
      label: t("factor.toolbar.export_methods"),
      hint: exports.zipReason ?? t("factor.toolbar.export_methods_hint"),
      icon: ClipboardCopy,
      disabled: !!exports.zipReason || busy,
      onSelect: () => exports.onExport("methods"),
      separated: true,
    },
    {
      id: "bibtex",
      label: t("factor.toolbar.export_bibtex"),
      hint: exports.zipReason ?? t("factor.toolbar.export_bibtex_hint"),
      icon: Quote,
      disabled: !!exports.zipReason || busy,
      onSelect: () => exports.onExport("bibtex"),
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

  return (
    <div role="group" aria-label={t("factor.toolbar.aria")} className="flex items-center gap-1.5">
      {!shortCodes.hidden && (
        <IconButton
          icon={Tag}
          name={t("factor.toolbar.codes")}
          more={t("factor.toolbar.codes_more")}
          reason={shortCodes.reason}
          aria-pressed={shortCodes.on}
          onClick={shortCodes.onToggle}
          className={shortCodes.on ? "bg-tile" : undefined}
        />
      )}
      <CopyLink query={linkQuery} />
      {exportMenu}
      <ToolSeparator />
      <IconButton icon={Compass} name={t("factor.tour_button")} more={t("factor.tour_title")} onClick={onTour} />
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
    <div role="group" aria-label={t("factor.toolbar.aria")} className="flex items-center gap-1.5">
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
      <CopyLink query={linkQuery} more={t("compare.link_more")} />
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
