// Unit tests for tip.ts.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TIP_GRACE_MS,
  TIP_MORE_MS,
  TIP_NAME_MS,
  TIP_PRESS_MS,
  TIP_TOUCH_STAYS_MS,
  TIP_WARM_MS,
  TIP_WARM_NAME_MS,
  TipController,
  cleanTip,
  tipEntry,
  type TipArgs,
} from "./tip";

// The waits are written out in the tests, not read from the constants: a test that waits
// TIP_NAME_MS would stay green if someone set it to 0. The constants are checked once.

let tips: TipController<string>;
const made = (name: string, args: TipArgs | null, control = true) => tipEntry(name, args, control);
const shown = () => tips.view()?.entry.el ?? null;
const stage = () => tips.view()?.stage ?? null;

beforeEach(() => {
  vi.useFakeTimers();
  tips = new TipController<string>();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the rule", () => {
  it("has the waits of the two-stage tooltip", () => {
    expect(TIP_NAME_MS).toBe(700);
    expect(TIP_MORE_MS).toBe(2000);
    expect(TIP_WARM_MS).toBe(800);
    expect(TIP_WARM_NAME_MS).toBe(300);
    expect(TIP_GRACE_MS).toBe(120);
    expect(TIP_PRESS_MS).toBe(500);
    expect(TIP_TOUCH_STAYS_MS).toBe(3000);
  });

  it("needs a name or an explanation", () => {
    expect(cleanTip({ name: "  " })).toBeNull();
    expect(cleanTip({ keyCap: "K" })).toBeNull();
    expect(cleanTip(null)).toBeNull();
    expect(cleanTip({ more: "Does a thing." })).toEqual({ more: "Does a thing." });
  });
});

describe("mouse", () => {
  it("shows the name after 0.7 s and the explanation 2 s after arrival, in the same box", () => {
    const a = made("a", { name: "Copy link", more: "Copies a link." });
    tips.pointerEnter(a, 10);
    vi.advanceTimersByTime(699);
    expect(shown()).toBeNull();
    vi.advanceTimersByTime(1);
    expect(shown()).toBe("a");
    expect(stage()).toBe(1);
    // The bar fills in the time left until the explanation.
    expect(tips.view()?.waitMs).toBe(1300);
    const serial = tips.view()?.serial;
    vi.advanceTimersByTime(1299);
    expect(stage()).toBe(1);
    vi.advanceTimersByTime(1);
    expect(stage()).toBe(2);
    expect(tips.view()?.waitMs).toBeNull();
    // The same box: the opening did not start over.
    expect(tips.view()?.serial).toBe(serial);
  });

  it("shows nothing for a pointer that passes by", () => {
    const a = made("a", { name: "Export" });
    tips.pointerEnter(a);
    vi.advanceTimersByTime(500);
    tips.pointerLeave(a);
    vi.advanceTimersByTime(2000);
    expect(shown()).toBeNull();
  });

  it("closes a bare name shortly after the pointer leaves", () => {
    const a = made("a", { name: "Export" });
    tips.pointerEnter(a);
    vi.advanceTimersByTime(700);
    tips.pointerLeave(a);
    vi.advanceTimersByTime(119);
    expect(shown()).toBe("a");
    vi.advanceTimersByTime(1);
    expect(shown()).toBeNull();
  });

  it("keeps a box with something to read open while the pointer is in it", () => {
    const a = made("a", { name: "Next", reason: "Open a dataset first." });
    tips.pointerEnter(a);
    vi.advanceTimersByTime(700);
    expect(tips.view()?.enterable).toBe(true);
    tips.pointerLeave(a);
    tips.boxEnter();
    vi.advanceTimersByTime(5000);
    expect(shown()).toBe("a");
    tips.boxLeave();
    vi.advanceTimersByTime(120);
    expect(shown()).toBeNull();
  });

  it("does not hold a bare name when the pointer moves into it", () => {
    const a = made("a", { name: "Export" });
    tips.pointerEnter(a);
    vi.advanceTimersByTime(700);
    expect(tips.view()?.enterable).toBe(false);
    tips.pointerLeave(a);
    tips.boxEnter();
    vi.advanceTimersByTime(120);
    expect(shown()).toBeNull();
  });

  it("closes on a press and ends a name still on its way", () => {
    const a = made("a", { name: "Export", more: "Downloads." });
    tips.pointerEnter(a);
    vi.advanceTimersByTime(700);
    tips.pointerDown(a, "mouse");
    expect(shown()).toBeNull();
    const b = made("b", { name: "Tour" });
    tips.pointerEnter(b);
    vi.advanceTimersByTime(200);
    tips.pointerDown(b, "mouse");
    vi.advanceTimersByTime(2000);
    expect(shown()).toBeNull();
  });

  it("shows the reason of a blocked element in stage 1", () => {
    const a = made("a", { name: "Next", reason: "Open a dataset first.", more: "Goes on." });
    tips.pointerEnter(a);
    vi.advanceTimersByTime(700);
    expect(tips.view()?.args.reason).toBe("Open a dataset first.");
    expect(stage()).toBe(1);
  });
});

describe("the ratchet", () => {
  it("shows the neighbour's name after 0.3 s while a box is up, its explanation 2 s after arrival", () => {
    const a = made("a", { name: "A" });
    const b = made("b", { name: "B", more: "Bee." });
    tips.pointerEnter(a);
    vi.advanceTimersByTime(700);
    tips.pointerLeave(a);
    tips.pointerEnter(b);
    // The box of A goes at once, B's name is not there at once either.
    expect(shown()).toBeNull();
    vi.advanceTimersByTime(299);
    expect(shown()).toBeNull();
    vi.advanceTimersByTime(1);
    expect(shown()).toBe("b");
    expect(tips.view()?.waitMs).toBe(1700);
    vi.advanceTimersByTime(1700);
    expect(stage()).toBe(2);
  });

  it("stays warm for 0.8 s after a box closed", () => {
    const a = made("a", { name: "A" });
    const b = made("b", { name: "B" });
    tips.pointerEnter(a);
    vi.advanceTimersByTime(700);
    tips.pointerLeave(a);
    vi.advanceTimersByTime(120); // closed
    vi.advanceTimersByTime(600); // 0.6 s after the close
    tips.pointerEnter(b);
    vi.advanceTimersByTime(300);
    expect(shown()).toBe("b");
  });

  it("is cold again after 0.8 s", () => {
    const a = made("a", { name: "A" });
    const b = made("b", { name: "B" });
    tips.pointerEnter(a);
    vi.advanceTimersByTime(700);
    tips.pointerLeave(a);
    vi.advanceTimersByTime(120 + 800);
    tips.pointerEnter(b);
    vi.advanceTimersByTime(300);
    expect(shown()).toBeNull();
    vi.advanceTimersByTime(400);
    expect(shown()).toBe("b");
  });

  it("is not warm after a close because the page moved", () => {
    const a = made("a", { name: "A" });
    const b = made("b", { name: "B" });
    tips.pointerEnter(a);
    vi.advanceTimersByTime(700);
    tips.pageChanged();
    tips.pointerEnter(b);
    vi.advanceTimersByTime(300);
    expect(shown()).toBeNull();
    vi.advanceTimersByTime(400);
    expect(shown()).toBe("b");
  });
});

describe("keyboard", () => {
  it("shows the name at once and the explanation 2 s after the focus", () => {
    const a = made("a", { name: "Copy link", more: "Copies a link." });
    tips.key("Tab");
    tips.focusIn(a);
    expect(shown()).toBe("a");
    expect(stage()).toBe(1);
    expect(tips.view()?.byFocus).toBe(true);
    expect(tips.view()?.enterable).toBe(false);
    vi.advanceTimersByTime(1999);
    expect(stage()).toBe(1);
    vi.advanceTimersByTime(1);
    expect(stage()).toBe(2);
  });

  it("shows nothing for a focus that follows a press", () => {
    const a = made("a", { name: "Copy link" });
    tips.key("Tab");
    tips.pointerInput();
    tips.focusIn(a);
    vi.advanceTimersByTime(3000);
    expect(shown()).toBeNull();
  });

  it("does not count Escape or a modifier as keyboard work", () => {
    const a = made("a", { name: "Copy link" });
    tips.pointerInput();
    tips.key("Escape");
    tips.key("Shift");
    tips.focusIn(a);
    expect(shown()).toBeNull();
  });

  it("closes with the focus, and Enter or Space close the box like a press", () => {
    const a = made("a", { name: "A" });
    tips.key("Tab");
    tips.focusIn(a);
    tips.keyDown(a, "Enter");
    expect(shown()).toBeNull();
    tips.focusIn(a);
    tips.focusOut(a);
    expect(shown()).toBeNull();
  });

  it("keeps the box of the focused element when the pointer leaves it", () => {
    const a = made("a", { name: "A", more: "More." });
    tips.key("Tab");
    tips.focusIn(a);
    tips.pointerEnter(a);
    tips.pointerLeave(a);
    vi.advanceTimersByTime(2000);
    expect(shown()).toBe("a");
    expect(stage()).toBe(2);
  });
});

describe("an explanation without a name", () => {
  it("waits the full 2 s on a control, whose word is on it", () => {
    const a = made("a", { more: "Downloads the analysis." }, true);
    tips.pointerEnter(a);
    vi.advanceTimersByTime(1999);
    expect(shown()).toBeNull();
    vi.advanceTimersByTime(1);
    expect(shown()).toBe("a");
    expect(stage()).toBe(2);
  });

  it("comes after the wait of a name on a term, unfolded at once", () => {
    const a = made("a", { more: "The share of variance." }, false);
    tips.pointerEnter(a);
    vi.advanceTimersByTime(700);
    expect(shown()).toBe("a");
    expect(stage()).toBe(2);
  });

  it("is there at once when a term takes the keyboard focus", () => {
    const a = made("a", { more: "The share of variance." }, false);
    tips.key("Tab");
    tips.focusIn(a);
    expect(stage()).toBe(2);
  });
});

describe("touch", () => {
  it("shows both after a long press of 0.5 s, swallows the click and stays 3 s", () => {
    const a = made("a", { name: "Export", more: "Downloads." });
    tips.pointerDown(a, "touch", 5, 5);
    vi.advanceTimersByTime(499);
    expect(shown()).toBeNull();
    vi.advanceTimersByTime(1);
    expect(shown()).toBe("a");
    expect(stage()).toBe(2);
    tips.pointerUp(a, "touch");
    expect(tips.swallowsClick(a)).toBe(true);
    // Only the one click after the press.
    expect(tips.swallowsClick(a)).toBe(false);
    vi.advanceTimersByTime(2999);
    expect(shown()).toBe("a");
    vi.advanceTimersByTime(1);
    expect(shown()).toBeNull();
  });

  it("lets a short tap through", () => {
    const a = made("a", { name: "Export" });
    tips.pointerDown(a, "touch", 5, 5);
    vi.advanceTimersByTime(200);
    tips.pointerUp(a, "touch");
    vi.advanceTimersByTime(1000);
    expect(shown()).toBeNull();
    expect(tips.swallowsClick(a)).toBe(false);
  });

  it("takes a finger that moves for a scroll", () => {
    const a = made("a", { name: "Export" });
    tips.pointerDown(a, "touch", 5, 5);
    tips.pointerMove(a, "touch", 5, 30);
    vi.advanceTimersByTime(600);
    expect(shown()).toBeNull();
  });
});

describe("Escape and the page", () => {
  it("closes with Escape and says so, and ends a name on its way", () => {
    const a = made("a", { name: "A" });
    tips.pointerEnter(a);
    vi.advanceTimersByTime(700);
    expect(tips.key("Escape")).toBe(true);
    expect(shown()).toBeNull();
    tips.pointerLeave(a);
    tips.pointerEnter(a);
    vi.advanceTimersByTime(100);
    expect(tips.key("Escape")).toBe(false);
    vi.advanceTimersByTime(2000);
    expect(shown()).toBeNull();
  });

  it("closes on a press elsewhere, not on one in the box", () => {
    const a = made("a", { name: "A", more: "More." });
    tips.pointerEnter(a);
    vi.advanceTimersByTime(700);
    tips.pressAnywhere(true, false);
    expect(shown()).toBe("a");
    tips.pressAnywhere(false, false);
    expect(shown()).toBeNull();
  });

  it("follows a focused element the browser scrolls into view, and closes on other scrolls", () => {
    const a = made("a", { name: "A" });
    tips.key("Tab");
    tips.focusIn(a);
    const revision = tips.view()?.revision ?? 0;
    tips.scrolled(true, true);
    expect(tips.view()?.revision).toBe(revision + 1);
    tips.scrolled(false, false);
    expect(shown()).toBe("a");
    tips.scrolled(true, false);
    expect(shown()).toBeNull();
  });

  it("changes the words in place without starting the wait again", () => {
    const a = made("a", { name: "Copy link", more: "Copies." });
    tips.pointerEnter(a);
    vi.advanceTimersByTime(700);
    const serial = tips.view()?.serial;
    vi.advanceTimersByTime(500);
    tips.update(a, { name: "Copied", more: "Copies." });
    expect(tips.view()?.args.name).toBe("Copied");
    expect(tips.view()?.serial).toBe(serial);
    vi.advanceTimersByTime(800);
    expect(stage()).toBe(2);
    tips.update(a, null);
    expect(shown()).toBeNull();
  });

  it("closes when its element goes", () => {
    const a = made("a", { name: "A" });
    tips.pointerEnter(a);
    vi.advanceTimersByTime(700);
    tips.remove(a);
    expect(shown()).toBeNull();
  });
});
