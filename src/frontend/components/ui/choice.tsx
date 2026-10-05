import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The check mark of every selection in the app: a box for several choices, a circle for one.
 * Purely visual; the real <input> sits next to it with `sr-only`, so keyboard and screen
 * readers work as with a native control.
 */
export function ChoiceMark({
  checked,
  type = "checkbox",
  className,
}: {
  checked: boolean;
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
      {checked && <Check className="h-3 w-3" strokeWidth={3} />}
    </span>
  );
}

/** Background of a selectable tile: tinted when chosen, no border either way. */
export function choiceTile(checked: boolean) {
  return cn(
    "cursor-pointer transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent/60",
    checked ? "bg-accent/[0.12]" : "bg-tile hover:bg-accent/[0.06]",
  );
}
