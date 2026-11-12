// The pieces of a card: a rounded surface with an optional header, content and footer.

import * as React from "react";
import { cn } from "@/lib/utils";

/** The surface of a card. */
export const Card = ({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("rounded-lg bg-surface", className)} {...p} />
);

/** The top of a card, set off by a line below it. */
export const CardHeader = ({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("px-4 sm:px-5 pt-5 pb-4 border-b border-border", className)} {...p} />
);

/** The heading of a card. */
export const CardTitle = ({ className, ...p }: React.HTMLAttributes<HTMLHeadingElement>) => (
  <h2 className={cn("text-base font-semibold tracking-tight", className)} {...p} />
);

/** The line under the title of a card. */
export const CardDescription = ({ className, ...p }: React.HTMLAttributes<HTMLParagraphElement>) => (
  <p className={cn("text-sm text-muted mt-0.5", className)} {...p} />
);

/** The body of a card. */
export const CardContent = ({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("px-4 sm:px-5 py-5", className)} {...p} />
);

/** The bottom of a card, set off by a line above it. */
export const CardFooter = ({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("px-4 sm:px-5 py-4 border-t border-border", className)} {...p} />
);
