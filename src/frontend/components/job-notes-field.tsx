"use client";

import { useEffect, useRef, useState } from "react";
import { StickyNote, Edit2, Check, X } from "lucide-react";
import { updateJobNotes } from "@/lib/api";
import { Button } from "./ui/button";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";

type Props = {
  jobId: string;
  initialNotes: string | null | undefined;
  /** Compact display variant for tight spaces (Run history rows). */
  variant?: "panel" | "inline";
  /** Notified after a successful save with the new value. */
  onSaved?: (notes: string | null) => void;
};

const MAX_NOTES = 2000;

export function JobNotesField({ jobId, initialNotes, variant = "panel", onSaved }: Props) {
  const t = useT();
  const [notes, setNotes] = useState<string>(initialNotes ?? "");
  const [savedNotes, setSavedNotes] = useState<string>(initialNotes ?? "");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setNotes(initialNotes ?? "");
    setSavedNotes(initialNotes ?? "");
    setEditing(false);
  }, [jobId, initialNotes]);

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
                isEmpty ? "text-muted/50 italic" : "text-muted",
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
            {error && <div className="text-[10px] text-danger-ink">{error}</div>}
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
            isEmpty ? "text-muted/60 italic" : "text-fg",
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
          <div className="flex items-center justify-between gap-2 text-[10px] text-muted/60">
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
          {error && <div className="text-xs text-danger-ink">{error}</div>}
        </div>
      )}
    </div>
  );
}
