"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useTheme } from "next-themes";
import {
  Monitor,
  Moon,
  Sun,
  Trash2,
  ExternalLink,
  AlertCircle,
  Check,
  Github,
  ArrowLeft,
  PlayCircle,
  Bookmark,
  Download,
  Upload,
} from "lucide-react";
import {
  AlgorithmManifest,
  fetchAlgorithms,
  deleteAllJobs,
  TOOL_TYPE_LABEL,
} from "@/lib/api";
import { APP_NAME, REPO_URL } from "@/lib/app-config";
import { Button } from "./ui/button";
import { Select } from "./ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Segmented } from "./ui/segmented";
import {
  Preset,
  buildExportPayload,
  clearAllPresets,
  deletePreset,
  importPresets,
  listAllPresets,
} from "@/lib/presets";
import { useT } from "@/lib/i18n";
import { LocaleSegmented } from "./locale-toggle";

export const DEFAULT_ALGORITHM_KEY = "app.default-algorithm";
const ALGO_PARAMS_PREFIX = "algo-params-";

type ThemeChoice = "system" | "light" | "dark";

export function SettingsView() {
  const { theme, setTheme } = useTheme();
  const t = useT();
  const [mounted, setMounted] = useState(false);
  const [algorithms, setAlgorithms] = useState<AlgorithmManifest[]>([]);
  const [categories, setCategories] = useState<{ id: string; label: string }[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [defaultAlgo, setDefaultAlgo] = useState<string>("");
  const [cachedParamCount, setCachedParamCount] = useState(0);
  const [confirmClearJobs, setConfirmClearJobs] = useState(false);
  const [confirmClearParams, setConfirmClearParams] = useState(false);
  const [confirmClearPresets, setConfirmClearPresets] = useState(false);
  const [presetGroups, setPresetGroups] = useState<{ algorithmId: string; presets: Preset[] }[]>([]);
  const [savedToast, setSavedToast] = useState<string | null>(null);
  const [presetImportError, setPresetImportError] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    fetchAlgorithms()
      .then((res) => {
        setAlgorithms(res.algorithms);
        setCategories(res.categories);
      })
      .catch((e: Error) => setLoadError(e.message));
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setDefaultAlgo(localStorage.getItem(DEFAULT_ALGORITHM_KEY) || "");
    refreshCachedParamCount();
    setPresetGroups(listAllPresets());
  }, []);

  const refreshCachedParamCount = () => {
    if (typeof window === "undefined") return;
    let n = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(ALGO_PARAMS_PREFIX)) n++;
    }
    setCachedParamCount(n);
  };

  const showToast = (msg: string) => {
    setSavedToast(msg);
    window.setTimeout(() => setSavedToast(null), 1800);
  };

  const handleThemeChange = (value: ThemeChoice) => {
    setTheme(value);
    showToast(t("settings.toast_theme_updated"));
  };

  const handleDefaultAlgoChange = (value: string) => {
    setDefaultAlgo(value);
    if (value) {
      localStorage.setItem(DEFAULT_ALGORITHM_KEY, value);
    } else {
      localStorage.removeItem(DEFAULT_ALGORITHM_KEY);
    }
    showToast(t("settings.toast_default_algo_saved"));
  };

  const handleClearParamCache = () => {
    if (typeof window === "undefined") return;
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(ALGO_PARAMS_PREFIX)) keys.push(k);
    }
    for (const k of keys) localStorage.removeItem(k);
    refreshCachedParamCount();
    setConfirmClearParams(false);
    showToast(keys.length === 1
      ? t("settings.toast_cleared_caches", { n: keys.length })
      : t("settings.toast_cleared_caches_plural", { n: keys.length }));
  };

  const handleDeletePreset = (algorithmId: string, name: string) => {
    deletePreset(algorithmId, name);
    setPresetGroups(listAllPresets());
    showToast(t("settings.toast_deleted_preset", { name }));
  };

  const handleClearAllPresets = () => {
    const count = clearAllPresets();
    setPresetGroups([]);
    setConfirmClearPresets(false);
    showToast(count === 1
      ? t("settings.toast_cleared_presets", { n: count })
      : t("settings.toast_cleared_presets_plural", { n: count }));
  };

  const handleExportPresets = () => {
    if (typeof window === "undefined") return;
    const payload = buildExportPayload();
    const json = JSON.stringify(payload, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    a.href = url;
    a.download = `presets-${yyyy}-${mm}-${dd}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast(t("settings.presets.toast_exported", { n: totalPresets }));
  };

  const handleImportClick = () => {
    setPresetImportError(null);
    importInputRef.current?.click();
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset the input so picking the same file again still triggers change.
    e.target.value = "";
    if (!file) return;
    setPresetImportError(null);
    try {
      const text = await file.text();
      let payload: unknown;
      try {
        payload = JSON.parse(text);
      } catch {
        throw new Error(t("settings.presets.import_error_invalid_json"));
      }
      const result = importPresets(payload);
      setPresetGroups(listAllPresets());
      const msg = result.renamed > 0
        ? t("settings.presets.toast_imported_renamed", { n: result.added, renamed: result.renamed })
        : t("settings.presets.toast_imported", { n: result.added });
      showToast(msg);
    } catch (err) {
      const msg = err instanceof Error && err.message
        ? err.message
        : t("settings.presets.import_error_generic");
      setPresetImportError(msg);
    }
  };

  const totalPresets = presetGroups.reduce((acc, g) => acc + g.presets.length, 0);

  const handleClearJobs = async () => {
    try {
      await deleteAllJobs();
      setConfirmClearJobs(false);
      showToast(t("settings.toast_job_history_cleared"));
    } catch (e) {
      showToast(t("settings.toast_job_history_failed"));
    }
  };

  const grouped = useMemo(() => {
    const buckets: Record<string, AlgorithmManifest[]> = {};
    for (const a of algorithms) {
      const key = a.tool_type;
      if (!buckets[key]) buckets[key] = [];
      buckets[key].push(a);
    }
    return buckets;
  }, [algorithms]);

  const currentTheme: ThemeChoice = mounted
    ? (theme === "system" ? "system" : ((theme as ThemeChoice) || "system"))
    : "system";

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="h-9 w-9 grid place-items-center rounded-md border border-border hover:bg-surface transition text-muted hover:text-fg"
            aria-label={t("settings.back_aria")}
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">{t("settings.page_title")}</h1>
            <p className="text-xs text-muted mt-0.5">
              {t("settings.page_subtitle")}
            </p>
          </div>
        </div>
        {savedToast && (
          <div className="flex items-center gap-2 text-xs text-muted bg-tile rounded-md px-3 py-2 border border-border">
            <Check className="h-3.5 w-3.5 text-accent" />
            {savedToast}
          </div>
        )}
      </header>

      {loadError && (
        <Card className="border-danger/40">
          <CardContent className="flex items-start gap-2 text-sm text-danger">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{t("settings.load_error", { error: loadError })}</span>
          </CardContent>
        </Card>
      )}

      {/* Appearance */}
      <Card>
        <CardHeader>
          <CardTitle>{t("settings.appearance.title")}</CardTitle>
          <CardDescription>{t("settings.appearance.description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <SettingRow label={t("settings.appearance.theme_label")} hint={t("settings.appearance.theme_hint")}>
            <Segmented<ThemeChoice>
              value={currentTheme}
              onChange={handleThemeChange}
              className="w-[280px]"
              options={[
                { value: "system", label: <span className="flex items-center gap-1.5"><Monitor className="h-3 w-3" />{t("settings.appearance.theme_system")}</span> },
                { value: "light", label: <span className="flex items-center gap-1.5"><Sun className="h-3 w-3" />{t("settings.appearance.theme_light")}</span> },
                { value: "dark", label: <span className="flex items-center gap-1.5"><Moon className="h-3 w-3" />{t("settings.appearance.theme_dark")}</span> },
              ]}
            />
          </SettingRow>
          <SettingRow label={t("settings.appearance.language_label")} hint={t("settings.appearance.language_hint")}>
            <LocaleSegmented />
          </SettingRow>
        </CardContent>
      </Card>

      {/* Defaults */}
      <Card>
        <CardHeader>
          <CardTitle>{t("settings.defaults.title")}</CardTitle>
          <CardDescription>{t("settings.defaults.description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <SettingRow
            label={t("settings.defaults.default_algo_label")}
            hint={t("settings.defaults.default_algo_hint")}
          >
            <div className="flex items-center gap-3">
              <Select
                value={defaultAlgo}
                onChange={(e) => handleDefaultAlgoChange(e.target.value)}
                className="min-w-[280px] w-auto"
              >
                <option value="">{t("settings.defaults.none_option")}</option>
                {categories.map((cat) => {
                  const items = grouped[cat.id] || [];
                  if (items.length === 0) return null;
                  return (
                    <optgroup key={cat.id} label={cat.label}>
                      {items.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </optgroup>
                  );
                })}
                {/* Algorithms without a known category (defensive). */}
                {algorithms
                  .filter((a) => !categories.some((c) => c.id === a.tool_type))
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({TOOL_TYPE_LABEL[a.tool_type] || a.tool_type})
                    </option>
                  ))}
              </Select>
              {defaultAlgo && (
                <button
                  type="button"
                  onClick={() => handleDefaultAlgoChange("")}
                  className="text-[11px] text-muted hover:text-fg underline-offset-2 hover:underline"
                >
                  {t("settings.defaults.clear_button")}
                </button>
              )}
            </div>
          </SettingRow>
        </CardContent>
      </Card>

      {/* Parameter presets */}
      <Card>
        <CardHeader>
          <CardTitle>{t("settings.presets.title")}</CardTitle>
          <CardDescription>
            {t("settings.presets.description")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <SettingRow
            label={t("settings.presets.transfer_label")}
            hint={t("settings.presets.transfer_hint")}
          >
            <div className="flex items-center gap-2 flex-wrap justify-end">
              <Button
                size="sm"
                variant="outline"
                onClick={handleExportPresets}
                disabled={totalPresets === 0}
                title={t("settings.presets.export_title")}
              >
                <Download className="h-3.5 w-3.5" />
                {t("settings.presets.export_button")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={handleImportClick}
                title={t("settings.presets.import_title")}
              >
                <Upload className="h-3.5 w-3.5" />
                {t("settings.presets.import_button")}
              </Button>
              <input
                ref={importInputRef}
                type="file"
                accept=".json,application/json"
                className="hidden"
                onChange={handleImportFile}
              />
            </div>
          </SettingRow>
          {presetImportError && (
            <div className="flex items-start gap-2 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
              <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span className="leading-relaxed">{presetImportError}</span>
            </div>
          )}
          {presetGroups.length === 0 ? (
            <p className="text-sm text-muted">
              {t("settings.presets.empty_hint_before")} <span className="font-medium text-fg">{t("settings.presets.empty_hint_action")}</span> {t("settings.presets.empty_hint_after")}
            </p>
          ) : (
            <>
              <div className="space-y-4">
                {presetGroups.map((group) => {
                  const algo = algorithms.find((a) => a.id === group.algorithmId);
                  return (
                    <div key={group.algorithmId}>
                      <div className="flex items-center justify-between mb-2">
                        <div className="text-sm font-medium">{algo?.name ?? group.algorithmId}</div>
                        <span className="text-[11px] text-muted">
                          {group.presets.length === 1
                            ? t("settings.presets.preset_count", { n: group.presets.length })
                            : t("settings.presets.preset_count_plural", { n: group.presets.length })}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {group.presets.map((preset) => (
                          <div
                            key={preset.name}
                            className="inline-flex items-center gap-1 rounded-md bg-tile pl-2 pr-1 h-7 text-xs"
                          >
                            <Bookmark className="h-3 w-3 text-muted" />
                            <span className="font-medium text-fg" title={t("settings.presets.saved_at", { date: new Date(preset.createdAt).toLocaleString() })}>
                              {preset.name}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleDeletePreset(group.algorithmId, preset.name)}
                              aria-label={t("settings.presets.delete_preset_aria", { name: preset.name })}
                              className="ml-0.5 h-5 w-5 grid place-items-center rounded text-muted hover:text-danger hover:bg-bg transition"
                              title={t("settings.presets.delete_preset_title")}
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
              <SettingRow
                label={t("settings.presets.clear_all_label")}
                hint={totalPresets === 1
                  ? t("settings.presets.clear_all_hint", { n: totalPresets })
                  : t("settings.presets.clear_all_hint_plural", { n: totalPresets })}
              >
                {confirmClearPresets ? (
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="primary" className="bg-danger hover:bg-danger/90" onClick={handleClearAllPresets}>
                      {t("settings.presets.confirm_clear")}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setConfirmClearPresets(false)}>
                      {t("common.cancel")}
                    </Button>
                  </div>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => setConfirmClearPresets(true)}>
                    <Trash2 className="h-3.5 w-3.5" />
                    {t("settings.presets.clear_button")}
                  </Button>
                )}
              </SettingRow>
            </>
          )}
        </CardContent>
      </Card>

      {/* Storage */}
      <Card>
        <CardHeader>
          <CardTitle>{t("settings.storage.title")}</CardTitle>
          <CardDescription>{t("settings.storage.description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <SettingRow
            label={t("settings.storage.cached_params_label")}
            hint={
              cachedParamCount > 0
                ? (cachedParamCount === 1
                    ? t("settings.storage.cached_params_hint", { n: cachedParamCount })
                    : t("settings.storage.cached_params_hint_plural", { n: cachedParamCount }))
                : t("settings.storage.cached_params_empty")
            }
          >
            {confirmClearParams ? (
              <div className="flex items-center gap-2">
                <Button size="sm" variant="primary" className="bg-danger hover:bg-danger/90" onClick={handleClearParamCache}>
                  {t("settings.storage.confirm_clear")}
                </Button>
                <Button size="sm" variant="outline" onClick={() => setConfirmClearParams(false)}>
                  {t("common.cancel")}
                </Button>
              </div>
            ) : (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setConfirmClearParams(true)}
                disabled={cachedParamCount === 0}
              >
                <Trash2 className="h-3.5 w-3.5" />
                {t("settings.storage.clear_cache_button")}
              </Button>
            )}
          </SettingRow>

          <SettingRow
            label={t("settings.storage.onboarding_label")}
            hint={t("settings.storage.onboarding_hint")}
          >
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                try {
                  localStorage.setItem("app.onboarding-replay", "1");
                } catch {
                  /* ignore */
                }
                window.location.href = "/";
              }}
            >
              <PlayCircle className="h-3.5 w-3.5" />
              {t("settings.storage.replay_tour_button")}
            </Button>
          </SettingRow>

          <SettingRow
            label={t("settings.storage.run_history_label")}
            hint={t("settings.storage.run_history_hint")}
          >
            <Link
              href="/runs"
              className="h-8 px-3 inline-flex items-center gap-1.5 rounded-md border border-border hover:bg-surface transition text-xs font-medium text-fg"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              {t("settings.storage.open_run_history")}
            </Link>
          </SettingRow>

          <SettingRow
            label={t("settings.storage.clear_jobs_label")}
            hint={t("settings.storage.clear_jobs_hint")}
          >
            {confirmClearJobs ? (
              <div className="flex items-center gap-2">
                <Button size="sm" variant="primary" className="bg-danger hover:bg-danger/90" onClick={handleClearJobs}>
                  {t("settings.storage.confirm_delete")}
                </Button>
                <Button size="sm" variant="outline" onClick={() => setConfirmClearJobs(false)}>
                  {t("common.cancel")}
                </Button>
              </div>
            ) : (
              <Button size="sm" variant="outline" onClick={() => setConfirmClearJobs(true)}>
                <Trash2 className="h-3.5 w-3.5" />
                {t("settings.storage.delete_all_jobs")}
              </Button>
            )}
          </SettingRow>
        </CardContent>
      </Card>

      {/* About */}
      <Card>
        <CardHeader>
          <CardTitle>{t("settings.about.title")}</CardTitle>
          <CardDescription>{t("settings.about.description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted">{t("settings.about.product_label")}</span>
            <span>{APP_NAME}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted">{t("settings.about.algorithms_loaded_label")}</span>
            <span>{algorithms.length}</span>
          </div>
          {REPO_URL && (
            <div className="flex items-center justify-between">
              <span className="text-muted">{t("settings.about.source_label")}</span>
              <a
                href={REPO_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 hover:text-accent"
              >
                <Github className="h-3.5 w-3.5" />
                {new URL(REPO_URL).host}
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          )}
          <div className="flex items-center justify-between">
            <span className="text-muted">{t("settings.about.documentation_label")}</span>
            <Link href="/" className="hover:text-accent inline-flex items-center gap-1.5">
              {t("settings.about.back_to_workbench")}
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function SettingRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
      <div className="min-w-0 max-w-md">
        <div className="text-sm font-medium">{label}</div>
        {hint && <div className="text-[11px] text-muted mt-1 leading-relaxed">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}
