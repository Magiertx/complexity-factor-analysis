// The run times and input sizes of a computed dataset as one table: a row per observation (a log
// and a miner, a log, or a net), as the server's measurement_rows gives them in inputs.csv.

import type { Measurement, NetSize } from "./api";

/** One row of the run-time table: an observation with the size of its input and the seconds of each stage. */
export interface MeasurementRow {
  observation: string;
  input: string;
  miner?: string;
  events?: number;
  traces?: number;
  variants?: number;
  activities?: number;
  net?: NetSize | null;
  /** Seconds to read the input; a log is read once for all its miners. */
  read_s?: number;
  /** Seconds of the discovery including the wait for ProM4Py. */
  discovery_s?: number;
  /** Seconds of the measures (model) or the feature groups (log). */
  compute_s?: number;
  error?: string;
}

/** The rows of the table: each observation joined with the size of its input file, then a row for each input that has no observation (it could not be read). */
export function measurementRows(m: Measurement): MeasurementRow[] {
  const inputs = new Map(m.inputs.map((i) => [i.input, i]));
  const rows: MeasurementRow[] = m.observations.map((o) => {
    const source = inputs.get(o.input);
    return {
      observation: o.observation,
      input: o.input,
      miner: o.miner,
      events: source?.events,
      traces: source?.traces,
      variants: source?.variants,
      activities: source?.activities,
      net: o.net ?? source?.net ?? null,
      read_s: source?.read_s,
      discovery_s: o.discovery_s,
      compute_s: o.measures_s ?? o.features_s,
      error: o.error ?? source?.error,
    };
  });
  // An input that could not be read has no observation of its own.
  const observed = new Set(m.observations.map((o) => o.input));
  for (const source of m.inputs) {
    if (!observed.has(source.input)) rows.push({ observation: source.input, input: source.input, read_s: source.read_s, error: source.error });
  }
  return rows;
}

/** The sums of the stages over the dataset; each log's reading counts once. */
export function measurementTotals(m: Measurement): { read_s: number; discovery_s: number; compute_s: number; total_s: number } {
  const sum = (values: (number | undefined)[]) => values.reduce<number>((a, v) => a + (v ?? 0), 0);
  return {
    read_s: sum(m.inputs.map((i) => i.read_s)),
    discovery_s: sum(m.observations.map((o) => o.discovery_s)),
    compute_s: sum(m.observations.map((o) => o.measures_s ?? o.features_s)),
    total_s: m.total_s,
  };
}

