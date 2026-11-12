"use client";

// The download menu of a figure of the analysis.

import { FileCode2, ImageDown, ImageIcon } from "lucide-react";
import type { FigureFormat } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { Menu } from "@/components/ui/menu";

/** What the download menu of a figure needs from the analysis it shows. */
export interface FigureDownload {
  /** A download of this figure is on its way. */
  busy: boolean;
  /** Why the figure cannot be downloaded now, e.g. while the analysis is updated; null when it can. */
  reason: string | null;
  onDownload: (format: FigureFormat) => void;
}

/**
 * The small menu at a figure that downloads it for a paper: as SVG, whose text stays text, or as
 * PNG with 300 dpi, both drawn by the server in a light print style whatever the theme.
 */
export function FigureMenu({ name, figure }: { name: string; figure: FigureDownload }) {
  const t = useT();
  return (
    <Menu
      icon={ImageDown}
      size="sm"
      name={t("factor.figure.download", { figure: name })}
      more={t("factor.figure.download_more")}
      busy={figure.busy}
      width={280}
      items={[
        {
          id: "svg",
          label: t("factor.figure.svg"),
          hint: figure.reason ?? t("factor.figure.svg_hint"),
          icon: FileCode2,
          disabled: !!figure.reason || figure.busy,
          onSelect: () => figure.onDownload("svg"),
        },
        {
          id: "png",
          label: t("factor.figure.png"),
          hint: figure.reason ?? t("factor.figure.png_hint"),
          icon: ImageIcon,
          disabled: !!figure.reason || figure.busy,
          onSelect: () => figure.onDownload("png"),
        },
      ]}
    />
  );
}
