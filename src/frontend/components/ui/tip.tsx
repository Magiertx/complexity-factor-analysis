"use client";

// The tooltip of the app: hooks that hang it on elements, and the layer that draws it.

import {
  Children,
  cloneElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactElement,
  type Ref,
  type RefCallback,
} from "react";
import { createPortal } from "react-dom";
import { TipController, cleanTip, tipEntry, type TipArgs, type TipEntry, type TipView } from "@/lib/tip";
import { placeTip, unfoldLeft } from "@/lib/tip-place";
import { cn } from "@/lib/utils";

/*
 * The one tooltip of the app, in two stages, instead of the `title` attribute (timing: lib/tip.ts,
 * place: lib/tip-place.ts). `useTip` or `<Tip>` hang it on an element, `useTipZone` on the cells of a
 * table; InfoTip (info-tip.tsx) puts an explanation behind an (i). `<TipLayer>` draws the one box
 * for the document in a portal.
 *
 * Screen readers: the name becomes the element's `aria-label` when it has no text or label of its
 * own (those win); the reason and the explanation are its `aria-description` from the start, and
 * while the box is up the element points at it with `aria-describedby` as well.
 *
 * A blocked element keeps the pointer and the focus with `aria-disabled` instead of `disabled`, so
 * its reason can be shown.
 */

export type { TipArgs } from "@/lib/tip";

/** The box's id: what `aria-describedby` points at. */
export const TIP_ID = "app-tip";

/** What counts as a control: a tooltip with only an explanation waits the full 2 s on one. */
const CONTROL =
  'button, a[href], summary, input, select, textarea, label, [tabindex]:not([tabindex="-1"]), [role="button"],' +
  ' [role="link"], [role="menuitem"], [role="tab"], [role="option"], [role="switch"], [role="checkbox"], [role="radio"]';

let controller: TipController<HTMLElement> | null = null;
/** The one controller of the document, made when first needed. */
function tips(): TipController<HTMLElement> {
  if (!controller) controller = new TipController<HTMLElement>();
  return controller;
}

/** The Escape presses that closed a box that was up, so a dialog behind it does not close as well. */
const tookEscape = new WeakSet<Event>();

/** Whether this Escape press closed a tooltip that was on screen; a dialog asks before it closes. */
export function tipTookEscape(e: Event | { nativeEvent: Event }): boolean {
  return tookEscape.has("nativeEvent" in e ? e.nativeEvent : e);
}

// ---- screen readers -----------------------------------------------------------------------------

interface Meta {
  wroteLabel: string | null;
  wroteDescription: string | null;
  /** The tooltip's name says more than the element's own name, so it is read with the description. */
  nameSaid: boolean;
}

const metas = new WeakMap<HTMLElement, Meta>();
function metaOf(el: HTMLElement): Meta {
  let m = metas.get(el);
  if (!m) {
    m = { wroteLabel: null, wroteDescription: null, nameSaid: false };
    metas.set(el, m);
  }
  return m;
}

/** The text an element names itself with: what a screen reader hears of its content. */
function ownText(el: Element): string {
  let s = "";
  const walk = (node: Node) => {
    for (const c of node.childNodes) {
      if (c.nodeType === Node.TEXT_NODE) s += c.textContent ?? "";
      else if (c instanceof Element && c.getAttribute("aria-hidden") !== "true" && !c.hasAttribute("hidden")) walk(c);
    }
  };
  walk(el);
  return s.trim();
}

const squash = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

/** The name the element has without the tooltip: the author's aria-labelledby or aria-label, else its own text. */
function ownName(el: HTMLElement, ownLabel: boolean, labelAttr: string | null): string {
  if (!ownLabel) return ownText(el);
  const ids = el.getAttribute("aria-labelledby");
  if (ids) {
    return ids
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent ?? "")
      .join(" ")
      .trim();
  }
  return (labelAttr ?? "").trim();
}

/** Writes or takes back `aria-label` and `aria-description` for the arguments, never over the author's own. */
function syncAria(el: HTMLElement, args: TipArgs | null) {
  const meta = metaOf(el);
  const labelAttr = el.getAttribute("aria-label");
  const ownLabel = el.hasAttribute("aria-labelledby") || (labelAttr !== null && labelAttr !== meta.wroteLabel);
  const own = ownName(el, ownLabel, labelAttr);

  if (!ownLabel) {
    const label = args?.name && !own ? args.name : null;
    if (label !== null) {
      el.setAttribute("aria-label", label);
      meta.wroteLabel = label;
    } else if (meta.wroteLabel !== null) {
      if (el.getAttribute("aria-label") === meta.wroteLabel) el.removeAttribute("aria-label");
      meta.wroteLabel = null;
    }
  }

  meta.nameSaid = !!args?.name && !!own && !squash(own).includes(squash(args.name));
  const head = meta.nameSaid ? (args?.keyCap ? `${args.name} (${args.keyCap})` : args?.name) : args?.keyCap;
  const description = args ? [head, args.reason, args.more].filter(Boolean).join(" ") : "";
  const descAttr = el.getAttribute("aria-description");
  const ownDescription = descAttr !== null && descAttr !== meta.wroteDescription;
  if (ownDescription) return;
  if (description) {
    el.setAttribute("aria-description", description);
    meta.wroteDescription = description;
  } else if (meta.wroteDescription !== null) {
    if (el.getAttribute("aria-description") === meta.wroteDescription) el.removeAttribute("aria-description");
    meta.wroteDescription = null;
  }
}

const tokens = (el: Element) => (el.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean);

function link(el: Element) {
  const t = tokens(el);
  if (!t.includes(TIP_ID)) el.setAttribute("aria-describedby", [...t, TIP_ID].join(" "));
}

function unlink(el: Element) {
  const t = tokens(el).filter((x) => x !== TIP_ID);
  if (t.length) el.setAttribute("aria-describedby", t.join(" "));
  else el.removeAttribute("aria-describedby");
}

// ---- the element's events -----------------------------------------------------------------------

/** The focus event that the innermost element with a tooltip already answered. */
let answeredFocus: Event | null = null;

function attach(el: HTMLElement, entry: TipEntry<HTMLElement>): () => void {
  const c = tips();
  const offs: (() => void)[] = [];
  const on = <E extends Event>(type: string, fn: (e: E) => void, capture = false) => {
    el.addEventListener(type, fn as EventListener, capture);
    offs.push(() => el.removeEventListener(type, fn as EventListener, capture));
  };
  on<PointerEvent>("pointerenter", (e) => {
    // A pointer that arrives with a button held is dragging something across and asks nothing.
    if (e.pointerType === "touch" || e.buttons !== 0) return;
    c.pointerEnter(entry, e.clientX);
  });
  on<PointerEvent>("pointerleave", (e) => {
    if (e.pointerType !== "touch") c.pointerLeave(entry);
  });
  on<PointerEvent>("pointerdown", (e) => c.pointerDown(entry, e.pointerType, e.clientX, e.clientY), true);
  on<PointerEvent>("pointermove", (e) => c.pointerMove(entry, e.pointerType, e.clientX, e.clientY));
  on<PointerEvent>("pointerup", (e) => c.pointerUp(entry, e.pointerType));
  on<PointerEvent>("pointercancel", (e) => c.pointerUp(entry, e.pointerType));
  // The click some browsers send after a long press must not trigger the element.
  on<MouseEvent>(
    "click",
    (e) => {
      if (!c.swallowsClick(entry)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
    },
    true,
  );
  on<Event>("contextmenu", (e) => {
    if (c.holdsContextMenu(entry)) e.preventDefault();
  });
  on<FocusEvent>("focusin", (e) => {
    // focusin bubbles: the innermost element with a tooltip answers, not a container around it.
    if (!entry.args || e === answeredFocus) return;
    answeredFocus = e;
    c.focusIn(entry);
  });
  on<KeyboardEvent>("keydown", (e) => c.keyDown(entry, e.key));
  on<FocusEvent>("focusout", (e) => {
    if (e.relatedTarget instanceof Node && el.contains(e.relatedTarget)) return;
    c.focusOut(entry);
  });
  return () => offs.forEach((off) => off());
}

/**
 * Hangs the tooltip on an element: pass the returned ref to it. `null` or `false` shows nothing.
 * With `explains` the element is there for its explanation only (the (i) of InfoTip): the
 * explanation comes after the short wait of a name, not after the full wait of a control.
 */
export function useTip<T extends HTMLElement = HTMLElement>(
  args: TipArgs | null | undefined | false,
  opts?: { explains?: boolean },
): RefCallback<T> {
  const latest = useRef<TipArgs | null>(cleanTip(args));
  const entryRef = useRef<TipEntry<HTMLElement> | null>(null);
  const explains = !!opts?.explains;
  const ref = useCallback((el: T | null) => {
    if (!el) return;
    const entry = tipEntry<HTMLElement>(el, latest.current, !explains && el.matches(CONTROL));
    entryRef.current = entry;
    const off = attach(el, entry);
    syncAria(el, entry.args);
    return () => {
      off();
      tips().remove(entry);
      entry.args = null;
      syncAria(el, null);
      if (entryRef.current === entry) entryRef.current = null;
    };
  }, [explains]);
  const key = JSON.stringify(cleanTip(args));
  useLayoutEffect(() => {
    const next = JSON.parse(key) as TipArgs | null;
    latest.current = next;
    const entry = entryRef.current;
    if (!entry) return;
    tips().update(entry, next);
    syncAria(entry.el, entry.args);
  }, [key]);
  return ref;
}

/** Several refs as one, e.g. an element's own and its tooltip's. */
export function mergeRefs<T>(...refs: (Ref<T> | undefined)[]): RefCallback<T> {
  return (el: T | null) => {
    const cleanups = refs.map((r) => {
      if (typeof r === "function") {
        const cleanup = r(el);
        return typeof cleanup === "function" ? cleanup : () => r(null);
      }
      if (r) {
        (r as { current: T | null }).current = el;
        return () => {
          (r as { current: T | null }).current = null;
        };
      }
      return () => {};
    });
    return () => cleanups.forEach((c) => c());
  };
}

/** Hangs the tooltip on its one child, which must take a ref (an element or a component that passes it on). */
export function Tip({ children, ...args }: TipArgs & { children: ReactElement }) {
  const tip = useTip(args);
  const child = Children.only(children) as ReactElement<{ ref?: Ref<HTMLElement> }>;
  const own = child.props.ref;
  // Changes only with the child's own ref, so the tooltip is not hung anew with each render.
  const ref = useMemo(() => mergeRefs(own, tip), [own, tip]);
  return cloneElement(child, { ref });
}

/**
 * Tooltips for the cells of a table without one listener per cell: an element inside the container
 * with `data-tip` (the name) and/or `data-tip-more` (the explanation) shows them for the pointer,
 * and for a long press of a finger, which then does not trigger the element. For numbers a screen
 * reader already reads from the table, so the cells get no description; what a cell says that the
 * table does not is in the text of its row instead.
 */
export function useTipZone<T extends HTMLElement = HTMLElement>(): RefCallback<T> {
  return useCallback((zone: T | null) => {
    if (!zone) return;
    const c = tips();
    const entries = new WeakMap<HTMLElement, TipEntry<HTMLElement>>();
    let current: TipEntry<HTMLElement> | null = null;
    /** The element a finger is pressing, until the click that may follow has been dealt with. */
    let pressed: TipEntry<HTMLElement> | null = null;
    const argsOf = (el: HTMLElement): TipArgs => ({ name: el.dataset.tip, more: el.dataset.tipMore });
    const entryOf = (el: HTMLElement): TipEntry<HTMLElement> => {
      let entry = entries.get(el);
      if (!entry) {
        entry = tipEntry(el, argsOf(el), false);
        entries.set(el, entry);
      } else c.update(entry, argsOf(el));
      return entry;
    };
    const tipped = (target: EventTarget | null): HTMLElement | null => {
      const el = (target as Element | null)?.closest<HTMLElement>("[data-tip], [data-tip-more]");
      return el && zone.contains(el) ? el : null;
    };
    const leave = () => {
      if (current) c.pointerLeave(current);
      current = null;
    };
    const over = (e: PointerEvent) => {
      if (e.pointerType === "touch" || e.buttons !== 0) return;
      const el = tipped(e.target);
      if (!el) return leave();
      if (current?.el === el) return;
      leave();
      const entry = entryOf(el);
      current = entry;
      c.pointerEnter(entry, e.clientX);
    };
    const out = (e: PointerEvent) => {
      if (!current) return;
      const to = e.relatedTarget as Node | null;
      if (to && current.el.contains(to)) return;
      leave();
    };
    const down = (e: PointerEvent) => {
      if (e.pointerType !== "touch") {
        if (current) c.pointerDown(current, e.pointerType);
        return;
      }
      // A finger: a long press on a cell with a tooltip shows it.
      const el = tipped(e.target);
      if (!el) return;
      pressed = entryOf(el);
      c.pointerDown(pressed, "touch", e.clientX, e.clientY);
    };
    const move = (e: PointerEvent) => {
      if (pressed) c.pointerMove(pressed, e.pointerType, e.clientX, e.clientY);
    };
    const up = (e: PointerEvent) => {
      if (pressed) c.pointerUp(pressed, e.pointerType);
    };
    // The click some browsers send after a long press must not trigger the cell's control.
    const click = (e: MouseEvent) => {
      const el = tipped(e.target);
      const entry = el ? entries.get(el) : undefined;
      if (!entry || !c.swallowsClick(entry)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    const menu = (e: Event) => {
      const el = tipped(e.target);
      const entry = el ? entries.get(el) : undefined;
      if (entry && c.holdsContextMenu(entry)) e.preventDefault();
    };
    zone.addEventListener("pointerover", over);
    zone.addEventListener("pointerout", out);
    zone.addEventListener("pointerdown", down, true);
    zone.addEventListener("pointermove", move);
    zone.addEventListener("pointerup", up);
    zone.addEventListener("pointercancel", up);
    zone.addEventListener("click", click, true);
    zone.addEventListener("contextmenu", menu);
    return () => {
      zone.removeEventListener("pointerover", over);
      zone.removeEventListener("pointerout", out);
      zone.removeEventListener("pointerdown", down, true);
      zone.removeEventListener("pointermove", move);
      zone.removeEventListener("pointerup", up);
      zone.removeEventListener("pointercancel", up);
      zone.removeEventListener("click", click, true);
      zone.removeEventListener("contextmenu", menu);
      if (current) c.remove(current);
      if (pressed) c.remove(pressed);
      current = null;
      pressed = null;
    };
  }, []);
}

// ---- the one box --------------------------------------------------------------------------------

function inView(el: Element): boolean {
  const r = el.getBoundingClientRect();
  return r.bottom >= 0 && r.right >= 0 && r.top <= window.innerHeight && r.left <= window.innerWidth;
}

/** Where the name stood and where the box goes once stage 2 has unfolded. */
interface Placed {
  nameAt: number | null;
  unfoldAt: number | null;
}

/** Places the box for its own size, with the room stage 2 will need on the side it hangs. */
function placeBox(box: HTMLDivElement, v: TipView<HTMLElement>, sameOpening: boolean, placed: Placed) {
  const more = box.querySelector<HTMLElement>(".tip__more");
  // Measured settled: no ease may run while the box is measured.
  if (more) more.style.transition = "none";
  // Measured at the origin: a box far to the right would wrap narrower there.
  box.style.left = "0px";
  box.style.top = "0px";
  box.style.bottom = "auto";
  const unfolded = box.classList.contains("tip--stage2");
  box.classList.remove("tip--stage2");
  const small = box.getBoundingClientRect();
  let big = small;
  if (v.args.more) {
    box.classList.add("tip--measure");
    big = box.getBoundingClientRect();
    box.classList.remove("tip--measure");
  }
  if (unfolded) box.classList.add("tip--stage2");
  void box.offsetHeight;
  if (more) more.style.transition = "";
  const vp = { width: window.innerWidth, height: window.innerHeight };
  const p = placeTip(
    v.entry.el.getBoundingClientRect(),
    { width: unfolded && !sameOpening ? big.width : small.width, height: small.height },
    vp,
    v.entry.x,
    Math.max(0, big.height - small.height),
  );
  // An unfolded box whose words changed keeps the place of its name; the side is placed again.
  if (!sameOpening || placed.nameAt === null) placed.nameAt = p.left;
  const left = unfolded && sameOpening ? unfoldLeft(placed.nameAt, big.width, vp) : p.left;
  placed.unfoldAt = unfoldLeft(left, big.width, vp);
  box.style.left = `${left}px`;
  box.style.top = p.top === undefined ? "auto" : `${p.top}px`;
  box.style.bottom = p.bottom === undefined ? "auto" : `${p.bottom}px`;
}

const noView = () => null;

/** The one box of the document and the page's listeners; mounted once, in the providers. */
export function TipLayer() {
  const c = tips();
  const view = useSyncExternalStore(c.subscribe, c.view, noView);
  const boxRef = useRef<HTMLDivElement>(null);
  const placed = useRef<Placed>({ nameAt: null, unfoldAt: null });
  const placedFor = useRef<{ serial: number; revision: number; stage: number } | null>(null);
  // The opening that has been placed; the box fades in only then.
  const [openSerial, setOpenSerial] = useState<number | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (c.key(e.key)) tookEscape.add(e);
    };
    const onPress = (e: PointerEvent) => {
      c.pointerInput();
      if (!c.busy) return;
      const target = e.target as Node | null;
      const inBox = !!target && !!boxRef.current?.contains(target);
      const onElement = !!target && !!c.active?.el.contains(target);
      c.pressAnywhere(inBox, onElement);
    };
    const onScroll = (e: Event) => {
      if (!c.busy) return;
      const target = e.target;
      if (target instanceof Node && boxRef.current?.contains(target)) return;
      const el = c.active?.el;
      if (!el) return;
      const moves = !(target instanceof Node) || target === el || target.contains(el);
      c.scrolled(moves, inView(el));
    };
    const onChange = () => {
      if (c.busy) c.pageChanged();
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onPress, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onChange);
    window.addEventListener("blur", onChange);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onPress, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onChange);
      window.removeEventListener("blur", onChange);
    };
  }, [c]);

  // The element points at the box while it is up and has something to say beyond its own name.
  const el = view?.entry.el ?? null;
  const describes = !!view && (!!view.args.reason || !!view.args.more || (!!el && metaOf(el).nameSaid));
  useEffect(() => {
    if (!el || !describes) return;
    link(el);
    return () => unlink(el);
  }, [el, describes]);

  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!view || !box) {
      placed.current = { nameAt: null, unfoldAt: null };
      placedFor.current = null;
      return;
    }
    if (!view.entry.el.isConnected) {
      c.close(false);
      return;
    }
    const last = placedFor.current;
    placedFor.current = { serial: view.serial, revision: view.revision, stage: view.stage };
    if (last && last.serial === view.serial && last.revision === view.revision) {
      // Only the stage changed: the explanation unfolds where the name stands.
      const at = placed.current.unfoldAt;
      if (view.stage === 2 && last.stage === 1 && at !== null) box.style.left = `${at}px`;
      return;
    }
    placeBox(box, view, last?.serial === view.serial, placed.current);
    if (openSerial !== view.serial) setOpenSerial(view.serial);
  }, [view, openSerial, c]);

  if (!view || typeof document === "undefined") return null;
  const { args } = view;
  // The name is the element's own label most of the time; read from the box it would be said twice.
  const nameHidden = !!el && !metaOf(el).nameSaid && (!!args.reason || !!args.more);
  return createPortal(
    <div
      ref={boxRef}
      id={TIP_ID}
      role="tooltip"
      onPointerEnter={() => c.boxEnter()}
      onPointerLeave={() => c.boxLeave()}
      // A press in the box leaves the focus where it is.
      onMouseDown={(e) => e.preventDefault()}
      style={{ ["--tip-wait" as string]: `${view.waitMs ?? 0}ms` }}
      className={cn(
        "tip",
        openSerial === view.serial && "is-open",
        view.stage === 2 && "tip--stage2",
        view.waitMs !== null && "tip--waiting",
        view.enterable && "tip--enterable",
        !args.name && "tip--only-more",
      )}
    >
      {args.name && (
        <span className="tip__name">
          <span aria-hidden={nameHidden || undefined}>{args.name}</span>
          {args.keyCap && (
            <kbd className="tip__key" aria-hidden={nameHidden || undefined}>
              {args.keyCap}
            </kbd>
          )}
        </span>
      )}
      {args.reason && <span className="tip__reason">{args.reason}</span>}
      {args.more && (
        <span className="tip__more">
          <span>{args.more}</span>
        </span>
      )}
      {view.waitMs !== null && <span key={view.serial} className="tip__wait" aria-hidden />}
    </div>,
    document.body,
  );
}
