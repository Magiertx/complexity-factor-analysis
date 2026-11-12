"use client";

// Free-text note on a job: a compact inline editor for the run-history rows and a card for the single-run page.

import { useEffect, useRef, useState } from "react";
import { AlertCircle, StickyNote, Edit2, Check, X } from "lucide-react";
import { updateJobNotes } from "@/lib/api";
import { Button } from "./ui/button";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";

type Props = {
  jobId: string;
  /** The saved note; empty when there is none. A new value replaces the text and closes the editor. */
  initialNotes: string | null | undefined;
  /** Compact display variant for tight spaces (Run history rows). */
  variant?: "panel" | "inline";
  /** Notified after a successful save with the new value. */
  onSaved?: (notes: string | null) => void;
};

/** Longest note the field accepts; typing stops there. */
const MAX_NOTES = 2000;

/** Shows and edits the note of one job and saves it with `updateJobNotes`; an empty text is saved as no note. */
export function JobNotesField({ jobId, initialNotes, variant = "panel", onSaved }: Props) {
  const t = useT();
  // `notes` is the text being edited, `savedNotes` what the server has; Cancel goes back to the latter.
  const [notes, setNotes] = useState<string>(initialNotes ?? "");
  const [savedNotes, setSavedNotes] = useState<string>(initialNotes ?? "");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Takes over the saved note again whenever another job or a new value arrives.
  useEffect(() => {
    setNotes(initialNotes ?? "");
    setSavedNotes(initialNotes ?? "");
    setEditing(false);
  }, [jobId, initialNotes]);

  // Puts the cursor into the field when editing starts.
  useEffect(() => {
    if (editing) {
      textareaRef.current?.focus();
    }
  }, [editing]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const value = notes.trim() ? notes.trim() : null;
      await updateJobNotes(jobId, value);
      setSavedNotes(value ?? "");
      setEditing(false);
      onSaved?.(value);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("job_notes.save_failed"));
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setNotes(savedNotes);
    setEditing(false);
    setError(null);
  };

  const isEmpty = !savedNotes.trim();

  // Compact "inline" variant: just shows the note text (or a placeholder) with
  // an edit pencil. Used in Run history rows where space is tight.
  if (variant === "inline") {
    return (
      <div className="flex items-start gap-1.5 text-xs">
        {!editing ? (
          <>
            <StickyNote className="h-3 w-3 text-muted/60 mt-0.5 shrink-0" />
            <span
              className={cn(
                "flex-1 line-clamp-2 break-words",
                isEmpty ? "text-muted italic" : "text-muted",
              )}
              title={savedNotes || undefined}
            >
              {savedNotes || t("job_notes.no_notes_inline")}
            </span>
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="h-5 w-5 grid place-items-center rounded text-muted/60 hover:text-fg hover:bg-tile transition shrink-0"
              aria-label={t("job_notes.edit_aria")}
              title={t("job_notes.edit_title")}
            >
              <Edit2 className="h-3 w-3" />
            </button>
          </>
        ) : (
          <div className="flex-1 space-y-1.5">
            <textarea
              ref={textareaRef}
              value={notes}
              onChange={(e) => setNotes(e.target.value.slice(0, MAX_NOTES))}
              placeholder={t("job_notes.inline_placeholder")}
              rows={2}
              className="w-full text-xs px-2 py-1.5 rounded-md bg-tile focus:outline-none focus:ring-2 focus:ring-accent/50 transition resize-y"
            />
            <div className="flex items-center justify-end gap-1.5">
              <Button size="sm" variant="ghost" onClick={handleCancel} disabled={saving}>
                <X className="h-3 w-3" /> {t("common.cancel")}
              </Button>
              <Button size="sm" variant="outline" onClick={handleSave} disabled={saving}>
                <Check className="h-3 w-3" /> {t("common.save")}
              </Button>
            </div>
            {error && (
              <div className="flex items-center gap-1 text-xs text-danger-ink">
                <AlertCircle className="h-3 w-3 shrink-0" aria-hidden />
                {error}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // Default "panel" variant: full card-style block, used in the past-job view.
  return (
    <div className="rounded-lg bg-surface p-4 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-muted">
          <StickyNote className="h-3.5 w-3.5 text-muted/70" />
          <span>{t("job_notes.section_title")}</span>
        </div>
        {!editing && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="h-7 px-2.5 inline-flex items-center gap-1 rounded-md hover:bg-tile text-xs text-muted hover:text-fg transition"
          >
            <Edit2 className="h-3 w-3" />
            {isEmpty ? t("job_notes.add_note_button") : t("job_notes.edit_button")}
          </button>
        )}
      </div>

      {!editing ? (
        <div
          className={cn(
            "text-sm leading-relaxed whitespace-pre-wrap break-words",
            isEmpty ? "text-muted italic" : "text-fg",
          )}
        >
          {savedNotes || t("job_notes.panel_empty_text")}
        </div>
      ) : (
        <div className="space-y-2">
          <textarea
            ref={textareaRef}
            value={notes}
            onChange={(e) => setNotes(e.target.value.slice(0, MAX_NOTES))}
            placeholder={t("job_notes.panel_placeholder")}
            rows={4}
            className="w-full text-sm px-3 py-2 rounded-md bg-tile focus:outline-none focus:ring-2 focus:ring-accent/50 transition resize-y"
          />
          <div className="flex items-center justify-between gap-2 text-xs text-muted">
            <span>{t("job_notes.char_count", { n: notes.length, max: MAX_NOTES })}</span>
            <div className="flex items-center gap-1.5">
              <Button size="sm" variant="ghost" onClick={handleCancel} disabled={saving}>
                {t("common.cancel")}
              </Button>
              <Button size="sm" variant="outline" onClick={handleSave} disabled={saving}>
                <Check className="h-3.5 w-3.5" />
                {saving ? t("job_notes.saving") : t("common.save")}
              </Button>
            </div>
          </div>
          {error && (
            <div className="flex items-center gap-1 text-xs text-danger-ink">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden />
              {error}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
