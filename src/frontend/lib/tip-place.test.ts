// Unit tests for tip-place.ts.

import { describe, expect, it } from "vitest";
import { TIP_EDGE, TIP_GAP, placeTip, unfoldLeft } from "./tip-place";

const view = { width: 1000, height: 800 };
const rect = (left: number, top: number, width: number, height: number) => ({
  left,
  top,
  right: left + width,
  bottom: top + height,
});

describe("placeTip", () => {
  it("stands centred under an element narrower than the box, never over it", () => {
    const p = placeTip(rect(500, 100, 32, 32), { width: 120, height: 30 }, view);
    expect(p.top).toBe(132 + TIP_GAP);
    expect(p.bottom).toBeUndefined();
    expect(p.left).toBe(516 - 60);
  });

  it("starts where the pointer came in under a wider element, held inside it", () => {
    const anchor = rect(100, 100, 400, 30);
    expect(placeTip(anchor, { width: 120, height: 30 }, view, 200).left).toBe(200);
    // Near the element's right edge it stays flush with it rather than hanging past.
    expect(placeTip(anchor, { width: 120, height: 30 }, view, 480).left).toBe(380);
  });

  it("goes over the element where there is no room under it, with the room for stage 2", () => {
    const anchor = rect(500, 750, 32, 32);
    const p = placeTip(anchor, { width: 120, height: 30 }, view);
    expect(p.top).toBeUndefined();
    expect(p.bottom).toBe(800 - 750 + TIP_GAP);
    // Stage 1 would fit under an element higher up, but not with stage 2 unfolded.
    const higher = rect(500, 640, 32, 32);
    expect(placeTip(higher, { width: 120, height: 30 }, view).top).toBeDefined();
    expect(placeTip(higher, { width: 120, height: 30 }, view, undefined, 120).bottom).toBeDefined();
  });

  it("stays inside the window", () => {
    expect(placeTip(rect(990, 100, 10, 10), { width: 200, height: 30 }, view).left).toBe(1000 - 200 - TIP_EDGE);
    expect(placeTip(rect(0, 100, 10, 10), { width: 200, height: 30 }, view).left).toBe(TIP_EDGE);
  });
});

describe("unfoldLeft", () => {
  it("keeps the name where it stood unless the wider box would leave the window", () => {
    expect(unfoldLeft(300, 340, view)).toBe(300);
    expect(unfoldLeft(800, 340, view)).toBe(1000 - 340 - TIP_EDGE);
  });
});
