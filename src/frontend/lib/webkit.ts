"use client";

// Whether the page runs in WebKit: Safari, and every browser on an iPhone or iPad.

import { useEffect, useState } from "react";

/**
 * True in WebKit, once the page runs in the browser (false while it is rendered ahead and in its
 * first paint). WebKit does not always repaint a sticky element whose contents change while the
 * page above it changes height (WebKit bug 244139, open since Safari 15): on a Mac the bar at the
 * end of the data step kept the old button, and the area above it stayed empty. Where it matters,
 * such an element is not sticky in WebKit. Safari and the browsers on iOS name Apple as vendor;
 * Chrome names Google, Firefox nobody.
 */
export function useWebKit(): boolean {
  const [webkit, setWebkit] = useState(false);
  useEffect(() => setWebkit(navigator.vendor === "Apple Computer, Inc."), []);
  return webkit;
}
