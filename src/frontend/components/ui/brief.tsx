"use client";

// A hint shown as its first sentence, with the rest behind an (i).

import { splitSentence } from "@/lib/format";
import { cn } from "@/lib/utils";
import { InfoTip } from "./info-tip";

/**
 * A hint shown short (docs/UI.md): its first sentence, and the whole text behind an (i) when it says
 * more. `topic` names what the (i) explains, the title of its popover.
 */
export function Brief({
  text,
  topic,
  id,
  className,
}: {
  text: string;
  topic: string;
  id?: string;
  className?: string;
}) {
  const [first, rest] = splitSentence(text);
  return (
    <p id={id} className={cn("text-xs text-muted", className)}>
      {first}
      {/* Inline, so the (i) follows the last word wherever the line wraps. */}
      {rest && (
        <>
          {" "}
          <InfoTip size="xs" topic={topic} text={text} className="-mt-0.5" />
        </>
      )}
    </p>
  );
}
