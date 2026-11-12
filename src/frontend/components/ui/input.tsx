// The text input of the app.

import * as React from "react";
import { cn } from "@/lib/utils";

/** A text input. */
export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "h-9 w-full rounded-md bg-tile px-3 text-sm placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent/50 transition",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";
