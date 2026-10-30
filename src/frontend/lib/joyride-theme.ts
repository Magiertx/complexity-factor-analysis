import type { CSSProperties } from "react";
import type { Options, Styles } from "react-joyride";

// Shared Joyride theming. Every tour takes its `options` and `styles` from
// here, so design changes only touch this file. The RGB values mirror the
// tokens in app/globals.css.
//
// If the tokens there ever change, update them here as well:
//   --accent      → 225 29 72
//   --accent-fg   → 255 255 255
//   --surface     → light: 255 255 255  / dark: 24 24 29
//   --border      → light: 170 182 200 / dark: 72 72 82
//   --fg          → light: 15 23 42    / dark: 244 244 245
//   --muted       → light: 71 85 105   / dark: 150 150 160

const ACCENT = "rgb(225 29 72)";
const ACCENT_FG = "rgb(255 255 255)";

const LIGHT = {
  surface: "rgb(255 255 255)",
  border: "rgb(170 182 200)",
  fg: "rgb(15 23 42)",
  muted: "rgb(71 85 105)",
  mutedSoft: "rgb(100 116 139)",
};

const DARK = {
  surface: "rgb(24 24 29)",
  border: "rgb(72 72 82)",
  fg: "rgb(244 244 245)",
  muted: "rgb(150 150 160)",
  mutedSoft: "rgb(161 161 170)",
};

export function getJoyrideOptions(isDark: boolean): Partial<Options> {
  const t = isDark ? DARK : LIGHT;
  return {
    // Progress, skip button and close; skip the beacon step so the tooltip
    // appears right away.
    showProgress: true,
    skipBeacon: true,
    buttons: ["back", "close", "primary", "skip"],

    // The close button in the corner ends the tour (the default 'close' would
    // advance to the next step). Escape has no 'skip' action here, so the Tour
    // component handles it.
    closeButtonAction: "skip",
    dismissKeyAction: false,

    primaryColor: ACCENT,
    textColor: t.fg,
    backgroundColor: t.surface,
    arrowColor: t.surface,
    overlayColor: "rgba(0, 0, 0, 0.55)",
    zIndex: 10000,

    // Safety net for a missing target: short timeout instead of a long
    // loader hang.
    targetWaitTimeout: 800,
    loaderDelay: 200,
  };
}

export type TFn = (key: string) => string;

export function getJoyrideLocale(t: TFn) {
  return {
    back: t("common.back"),
    close: t("common.close"),
    last: t("common.done"),
    next: t("common.next"),
    // Joyride fills in {current} and {total}; without it, every step but the last shows its
    // English default.
    nextWithProgress: t("common.next_with_progress"),
    skip: t("common.skip"),
  };
}

export function getJoyrideStyles(isDark: boolean): Partial<Styles> {
  const t = isDark ? DARK : LIGHT;

  const button: CSSProperties = {
    fontFamily: "inherit",
    fontSize: 12,
    fontWeight: 500,
    padding: "6px 12px",
    borderRadius: 6,
    outline: "none",
  };

  return {
    // The card. Padding 0 because tooltipContainer and tooltipFooter set
    // their own padding (otherwise tooltips get padded twice).
    tooltip: {
      fontFamily: "inherit",
      padding: 0,
      borderRadius: 8,
      border: `1px solid ${t.border}`,
      boxShadow: "0 25px 50px -12px rgb(0 0 0 / 0.4)",
      fontSize: 13,
    },
    tooltipContainer: {
      textAlign: "left",
      padding: 20,
    },
    tooltipTitle: {
      fontFamily: "inherit",
      fontSize: 14,
      fontWeight: 600,
      marginBottom: 8,
      letterSpacing: "-0.01em",
    },
    tooltipContent: {
      fontFamily: "inherit",
      fontSize: 13,
      lineHeight: 1.5,
      padding: 0,
    },
    // Footer is the button row. Own padding so skip/back/primary do not touch
    // the card edge.
    tooltipFooter: {
      marginTop: 0,
      padding: "0 20px 20px 20px",
    },
    buttonPrimary: {
      ...button,
      background: ACCENT,
      color: ACCENT_FG,
      padding: "6px 14px",
    },
    buttonBack: {
      ...button,
      color: t.mutedSoft,
      marginRight: 4,
    },
    buttonSkip: {
      ...button,
      color: t.muted,
    },
    // Close button in the corner. The default is large and black; scaled
    // down to the app style.
    buttonClose: {
      fontFamily: "inherit",
      color: t.muted,
      height: 12,
      width: 12,
      right: 14,
      top: 14,
    },
  };
}
