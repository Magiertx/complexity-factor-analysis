/*
 * Where the one tooltip stands (components/ui/tip.tsx). Hung on the element, not on the wandering
 * pointer: under it (over it where the window has no room), never over the element itself, and
 * inside the window. A tooltip that follows the pointer shakes and covers the neighbour; one that
 * stands still can be read.
 *
 * Across: a box wider than its element (an icon, a short word) stands centred under it. Under a
 * wider element (a long button, a row) its left edge is where the pointer came in, and the whole
 * box is held inside the element. Without a pointer (keyboard, touch) it is centred. Stage 1 is
 * placed for its own size; stage 2 grows out of it (`unfoldLeft`), so the name does not move unless
 * the wider box would leave the window.
 *
 * Pure arithmetic, so it is tested without a browser.
 */

/** Space between the element and the box. */
export const TIP_GAP = 8;
/** The nearest the box comes to the window's edge. */
export const TIP_EDGE = 8;

export interface TipRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface TipPlace {
  left: number;
  /** Set for exactly one of the two: under the element (`top`) or over it (`bottom`, from the window's bottom edge). */
  top?: number;
  bottom?: number;
}

/**
 * @param anchor   the element's rectangle in window pixels
 * @param box      the box's size as it is shown now (stage 1, or unfolded for a box that opens unfolded)
 * @param view     the window
 * @param x        the pointer's x where it came in; absent for keyboard and touch
 * @param reserve  how much taller stage 2 will make the box: it grows away from the element, so the
 *                 room for it has to be there before it is needed (the side never changes when it unfolds)
 */
export function placeTip(
  anchor: TipRect,
  box: { width: number; height: number },
  view: { width: number; height: number },
  x?: number,
  reserve = 0,
): TipPlace {
  const centred = (anchor.left + anchor.right) / 2 - box.width / 2;
  const wanted =
    box.width >= anchor.right - anchor.left
      ? centred
      : Math.max(anchor.left, Math.min(x ?? centred, anchor.right - box.width));
  // The left edge wins when the box is wider than the window: the start of the name has to be visible.
  const left = Math.max(TIP_EDGE, Math.min(wanted, view.width - box.width - TIP_EDGE));

  const below = anchor.bottom + TIP_GAP;
  const need = box.height + reserve;
  const roomBelow = view.height - TIP_EDGE - below;
  const roomAbove = anchor.top - TIP_GAP - TIP_EDGE;
  if (need <= roomBelow) return { left, top: below };
  if (need <= roomAbove || roomAbove > roomBelow) return { left, bottom: view.height - anchor.top + TIP_GAP };
  return { left, top: below };
}

/**
 * Where a box that unfolds to stage 2 stands: its left edge stays where the name stood, unless the
 * wider box would leave the window; then it gives way to the left, only as far as it must.
 */
export function unfoldLeft(left: number, width: number, view: { width: number }): number {
  return Math.max(TIP_EDGE, Math.min(left, view.width - width - TIP_EDGE));
}
