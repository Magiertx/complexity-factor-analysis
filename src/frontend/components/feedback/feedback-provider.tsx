"use client";

// The context that opens the one feedback dialog from anywhere in the app.

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { FeedbackKind } from "@/lib/api";
import { FeedbackDialog, type Draft } from "./feedback-dialog";

/** The options of `open`. */
export interface OpenFeedback {
  /** The kind to start with; the one chosen last otherwise. */
  kind?: FeedbackKind;
  /** The error the report is about; the last error since the page was opened otherwise. */
  errorCode?: string | null;
}

/** An open dialog. */
interface Request {
  errorCode: string | null;
  /** The element the dialog was opened from, to give the focus back to. */
  from: HTMLElement | null;
}

/** The `open` function of the dialog. */
const FeedbackContext = createContext<{ open: (options?: OpenFeedback) => void } | null>(null);

/** `open` for the feedback dialog; inside `FeedbackProvider` only. */
export function useFeedback() {
  const ctx = useContext(FeedbackContext);
  if (!ctx) throw new Error("useFeedback must be used inside <FeedbackProvider>");
  return ctx;
}

/** A fresh draft. */
const EMPTY: Draft = { kind: "bug", title: "", message: "", contact: "", technical: true };

/**
 * The one feedback dialog of the app, opened from the header and from the error notices. What was
 * typed stays while the dialog is closed (a click beside it must not cost a message) and goes
 * once it is sent.
 */
export function FeedbackProvider({ children }: { children: React.ReactNode }) {
  const [request, setRequest] = useState<Request | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);

  const open = useCallback((options: OpenFeedback = {}) => {
    const kind = options.kind;
    if (kind) setDraft((d) => ({ ...d, kind }));
    setRequest({
      errorCode: options.errorCode ?? null,
      from: document.activeElement instanceof HTMLElement ? document.activeElement : null,
    });
  }, []);
  const value = useMemo(() => ({ open }), [open]);

  return (
    <FeedbackContext.Provider value={value}>
      {children}
      <FeedbackDialog
        request={request}
        draft={draft}
        onDraft={setDraft}
        onSent={() => setDraft((d) => ({ ...EMPTY, kind: d.kind, technical: d.technical }))}
        onClose={() => setRequest(null)}
      />
    </FeedbackContext.Provider>
  );
}
