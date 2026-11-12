// The `useProm` hook: whether event logs can be mined here.

import { useEffect, useState } from "react";
import { fetchCapabilities, type Capabilities } from "./api";

// Asked once per page load; a failed question is asked again by the next component that needs it.
let asked: Promise<Capabilities> | null = null;

function capabilities(): Promise<Capabilities> {
  asked ??= fetchCapabilities().catch((e) => {
    asked = null;
    throw e;
  });
  return asked;
}

/**
 * False once the server has said it has no ProM (the desktop app). True until then and where the
 * question fails, so that a slow or older server never blocks a run that would have worked.
 */
export function useProm(): boolean {
  const [prom, setProm] = useState(true);
  useEffect(() => {
    let live = true;
    capabilities()
      .then((c) => live && setProm(c.prom !== false))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  return prom;
}
