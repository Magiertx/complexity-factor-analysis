/**
 * An event log as XES, built from traces of activity names: small enough to be read in a
 * moment, and with a different number of traces and events for each `seed`, so that a dataset of
 * several of them has measures that vary.
 */
export function xesLog(name: string, seed: number): Buffer {
  const activities = ["register", "check", "decide", "pay", "close", "archive"];
  const traces: string[] = [];
  for (let i = 0; i < 3 + seed; i++) {
    const length = 3 + ((i + seed) % 4);
    const events: string[] = [];
    for (let j = 0; j < length; j++) {
      const activity = activities[(i + j * (seed + 1)) % activities.length];
      const minute = String((i * 7 + j * 3) % 60).padStart(2, "0");
      events.push(
        `    <event><string key="concept:name" value="${activity}"/>` +
          `<date key="time:timestamp" value="2024-01-${String(1 + i).padStart(2, "0")}T10:${minute}:00.000+00:00"/></event>`,
      );
    }
    traces.push(`  <trace>\n    <string key="concept:name" value="${name}-case-${i}"/>\n${events.join("\n")}\n  </trace>`);
  }
  return Buffer.from(
    `<?xml version="1.0" encoding="UTF-8"?>\n<log xes.version="1.0" xmlns="http://www.xes-standard.org/">\n` +
      `  <string key="concept:name" value="${name}"/>\n${traces.join("\n")}\n</log>\n`,
  );
}

/** The files of `count` such logs, named `log1.xes`, `log2.xes`, ..., for a file input. */
export function xesFiles(count: number): { name: string; mimeType: string; buffer: Buffer }[] {
  return Array.from({ length: count }, (_, i) => ({
    name: `log${i + 1}.xes`,
    mimeType: "application/xml",
    buffer: xesLog(`log${i + 1}`, i + 1),
  }));
}
