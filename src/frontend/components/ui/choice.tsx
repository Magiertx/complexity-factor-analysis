import { Check, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The check mark of every selection in the app: a box for several choices, a circle for one, and
 * a box with a dash for a group of which only some are chosen. Purely visual; the real <input>
 * sits next to it with `sr-only`, so keyboard and screen readers work as with a native control.
 */
export function ChoiceMark({
  checked,
  type = "checkbox",
  className,
}: {
  checked: boolean | "mixed";
  type?: "checkbox" | "radio";
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid h-4 w-4 shrink-0 place-items-center transition",
        type === "radio" ? "rounded-full" : "rounded-[4px]",
        checked ? "bg-accent text-accent-fg" : "bg-bg/70 ring-1 ring-inset ring-strong",
        className,
      )}
    >
      {checked === "mixed" ? (
        <Minus className="h-3 w-3" strokeWidth={3} />
      ) : (
        checked && <Check className="h-3 w-3" strokeWidth={3} />
      )}
    </span>
  );
}

/**
 * A selectable tile: a neutral tile, and once chosen the surface with an accent border beside its
 * check mark, so the choice stands out without a block of colour. The focus ring stands apart
 * from the border, outside it.
 */
export function choiceTile(checked: boolean) {
  return cn(
    "relative cursor-pointer transition has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent",
    checked ? "bg-surface ring-[1.5px] ring-inset ring-accent" : "bg-tile hover:ring-1 hover:ring-inset hover:ring-strong",
  );
}
