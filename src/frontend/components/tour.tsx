"use client";

import dynamic from "next/dynamic";
import { useTheme } from "next-themes";
import type { Step, EventData } from "react-joyride";
import { getJoyrideOptions, getJoyrideStyles, getJoyrideLocale } from "@/lib/joyride-theme";
import { useT } from "@/lib/i18n";

const Joyride = dynamic(
  () => import("react-joyride").then((m) => ({ default: m.Joyride })),
  { ssr: false },
);

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

  return (
    <Joyride
      run={run}
      steps={steps}
      continuous
      options={getJoyrideOptions(isDark)}
      locale={getJoyrideLocale(t)}
      styles={getJoyrideStyles(isDark)}
      onEvent={(data: EventData) => {
        if (data.type === "tour:end") onClose();
      }}
    />
  );
}
