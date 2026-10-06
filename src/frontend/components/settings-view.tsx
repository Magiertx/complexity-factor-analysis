"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
  Loader2,
  Code2,
} from "lucide-react";
import {
  AlgorithmManifest,
  fetchAlgorithms,
  deleteAllDatasets,
  deleteAllJobs,
  listDatasets,
} from "@/lib/api";
import { APP_NAME, REPO_URL } from "@/lib/app-config";
import { STORAGE_PREFIXES } from "@/lib/factor-analysis";
import { Button } from "./ui/button";
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

const ALGO_PARAMS_PREFIX = "app.params-";

type ThemeChoice = "system" | "light" | "dark";

export function SettingsView() {
  const { theme, setTheme } = useTheme();
  const t = useT();
  const [mounted, setMounted] = useState(false);
  const [algorithms, setAlgorithms] = useState<AlgorithmManifest[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [cachedParamCount, setCachedParamCount] = useState(0);
  const [confirmClearJobs, setConfirmClearJobs] = useState(false);
  const [confirmClearDatasets, setConfirmClearDatasets] = useState(false);
  const [clearingDatasets, setClearingDatasets] = useState(false);
  const clearDatasetsRef = useRef<HTMLButtonElement>(null);
  const confirmDatasetsRef = useRef<HTMLButtonElement>(null);
  const datasetsRowRef = useRef<HTMLDivElement>(null);
  // Datasets of the factor analysis on the server; null while unknown.
  const [datasetCount, setDatasetCount] = useState<number | null>(null);
  const [confirmClearParams, setConfirmClearParams] = useState(false);
  const [confirmClearPresets, setConfirmClearPresets] = useState(false);
  const [presetGroups, setPresetGroups] = useState<{ algorithmId: string; presets: Preset[] }[]>([]);
  const [savedToast, setSavedToast] = useState<string | null>(null);
  const [presetImportError, setPresetImportError] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    fetchAlgorithms()
      .then((res) => setAlgorithms(res.algorithms))
      .catch((e: Error) => setLoadError(e.message));
  }, []);

  const refreshDatasetCount = useCallback(() => {
    listDatasets()
      .then((list) => setDatasetCount(list.length))
      .catch(() => setDatasetCount(null));
  }, []);

  useEffect(() => {
    refreshDatasetCount();
  }, [refreshDatasetCount]);

  useEffect(() => {
    if (typeof window === "undefined") return;
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
    } catch {
      showToast(t("settings.toast_job_history_failed"));
    }
    // Computed datasets go with their jobs.
    refreshDatasetCount();
  };

  // The confirmation replaces the button, and its own button is disabled while it deletes, so
  // the focus would end up nowhere: it goes to whichever of the two is shown, or to the row
  // once no dataset is left to delete.
  const refocusDatasets = useRef(false);
  useEffect(() => {
    if (clearingDatasets || !refocusDatasets.current) return;
    refocusDatasets.current = false;
    const button = confirmClearDatasets ? confirmDatasetsRef.current : clearDatasetsRef.current;
    (button && !button.disabled ? button : datasetsRowRef.current)?.focus();
  }, [confirmClearDatasets, clearingDatasets]);

  const handleClearDatasets = async () => {
    refocusDatasets.current = true;
    setClearingDatasets(true);
    try {
      const n = await deleteAllDatasets();
      // The tabs would otherwise try to reopen a deleted dataset.
      const keys: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && STORAGE_PREFIXES.some((p) => k.startsWith(p))) keys.push(k);
      }
      for (const k of keys) localStorage.removeItem(k);
      setDatasetCount(0);
      setConfirmClearDatasets(false);
      showToast(n === 1
        ? t("settings.storage.toast_datasets_deleted", { n })
        : t("settings.storage.toast_datasets_deleted_plural", { n }));
    } catch {
      showToast(t("settings.storage.toast_datasets_failed"));
    } finally {
      setClearingDatasets(false);
    }
  };

  const currentTheme: ThemeChoice = mounted
    ? (theme === "system" ? "system" : ((theme as ThemeChoice) || "system"))
    : "system";

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="h-9 w-9 grid place-items-center rounded-md bg-tile hover:bg-accent/[0.08] transition text-muted hover:text-fg"
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
        {/* Always rendered, so screen readers announce each toast that appears in it. */}
        <div role="status">
          {savedToast && (
            <div className="flex items-center gap-2 text-xs text-muted bg-tile rounded-md px-3 py-2">
              <Check className="h-3.5 w-3.5 text-accent-ink" />
              {savedToast}
            </div>
          )}
        </div>
      </header>

      {loadError && (
        <Card className="border-danger/40">
          <CardContent className="flex items-start gap-2 text-sm text-danger-ink">
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
            <div className="flex items-start gap-2 rounded-md bg-danger/10 px-3 py-2 text-xs text-danger-ink">
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
                              className="ml-0.5 h-5 w-5 grid place-items-center rounded text-muted hover:text-danger-ink hover:bg-bg transition"
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
              className="h-8 px-3 inline-flex items-center gap-1.5 rounded-md bg-tile hover:bg-accent/[0.08] transition text-xs font-medium text-fg"
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

          <SettingRow
            rowRef={datasetsRowRef}
            label={t("settings.storage.clear_datasets_label")}
            hint={
              datasetCount === null
                ? t("settings.storage.clear_datasets_unknown")
                : datasetCount === 0
                  ? t("settings.storage.clear_datasets_empty")
                  : datasetCount === 1
                    ? t("settings.storage.clear_datasets_hint", { n: datasetCount })
                    : t("settings.storage.clear_datasets_hint_plural", { n: datasetCount })
            }
          >
            {confirmClearDatasets ? (
              <div className="flex items-center gap-2">
                <Button
                  ref={confirmDatasetsRef}
                  size="sm"
                  variant="primary"
                  className="bg-danger hover:bg-danger/90"
                  onClick={handleClearDatasets}
                  disabled={clearingDatasets}
                  // It replaces the focused button, which would leave the focus nowhere.
                  autoFocus
                >
                  {clearingDatasets && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {t("settings.storage.confirm_delete")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    refocusDatasets.current = true;
                    setConfirmClearDatasets(false);
                  }}
                  disabled={clearingDatasets}
                >
                  {t("common.cancel")}
                </Button>
              </div>
            ) : (
              <Button
                ref={clearDatasetsRef}
                size="sm"
                variant="outline"
                onClick={() => setConfirmClearDatasets(true)}
                disabled={datasetCount === 0}
              >
                <Trash2 className="h-3.5 w-3.5" />
                {t("settings.storage.delete_all_datasets")}
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
          {REPO_URL && (
            <div className="flex items-center justify-between">
              <span className="text-muted">{t("settings.about.source_label")}</span>
              <a
                href={REPO_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 hover:text-accent-ink"
              >
                <Github className="h-3.5 w-3.5" />
                {new URL(REPO_URL).host}
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          )}
          <div className="flex items-center justify-between">
            <span className="text-muted">{t("settings.about.documentation_label")}</span>
            <Link href="/api-access" className="hover:text-accent-ink inline-flex items-center gap-1.5">
              <Code2 className="h-3.5 w-3.5" />
              {t("settings.about.api_link")}
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
  rowRef,
  children,
}: {
  label: string;
  hint?: string;
  /** Makes the row focusable from script, for when its control can take no focus. */
  rowRef?: React.Ref<HTMLDivElement>;
  children: React.ReactNode;
}) {
  return (
    <div
      ref={rowRef}
      tabIndex={rowRef ? -1 : undefined}
      className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-6 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-4 focus-visible:ring-offset-surface"
    >
      <div className="min-w-0 max-w-md">
        <div className="text-sm font-medium">{label}</div>
        {hint && <div className="text-[11px] text-muted mt-1 leading-relaxed">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}
