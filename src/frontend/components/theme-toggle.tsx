"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n";

export function ThemeToggle() {
  const { setTheme, resolvedTheme } = useTheme();
  const t = useT();
  // The server cannot know the theme of the OS; the state is announced once it is known.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const isDark = resolvedTheme === "dark";

  return (
    <button
      type="button"
      aria-label={t("header.dark_mode")}
      aria-pressed={mounted ? isDark : undefined}
      title={mounted ? t(isDark ? "header.switch_to_light" : "header.switch_to_dark") : t("header.dark_mode")}
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className="h-9 w-9 grid place-items-center rounded-md bg-tile hover:bg-accent/[0.08] transition text-muted hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      {/* Both icons are rendered and the class of <html> picks one, so the first paint already
          shows the right one. */}
      <Sun className="h-4 w-4 hidden dark:block" aria-hidden />
      <Moon className="h-4 w-4 dark:hidden" aria-hidden />
    </button>
  );
}
