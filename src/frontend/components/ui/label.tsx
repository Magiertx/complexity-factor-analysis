import * as React from "react";
import { cn } from "@/lib/utils";

export const Label = ({ className, ...p }: React.LabelHTMLAttributes<HTMLLabelElement>) => (
  <label className={cn("text-xs font-medium text-muted uppercase tracking-wide", className)} {...p} />
);
