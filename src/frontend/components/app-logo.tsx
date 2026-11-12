// The XCom logo: a 5 x 5 heat map like the loading matrix, whose strong cells form the X.
// The same picture as app/icon.svg (the favicon; the desktop icons are rendered from that file),
// drawn inline here so the header needs no extra request and prints with the page.

/** Left/top edge of the five columns and rows in the 64 x 64 drawing. */
const EDGES = [8, 18, 28, 38, 48];

/** Opacity of each cell off the X, row by row, as in app/icon.svg (cells on the X are opaque). */
const SHADE = [
  [0, 0.1, 0.08, 0.08, 0],
  [0.07, 0, 0.07, 0, 0.14],
  [0.08, 0.11, 0, 0.1, 0.17],
  [0.15, 0, 0.08, 0, 0.07],
  [0, 0.08, 0.13, 0.1, 0],
];

/** The logo as inline SVG, sized by `className` (e.g. `h-7 w-7`). Decorative: the name stands next to it. */
export function AppLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true" focusable="false">
      <rect width="64" height="64" rx="14" fill="#111827" />
      {SHADE.map((row, r) =>
        row.map((shade, c) => {
          const onX = r === c || r + c === 4;
          return (
            <rect
              key={`${r}-${c}`}
              x={EDGES[c]}
              y={EDGES[r]}
              width="8"
              height="8"
              rx="1.6"
              fill={onX ? "#e11d48" : "#60a5fa"}
              opacity={onX ? 1 : shade}
            />
          );
        }),
      )}
    </svg>
  );
}
