// The link from a row of a dataset to the page of a single log: "View this log". A dataset computed
// from logs has a row for each log (log measures) or for each log and miner (nets), named
// "<log> / <miner>". The server keeps the logs of a dataset among the recent uploads of the session
// under their own names, the packed ones without ".gz", so the page of a single log can open one as
// long as it is among the newest.

import type { FactorKind } from "./api";

/** The separator between the log and the miner in the name of a row. */
const SEPARATOR = " / ";

export interface LogRow {
  /** The log as the recent uploads name it. */
  log: string;
  /** The miner of the row, for nets; null for log measures or a row that names none. */
  miner: string | null;
}

/** The name a log has among the recent uploads: the file name without the ".gz" of a packed one. */
export function recentName(log: string): string {
  return log.toLowerCase().endsWith(".xes.gz") ? log.slice(0, -3) : log;
}

/**
 * The log and the miner a row of a dataset computed from logs stands for. For nets the miner is
 * what follows the last " / " when it is one of the dataset's `miners`; the log is the rest.
 */
export function logOfRow(label: string, kind: FactorKind, miners: readonly string[] | null | undefined): LogRow {
  if (kind === "model") {
    const at = label.lastIndexOf(SEPARATOR);
    const miner = at >= 0 ? label.slice(at + SEPARATOR.length) : null;
    if (at >= 0 && miner !== null && miners?.includes(miner)) return { log: recentName(label.slice(0, at)), miner };
  }
  return { log: recentName(label), miner: null };
}

/** The page of a single log with this log chosen and, for a row of nets, only its miner. */
export function inspectHref(row: LogRow): string {
  const query = new URLSearchParams({ log: row.log });
  if (row.miner) query.set("miner", row.miner);
  return `/inspect?${query.toString()}`;
}
