"use client";

// The (i) that explains something: a tooltip on hover or focus, a popover on click.

import { useId, useMemo, useRef, useState } from "react";
import { Info } from "lucide-react";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Popover } from "./popover";
import { mergeRefs, useTip } from "./tip";

/**
 * The one way to explain something (docs/UI.md): a small (i) beside a title or a label. Resting the
 * pointer on it or focusing it shows the explanation in the tooltip; a click or a tap opens it in a
 * small popover, which works on touch as well and closes with Escape. A section shows a title and
 * at most one short line; whatever is longer goes here.
 */
export function InfoTip({
  topic,
  text,
  children,
  className,
  width = 320,
  align = "start",
  size = "sm",
}: {
  /** What is explained, e.g. the label beside it: the popover's title and part of the button's name. */
  topic: string;
  /** The explanation, as the tooltip shows it and as the popover shows it unless `children` say more. */
  text: string;
  /** Richer content for the popover, e.g. a list or a link; the tooltip still shows `text`. */
  children?: React.ReactNode;
  className?: string;
  width?: number;
  align?: "start" | "end";
  /** "xs" beside the small labels of tiles and table headers. */
  size?: "sm" | "xs";
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const tip = useTip<HTMLButtonElement>({ more: text }, { explains: true });
  const ref = useMemo(() => mergeRefs(button, tip), [tip]);
  const id = useId();
  return (
    <>
      <button
        ref={ref}
        type="button"
        aria-label={t("common.info_aria", { topic })}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={(e) => {
          // Inside a label or a summary the press would also toggle what they belong to.
          e.preventDefault();
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className={cn(
          "inline-grid shrink-0 place-items-center rounded-full align-middle text-muted transition",
          // A hit area of 24 px around the small glyph; the negative margin keeps the line as high as before.
          size === "xs" ? "h-6 w-6 -m-1" : "h-6 w-6 -m-0.5",
          "hover:bg-tile hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
          "aria-expanded:bg-tile aria-expanded:text-accent-ink",
          className,
        )}
      >
        <Info className={size === "xs" ? "h-3 w-3" : "h-3.5 w-3.5"} aria-hidden />
      </button>
      <Popover
        open={open}
        onClose={(refocus) => {
          setOpen(false);
          if (refocus) button.current?.focus();
        }}
        anchor={button}
        title={topic}
        titleId={`${id}-title`}
        id={id}
        width={width}
        align={align}
      >
        <div className="space-y-2 text-xs leading-relaxed text-fg/85">{children ?? <p>{text}</p>}</div>
      </Popover>
    </>
  );
}

/**
 * A title or label with its (i), the same in every section: the text, then the (i) beside it. With
 * `htmlFor` the text is the <label> of that control.
 */
export function InfoLabel({
  label,
  help,
  as = "h3",
  htmlFor,
  id,
  className,
  extra,
  children,
}: {
  label: string;
  /** The explanation behind the (i); none, and the label stands alone. */
  help?: string | null;
  as?: "h2" | "h3" | "span";
  htmlFor?: string;
  id?: string;
  className?: string;
  /** Beside the (i), e.g. a count or a badge. */
  extra?: React.ReactNode;
  /** Richer content for the popover. */
  children?: React.ReactNode;
}) {
  const text = "text-sm font-semibold";
  const Heading = as;
  return (
    <div className={cn("flex min-h-6 items-center gap-1 flex-wrap", className)}>
      {htmlFor ? (
        <label id={id} htmlFor={htmlFor} className={text}>
          {label}
        </label>
      ) : (
        <Heading id={id} className={text}>
          {label}
        </Heading>
      )}
      {help && (
        <InfoTip topic={label} text={help}>
          {children}
        </InfoTip>
      )}
      {extra}
    </div>
  );
}
