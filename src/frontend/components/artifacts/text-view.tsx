"use client";

import type { Artifact } from "@/lib/api";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";

type T = Extract<Artifact, { kind: "text" }>;

export function TextView({ artifact }: { artifact: T }) {
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
        {artifact.markdown}
      </ReactMarkdown>
    </div>
  );
}
