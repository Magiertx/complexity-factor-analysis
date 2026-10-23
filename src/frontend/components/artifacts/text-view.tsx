"use client";

import { useState } from "react";
import type { Artifact } from "@/lib/api";
import { useT } from "@/lib/i18n";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";

type T = Extract<Artifact, { kind: "text" }>;

/** Paragraphs a long list of notes shows before it folds the rest. */
const SHOWN_PARAGRAPHS = 3;

export function TextView({ artifact }: { artifact: T }) {
  const t = useT();
  const [all, setAll] = useState(false);
  // A list of notes, such as one per failed measure, shows its first few and folds the rest, so the
  // end of the page is not a column of errors; text with headings, tables or code stays whole.
  const parts = artifact.markdown.split(/\n{2,}/);
  const folds = parts.length > SHOWN_PARAGRAPHS + 1 && parts.every((p) => !/^\s*(#|\||```)/.test(p));
  const markdown = folds && !all ? parts.slice(0, SHOWN_PARAGRAPHS).join("\n\n") : artifact.markdown;
  return (
    <div className="text-sm leading-relaxed space-y-3 text-fg">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        components={{
          table: ({ ...props }) => (
            <div className="overflow-x-auto my-4 rounded-lg bg-tile/40">
              <table className="w-full text-left border-collapse text-xs" {...props} />
            </div>
          ),
          thead: ({ ...props }) => (
            <thead className="bg-tile text-muted border-b border-border font-medium" {...props} />
          ),
          th: ({ ...props }) => (
            <th className="px-4 py-2 border-r border-border last:border-r-0 font-semibold" {...props} />
          ),
          td: ({ ...props }) => (
            <td className="px-4 py-2 border-r border-border last:border-r-0 border-b border-border last-row:border-b-0" {...props} />
          ),
          p: ({ ...props }) => (
            <p className="mb-2 last:mb-0" {...props} />
          ),
          code: ({ ...props }) => (
            <code className="font-mono text-xs px-1 py-0.5 rounded bg-tile" {...props} />
          ),
          pre: ({ ...props }) => (
            <pre className="p-3 my-2 overflow-x-auto rounded-md bg-tile text-xs" {...props} />
          ),
          h1: ({ ...props }) => (
            <h1 className="text-lg font-bold mt-4 mb-2 first:mt-0 text-fg" {...props} />
          ),
          h2: ({ ...props }) => (
            <h2 className="text-base font-bold mt-3 mb-1.5 text-fg" {...props} />
          ),
          h3: ({ ...props }) => (
            <h3 className="text-sm font-bold mt-2 mb-1 text-fg" {...props} />
          ),
        }}
      >
        {markdown}
      </ReactMarkdown>
      {folds && (
        <button
          type="button"
          onClick={() => setAll(!all)}
          aria-expanded={all}
          className="text-xs font-medium text-accent-ink hover:underline rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {all ? t("result_panel.notes_fewer") : t("result_panel.notes_more", { n: parts.length - SHOWN_PARAGRAPHS })}
        </button>
      )}
    </div>
  );
}
