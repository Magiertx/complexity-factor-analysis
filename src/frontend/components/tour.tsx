"use client";

// Wrapper around react-joyride shared by all guided tours: theme, language, Escape key, close callback.

import dynamic from "next/dynamic";
import { useEffect, useRef } from "react";
import { useTheme } from "next-themes";
import type { Controls, Step, EventData } from "react-joyride";
import { getJoyrideOptions, getJoyrideStyles, getJoyrideLocale } from "@/lib/joyride-theme";
import { useT } from "@/lib/i18n";

// Loaded on the client only: react-joyride needs the DOM.
const Joyride = dynamic(
  () => import("react-joyride").then((m) => ({ default: m.Joyride })),
  { ssr: false },
);

/** Runs a joyride tour with the given `steps` while `run` is true; `onClose` fires when it ends or is skipped. */
export function Tour({
  run,
  steps,
  onClose,
}: {
  run: boolean;
  steps: Step[];
  onClose: () => void;
}) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const t = useT();
  const controls = useRef<Controls | null>(null);

  // Escape ends the tour like Skip, as the intro of every tour says. Skipping
  // also rewinds it, so the next start begins at the first step again.
  useEffect(() => {
    if (!run) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") controls.current?.skip();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [run]);

  return (
    <Joyride
      run={run}
      steps={steps}
      continuous
      options={getJoyrideOptions(isDark)}
      locale={getJoyrideLocale(t)}
      styles={getJoyrideStyles(isDark)}
      onEvent={(data: EventData, tourControls: Controls) => {
        controls.current = tourControls;
        if (data.type === "tour:end") onClose();
      }}
    />
  );
}
