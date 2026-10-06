"use client";

import { useState } from "react";
import { LayoutGrid, List } from "lucide-react";
import type { Artifact } from "@/lib/api";
import { Segmented } from "../ui/segmented";
import { StatRow } from "./stat-row";
import { TableView } from "./table-view";
import { ImageView } from "./image-view";
import { LogDownload } from "./log-download";
import { TextView } from "./text-view";
import { localizedAlgoText, useT } from "@/lib/i18n";

type Stat = Extract<Artifact, { kind: "stat" }>;
type Img = Extract<Artifact, { kind: "image" }>;

interface Props {
  artifacts: Artifact[];
  runId?: string | null;
}

// Render artifacts in order. Consecutive `stat` and `image` artifacts are grouped respectively.
export function Artifacts({ artifacts, runId }: Props) {
  const t = useT();
  const [imageLayout, setImageLayout] = useState<"grid" | "list">("grid");

  const groups: Array<
    | { kind: "stats"; stats: Stat[] }
    | { kind: "images"; images: Img[] }
    | { kind: "other"; artifact: Artifact }
  > = [];

  let statBucket: Stat[] = [];
  let imageBucket: Img[] = [];

  const flushStats = () => {
    if (statBucket.length) {
      groups.push({ kind: "stats", stats: statBucket });
      statBucket = [];
    }
  };

  const flushImages = () => {
    if (imageBucket.length) {
      groups.push({ kind: "images", images: imageBucket });
      imageBucket = [];
    }
  };

  for (const a of artifacts) {
    if (a.kind === "stat") {
      flushImages();
      statBucket.push(a);
    } else if (a.kind === "image") {
      flushStats();
      imageBucket.push(a);
    } else {
      flushStats();
      flushImages();
      groups.push({ kind: "other", artifact: a });
    }
  }
  flushStats();
  flushImages();

  return (
    <div className="space-y-5">
      {groups.map((g, i) => {
        if (g.kind === "stats") {
          return <StatRow key={i} stats={g.stats} />;
        }

        if (g.kind === "images") {
          if (g.images.length === 1) {
            const a = g.images[0];
            return (
              <section key={i} className="space-y-2">
                <h3 className="text-sm font-medium text-muted">{localizedAlgoText(a.label, t)}</h3>
                <ImageView artifact={a} runId={runId} />
              </section>
            );
          } else {
            return (
              <div key={i} className="space-y-3">
                <div className="flex items-center justify-between border-b border-border/40 pb-2">
                  <h3 className="text-sm font-medium text-muted">{t("artifacts.petri_nets_heading", { n: g.images.length })}</h3>
                  <Segmented
                    size="sm"
                    value={imageLayout}
                    onChange={setImageLayout}
                    options={[
                      { value: "grid", label: <><LayoutGrid className="h-3 w-3" /><span>{t("artifacts.grid_label")}</span></>, title: t("artifacts.grid_view_title") },
                      { value: "list", label: <><List className="h-3 w-3" /><span>{t("artifacts.list_label")}</span></>, title: t("artifacts.list_view_title") },
                    ]}
                  />
                </div>

                {imageLayout === "grid" ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    {g.images.map((a, idx) => (
                      <section key={idx} className="space-y-2">
                        <h3 className="text-sm font-medium text-muted">{localizedAlgoText(a.label, t)}</h3>
                        <ImageView artifact={a} runId={runId} fixedHeight={true} />
                      </section>
                    ))}
                  </div>
                ) : (
                  <div className="space-y-6">
                    {g.images.map((a, idx) => (
                      <section key={idx} className="space-y-2">
                        <h3 className="text-sm font-medium text-muted">{localizedAlgoText(a.label, t)}</h3>
                        <ImageView artifact={a} runId={runId} fixedHeight={false} />
                      </section>
                    ))}
                  </div>
                )}
              </div>
            );
          }
        }

        const a = g.artifact;
        return (
          <section key={i} className="space-y-2">
            <h3 className="text-sm font-medium text-muted">{localizedAlgoText(a.label, t)}</h3>
            {a.kind === "table" && <TableView artifact={a} runId={runId} />}
            {a.kind === "log" && <LogDownload artifact={a} />}
            {a.kind === "text" && <TextView artifact={a} />}
          </section>
        );
      })}
    </div>
  );
}
