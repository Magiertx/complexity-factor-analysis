// The button of the app: four looks in three sizes, and `buttonClass` for a link that looks like one.

import * as React from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "outline" | "ghost";
type Size = "sm" | "md" | "lg";

const variants: Record<Variant, string> = {
  primary: "bg-accent text-accent-fg hover:opacity-90",
  // No borders: secondary actions sit on a tile, like every other control.
  secondary: "bg-tile hover:bg-accent/[0.08] text-fg",
  outline: "bg-tile hover:bg-accent/[0.08] text-fg",
  ghost: "hover:bg-surface text-fg",
};
const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-sm",
  md: "h-10 px-4 text-sm",
  lg: "h-11 px-6 text-base",
};

/** The props of a native button, with a look and a size. */
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

/** The look of a button, for a link that is one. */
export const buttonClass = (variant: Variant = "primary", size: Size = "md", className?: string) =>
  cn(
    "inline-flex items-center justify-center gap-2 rounded-md font-medium transition disabled:bg-tile disabled:text-muted disabled:opacity-100 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
    variants[variant],
    sizes[size],
    className,
  );

/** The button of the app. */
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", ...props }, ref) => (
    <button ref={ref} className={buttonClass(variant, size, className)} {...props} />
  ),
);
Button.displayName = "Button";
