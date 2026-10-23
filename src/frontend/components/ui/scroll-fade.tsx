"use client";

import { useRef } from "react";
import { cn } from "@/lib/utils";
import { useScrollFade } from "@/lib/use-scroll-fade";

/** A strip that scrolls sideways without a scrollbar and fades the edge where more lies beyond it. */
export function ScrollFade({ className, children }: { className?: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useScrollFade(ref);
  return (
    <div ref={ref} className={cn("scroll-fade overflow-x-auto no-scrollbar", className)}>
      {children}
    </div>
  );
}
