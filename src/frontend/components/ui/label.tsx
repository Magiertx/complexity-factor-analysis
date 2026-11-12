// The small label of a form field.

import * as React from "react";
import { cn } from "@/lib/utils";

/** A form label. */
export const Label = ({ className, ...p }: React.LabelHTMLAttributes<HTMLLabelElement>) => (
  <label className={cn("text-xs font-medium text-muted", className)} {...p} />
);
