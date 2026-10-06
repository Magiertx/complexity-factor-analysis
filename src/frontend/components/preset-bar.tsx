"use client";

import { useEffect, useRef, useState } from "react";
import { Bookmark, BookmarkPlus, Check, ChevronDown, RotateCcw, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Preset, deletePreset, listPresets, savePreset } from "@/lib/presets";
import { useT } from "@/lib/i18n";

type Props = {
  algorithmId: string;
  currentParams: Record<string, unknown>;
  onLoad: (params: Record<string, unknown>) => void;
  /** When provided, a "Reset to defaults" button is shown that fires this. */
  defaults?: Record<string, unknown>;
  disabled?: boolean;
};

export function PresetBar({ algorithmId, currentParams, onLoad, defaults, disabled }: Props) {
  const t = useT();
  const [presets, setPresets] = useState<Preset[]>([]);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newName, setNewName] = useState("");
  const [activeName, setActiveName] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    setPresets(listPresets(algorithmId));
    setActiveName(null);
  }, [algorithmId]);

  useEffect(() => {
    if (!open && !saving) return;
    const handle = (e: MouseEvent) => {
      const target = e.target as Node;
      if (wrapperRef.current?.contains(target)) return;
      if (formRef.current?.contains(target)) return;
      setOpen(false);
      setSaving(false);
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open, saving]);

  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 1600);
  };

  const handleLoad = (preset: Preset) => {
    onLoad(preset.params);
    setActiveName(preset.name);
    setOpen(false);
    showToast(t("preset_bar.toast_loaded", { name: preset.name }));
  };

  const handleDelete = (name: string) => {
    deletePreset(algorithmId, name);
    const next = listPresets(algorithmId);
    setPresets(next);
    if (activeName === name) setActiveName(null);
    if (next.length === 0) setOpen(false);
    showToast(t("preset_bar.toast_deleted", { name }));
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    try {
      savePreset(algorithmId, name, currentParams);
      setPresets(listPresets(algorithmId));
      setActiveName(name);
      setNewName("");
      setSaving(false);
      showToast(t("preset_bar.toast_saved", { name }));
    } catch (err) {
      showToast(err instanceof Error ? err.message : t("preset_bar.toast_save_failed"));
    }
  };

  const hasPresets = presets.length > 0;

  return (
    <div className="flex items-center justify-between gap-3 flex-wrap text-xs">
      <div className="flex items-center gap-2 min-w-0 flex-wrap">
        <div ref={wrapperRef} className="relative">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled || !hasPresets}
            onClick={() => setOpen((v) => !v)}
            className="gap-1.5 text-xs"
            title={hasPresets ? t("preset_bar.load_presets_title") : t("preset_bar.no_presets_title")}
            aria-haspopup="listbox"
            aria-expanded={open}
          >
            <Bookmark className="h-3.5 w-3.5 shrink-0" />
            <span className="font-medium">
              {activeName ? t("preset_bar.active_preset", { name: activeName }) : t("preset_bar.load_preset")}
            </span>
            <ChevronDown className={cn("h-3.5 w-3.5 transition", open ? "rotate-180" : "")} />
          </Button>
          {open && hasPresets && (
            <div
              role="listbox"
              className="absolute left-0 top-full mt-1 z-20 min-w-[240px] max-w-[320px] rounded-md bg-surface shadow-xl ring-1 ring-border/70 p-1"
            >
              {presets.map((p) => (
                <div key={p.name} className="flex items-stretch gap-1 group">
                  <button
                    type="button"
                    onClick={() => handleLoad(p)}
                    className={cn(
                      "flex-1 text-left px-2 py-1.5 rounded text-xs transition flex items-center gap-2",
                      activeName === p.name
                        ? "bg-accent/[0.32] text-fg"
                        : "hover:bg-tile text-fg",
                    )}
                    title={t("preset_bar.load_preset_item_title", { name: p.name })}
                  >
                    <Bookmark className="h-3 w-3 shrink-0 text-muted" />
                    <span className="truncate flex-1">{p.name}</span>
                    {activeName === p.name && <Check className="h-3 w-3 text-accent-ink shrink-0" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(p.name)}
                    aria-label={t("preset_bar.delete_preset_aria", { name: p.name })}
                    className="h-auto px-2 rounded text-muted hover:text-danger-ink hover:bg-tile transition opacity-0 group-hover:opacity-100"
                    title={t("preset_bar.delete_preset_title")}
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {saving ? (
          <form
            ref={formRef}
            onSubmit={handleSave}
            className="flex items-center gap-1.5"
          >
            <Input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={t("preset_bar.preset_name_placeholder")}
              className="h-8 w-[160px] text-xs"
              maxLength={64}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setSaving(false);
                  setNewName("");
                }
              }}
            />
            <Button type="submit" size="sm" variant="primary" disabled={!newName.trim()}>
              {t("common.save")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                setSaving(false);
                setNewName("");
              }}
            >
              {t("common.cancel")}
            </Button>
          </form>
        ) : (
          <>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                setSaving(true);
                setOpen(false);
              }}
              disabled={disabled}
              title={t("preset_bar.save_preset_title")}
            >
              <BookmarkPlus className="h-3.5 w-3.5" />
              {t("preset_bar.save_preset")}
            </Button>
            {defaults && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={disabled}
                onClick={() => {
                  onLoad({ ...defaults });
                  setActiveName(null);
                  showToast(t("preset_bar.toast_reset"));
                }}
                title={t("preset_bar.reset_title")}
              >
                <RotateCcw className="h-3.5 w-3.5" />
                {t("preset_bar.reset")}
              </Button>
            )}
          </>
        )}
      </div>

      {toast && (
        <span className="flex items-center gap-1 text-[11px] text-muted">
          <Check className="h-3 w-3 text-accent-ink" />
          {toast}
        </span>
      )}
    </div>
  );
}
