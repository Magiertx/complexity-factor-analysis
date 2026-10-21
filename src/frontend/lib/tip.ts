/*
 * The timing of the one tooltip of the app, in two stages, without the DOM. The React side
 * (components/ui/tip.tsx) feeds it the events of the elements and draws what `view` says.
 *
 *   name    stage 1: what the element is, in one to three words. Also the accessible name of a
 *           control without text of its own.
 *   more    stage 2: what it does, a sentence or two. Optional.
 *   keyCap  a key, shown as a cap behind the name. Optional.
 *   reason  for a blocked element: why, and the way out. Stands in stage 1.
 *   no name, only `more`: the word is already on screen. On a term (any text that is no control)
 *           the explanation comes after the wait of a name; on a control with its word on it after
 *           the full wait of an explanation, since a pointer on a button is usually on its way to
 *           press it.
 *
 *   mouse     the name after 0.7 s, the explanation 2 s after arrival, in the same box; a thin bar
 *             under the name fills while the explanation is on its way; a press closes the box
 *   next one  moving on to a neighbour while the box is up, or within 0.8 s after it closed, shows
 *             the neighbour's name after 0.3 s instead of 0.7 (the "ratchet" of menu bars, never at
 *             once); its explanation again 2 s after arrival
 *   keyboard  a focus by keys shows the name at once and the explanation 2 s later; a box the focus
 *             opened is never enterable
 *   touch     a long press (0.5 s) shows both and does not trigger the element; it stays 3 s
 *   Escape    closes the box (and ends a name still on its way); the key goes on to everyone else
 *   Enter, Space  trigger the element and close the box, like a press
 *
 * A box with something to read (a reason or an explanation) is enterable: a pointer inside keeps it
 * open. A bare name lets the pointer through and closes as the pointer leaves the element.
 *
 * Ported from the tooltip of Queue to Cue (`use:tipp`).
 */

/** The pointer rests on an element: its name appears. */
export const TIP_NAME_MS = 700;
/** Counted from arrival (pointer) or from the focus: the explanation joins the name in the same box. */
export const TIP_MORE_MS = 2000;
/** After a box closed, the next element's name comes sooner for this long (the "ratchet"). */
export const TIP_WARM_MS = 800;
/** The name of the next element in that warm while; never 0, or a name flashes under every button crossed. */
export const TIP_WARM_NAME_MS = 300;
/** Leaving the element: this long to reach the box before it closes. */
export const TIP_GRACE_MS = 120;
/** Touch: how long a press must hold to count as a long press. */
export const TIP_PRESS_MS = 500;
/** Touch: how long the box stays after a long press. */
export const TIP_TOUCH_STAYS_MS = 3000;

/** A finger that moves farther than this during the press is scrolling, not pressing. */
const PRESS_SLOP = 10;
/** After a long press the click that may follow it is swallowed for this long (from lifting the finger). */
const SWALLOW_MS = 400;

const MODIFIERS = new Set(["Shift", "Control", "Alt", "Meta", "AltGraph", "CapsLock"]);

export interface TipArgs {
  name?: string;
  more?: string;
  keyCap?: string;
  reason?: string;
}

/** What the argument says, or null when there is nothing to show (a tooltip needs a name or an explanation). */
export function cleanTip(p: TipArgs | null | undefined | false): TipArgs | null {
  if (!p) return null;
  const text = (s: string | undefined) => (s && s.trim() ? s : undefined);
  const a: TipArgs = { name: text(p.name), more: text(p.more), keyCap: text(p.keyCap), reason: text(p.reason) };
  return a.name || a.more ? a : null;
}

/** One element with a tooltip. `el` is whatever the caller needs to find it again, e.g. the DOM node. */
export interface TipEntry<E = unknown> {
  el: E;
  args: TipArgs | null;
  /** A control with its word on it: a tooltip with only an explanation waits the full 2 s. */
  control: boolean;
  /** Where the pointer came in (window x), for the box's left edge. */
  x: number | undefined;
  /** The element has the keyboard focus, so a pointer leaving it does not close the box. */
  focused: boolean;
  pressTimer: ReturnType<typeof setTimeout> | undefined;
  pressAt: { x: number; y: number } | null;
  swallowClick: boolean;
  swallowTimer: ReturnType<typeof setTimeout> | undefined;
}

export function tipEntry<E>(el: E, args: TipArgs | null | undefined, control: boolean): TipEntry<E> {
  return {
    el,
    args: cleanTip(args),
    control,
    x: undefined,
    focused: false,
    pressTimer: undefined,
    pressAt: null,
    swallowClick: false,
    swallowTimer: undefined,
  };
}

/** What the box shows, or null while it is closed. */
export interface TipView<E = unknown> {
  entry: TipEntry<E>;
  args: TipArgs;
  /** 1: the name (and a reason); 2: with the explanation unfolded under it. */
  stage: 1 | 2;
  /** Stage 1 waits this long for stage 2, and the bar fills in that time; null when nothing follows. */
  waitMs: number | null;
  /** The keyboard focus opened it: never enterable. */
  byFocus: boolean;
  /** Holds something to read, so a pointer inside keeps it open. */
  enterable: boolean;
  /** Changes with every opening, so the box is placed anew and the bar starts again. */
  serial: number;
  /** Changes when the words change or the element moves while the box is up: placed again, same stage. */
  revision: number;
}

type TimerKey = "name" | "more" | "close" | "warm" | "touch";

export class TipController<E = unknown> {
  private shown: TipEntry<E> | null = null;
  private pending: TipEntry<E> | null = null;
  private warm = false;
  /** The last input was the keyboard: a focus then shows the name (a focus from a mouse press does not). */
  private keyboard = false;
  private timers: Partial<Record<TimerKey, ReturnType<typeof setTimeout>>> = {};
  private serial = 0;
  private current: TipView<E> | null = null;
  private listeners = new Set<() => void>();

  /** For useSyncExternalStore. */
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  view = (): TipView<E> | null => this.current;

  /** Whether a box is up or a name is on its way, i.e. whether the page's events concern the tooltip. */
  get busy(): boolean {
    return this.shown !== null || this.pending !== null;
  }

  /** The element whose box is up or whose name is on its way. */
  get active(): TipEntry<E> | null {
    return this.shown ?? this.pending;
  }

  private emit() {
    for (const l of this.listeners) l();
  }

  private setTimer(key: TimerKey, fn: () => void, ms: number) {
    this.clearTimer(key);
    this.timers[key] = setTimeout(() => {
      delete this.timers[key];
      fn();
    }, ms);
  }

  private clearTimer(key: TimerKey) {
    const t = this.timers[key];
    if (t !== undefined) clearTimeout(t);
    delete this.timers[key];
  }

  private waitsForMore(entry: TipEntry<E>): boolean {
    const a = entry.args;
    return !!a && !a.name && entry.control;
  }

  /** Sets the full wait of an explanation without a name going; nothing is shown yet. */
  private waitForExplanation(entry: TipEntry<E>, byFocus = false) {
    // The box of a neighbour goes now: its close (which ends whatever waits) must not end this wait.
    if (this.shown && this.shown !== entry) this.close();
    this.clearTimer("name");
    this.pending = entry;
    this.setTimer("name", () => this.show(entry, 0, byFocus), TIP_MORE_MS);
  }

  /** Puts the box on `entry`; `moreIn` is the time until the explanation joins (0: at once). */
  private show(entry: TipEntry<E>, moreIn: number, byFocus = false) {
    const a = entry.args;
    if (!a) return;
    this.shown = entry;
    this.pending = null;
    this.clearTimer("name");
    this.clearTimer("close");
    this.clearTimer("more");
    this.clearTimer("touch");
    const unfolded = !!a.more && (!a.name || moreIn <= 0);
    this.current = {
      entry,
      args: a,
      stage: unfolded ? 2 : 1,
      waitMs: a.more && !unfolded ? moreIn : null,
      byFocus,
      enterable: !byFocus && (!!a.reason || !!a.more),
      serial: ++this.serial,
      revision: 0,
    };
    if (a.more && !unfolded) this.setTimer("more", () => this.stage2(), moreIn);
    this.emit();
  }

  private stage2() {
    if (!this.current) return;
    this.current = { ...this.current, stage: 2, waitMs: null };
    this.emit();
  }

  /**
   * The words changed while the box is up: they change in place, the stage and its clock stay. Only
   * an explanation that comes or goes changes the stage.
   */
  private refresh(entry: TipEntry<E>) {
    const view = this.current;
    const a = entry.args;
    if (!view || !a) return;
    let { stage, waitMs } = view;
    if (!a.more) {
      this.clearTimer("more");
      stage = 1;
      waitMs = null;
    } else if (!a.name) {
      this.clearTimer("more");
      stage = 2;
      waitMs = null;
    } else if (stage === 1 && this.timers.more === undefined) {
      waitMs = TIP_MORE_MS;
      this.setTimer("more", () => this.stage2(), TIP_MORE_MS);
    }
    this.current = {
      ...view,
      args: a,
      stage,
      waitMs,
      enterable: !view.byFocus && (!!a.reason || !!a.more),
      revision: view.revision + 1,
    };
    this.emit();
  }

  /**
   * Closes the box and ends a name still on its way. `warm`: the next element's name comes sooner
   * for a short while; a close because the page moved is no such move and ends the warmth.
   */
  close(warm = true) {
    this.clearTimer("name");
    this.clearTimer("more");
    this.clearTimer("close");
    this.clearTimer("touch");
    this.pending = null;
    if (!warm) {
      this.clearTimer("warm");
      this.warm = false;
    }
    if (!this.shown) return;
    this.shown = null;
    this.current = null;
    this.emit();
    if (warm) {
      this.warm = true;
      this.setTimer("warm", () => (this.warm = false), TIP_WARM_MS);
    }
  }

  private scheduleClose() {
    this.setTimer("close", () => this.close(), TIP_GRACE_MS);
  }

  private cancelPending(entry: TipEntry<E>) {
    if (this.pending !== entry) return;
    this.clearTimer("name");
    this.pending = null;
  }

  // ---- the element's events ----------------------------------------------------------------

  /** A mouse or pen arrives at the element, with no button held (a drag asks nothing of what it crosses). */
  pointerEnter(entry: TipEntry<E>, x?: number) {
    if (!entry.args) return;
    entry.x = x;
    if (this.shown !== entry && this.waitsForMore(entry)) {
      this.waitForExplanation(entry);
      return;
    }
    this.clearTimer("close");
    if (this.shown === entry) return;
    this.clearTimer("name");
    this.pending = null;
    // A box that is up, or one that closed a moment ago: it goes now, and this name comes after the
    // short wait; the explanation keeps its 2 s from arrival.
    const wait = this.shown || this.warm ? TIP_WARM_NAME_MS : TIP_NAME_MS;
    if (this.shown) this.close();
    this.pending = entry;
    this.setTimer("name", () => this.show(entry, TIP_MORE_MS - wait), wait);
  }

  pointerLeave(entry: TipEntry<E>) {
    // The keyboard focus may be waiting for this very element's explanation; the pointer leaving does not end that.
    if (!entry.focused) this.cancelPending(entry);
    if (this.shown === entry && !entry.focused) this.scheduleClose();
  }

  pointerDown(entry: TipEntry<E>, pointerType: string, x = 0, y = 0) {
    if (pointerType !== "touch") {
      // A press is an answer to the element, not a question about it: whatever waits, stops.
      this.cancelPending(entry);
      if (this.shown === entry) this.close();
      return;
    }
    if (!entry.args) return;
    if (this.shown === entry) this.close();
    entry.swallowClick = false;
    if (entry.swallowTimer !== undefined) clearTimeout(entry.swallowTimer);
    entry.pressAt = { x, y };
    if (entry.pressTimer !== undefined) clearTimeout(entry.pressTimer);
    entry.pressTimer = setTimeout(() => this.longPress(entry), TIP_PRESS_MS);
  }

  pointerMove(entry: TipEntry<E>, pointerType: string, x: number, y: number) {
    if (pointerType !== "touch" || entry.pressTimer === undefined || !entry.pressAt) return;
    if (Math.hypot(x - entry.pressAt.x, y - entry.pressAt.y) > PRESS_SLOP) this.endPress(entry);
  }

  /** The finger lifts, or the browser takes the gesture over. */
  pointerUp(entry: TipEntry<E>, pointerType: string) {
    if (pointerType === "touch") this.endPress(entry);
  }

  private longPress(entry: TipEntry<E>) {
    entry.pressTimer = undefined;
    entry.swallowClick = true;
    entry.x = entry.pressAt?.x;
    this.show(entry, 0);
    this.setTimer("touch", () => this.close(), TIP_TOUCH_STAYS_MS);
  }

  private endPress(entry: TipEntry<E>) {
    if (entry.pressTimer !== undefined) clearTimeout(entry.pressTimer);
    entry.pressTimer = undefined;
    entry.pressAt = null;
    if (entry.swallowClick) {
      // The click of a long press follows the lifting of the finger at once, or not at all.
      if (entry.swallowTimer !== undefined) clearTimeout(entry.swallowTimer);
      entry.swallowTimer = setTimeout(() => {
        entry.swallowClick = false;
        entry.swallowTimer = undefined;
      }, SWALLOW_MS);
    }
  }

  /** Whether this click is the one after a long press, which must not trigger the element. */
  swallowsClick(entry: TipEntry<E>): boolean {
    if (!entry.swallowClick) return false;
    entry.swallowClick = false;
    return true;
  }

  /** Whether the context menu of a long press should be held back. */
  holdsContextMenu(entry: TipEntry<E>): boolean {
    return entry.pressTimer !== undefined || entry.swallowClick;
  }

  /** The element took the focus; only a focus by keys shows anything. */
  focusIn(entry: TipEntry<E>) {
    if (!entry.args || !this.keyboard) return;
    entry.focused = true;
    entry.x = undefined;
    this.clearTimer("name");
    this.clearTimer("close");
    if (this.waitsForMore(entry)) {
      this.waitForExplanation(entry, true);
      return;
    }
    this.show(entry, TIP_MORE_MS, true);
  }

  focusOut(entry: TipEntry<E>) {
    entry.focused = false;
    this.cancelPending(entry);
    if (this.shown === entry) this.close();
  }

  /** Enter and Space trigger the element: an answer, like a press. */
  keyDown(entry: TipEntry<E>, key: string) {
    if ((key === "Enter" || key === " ") && this.shown === entry) this.close();
  }

  /** The words of the element changed. */
  update(entry: TipEntry<E>, args: TipArgs | null | undefined) {
    entry.args = cleanTip(args);
    if (this.shown === entry) {
      if (!entry.args) this.close();
      else this.refresh(entry);
    } else if (!entry.args) this.cancelPending(entry);
  }

  /** The element is gone. */
  remove(entry: TipEntry<E>) {
    if (entry.pressTimer !== undefined) clearTimeout(entry.pressTimer);
    if (entry.swallowTimer !== undefined) clearTimeout(entry.swallowTimer);
    entry.pressTimer = undefined;
    entry.swallowTimer = undefined;
    this.cancelPending(entry);
    if (this.shown === entry) this.close();
  }

  // ---- the page's events --------------------------------------------------------------------

  /**
   * Every key press, before anyone else sees it. A key marks the input as the keyboard's, which lets
   * a focus show its name. Escape ends whatever is up or on its way and is no keyboard work itself.
   * Returns whether it closed a box that was on screen.
   */
  key(key: string): boolean {
    if (key === "Escape") {
      const had = this.shown !== null;
      this.close();
      return had;
    }
    if (!MODIFIERS.has(key)) this.keyboard = true;
    return false;
  }

  /** Any pointer press marks the input as the pointer's. */
  pointerInput() {
    this.keyboard = false;
  }

  /** A press somewhere: in the box it changes nothing, on the element its own handler decides. */
  pressAnywhere(inBox: boolean, onElement: boolean) {
    if (inBox || onElement) return;
    this.close();
  }

  /**
   * Something scrolled. Only a scroll that moves the element counts. With the keyboard focus on the
   * element and the element still in view, the browser is bringing it into view: the box follows it.
   */
  scrolled(movesElement: boolean, elementInView: boolean) {
    if (!movesElement) return;
    const entry = this.shown ?? this.pending;
    if (entry?.focused && elementInView) {
      if (this.current && this.shown === entry) {
        this.current = { ...this.current, revision: this.current.revision + 1 };
        this.emit();
      }
      return;
    }
    this.close(false);
  }

  /** The window was resized or lost the focus. */
  pageChanged() {
    this.close(false);
  }

  /** The pointer is in the box. */
  boxEnter() {
    if (this.current?.enterable) this.clearTimer("close");
  }

  boxLeave() {
    if (this.shown && !this.shown.focused) this.scheduleClose();
  }
}
