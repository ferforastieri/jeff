import type { MouseEvent } from "react";
import { Moon, Sun } from "@jeff/icons";
import { cx } from "@jeff/ui";
import { useSettings } from "../../features/settings/store";
import { runThemeTransition } from "./theme-transition";

/** The one light/dark control: a sun/moon that turns the theme where it was clicked. */
export function ThemeToggle({ className }: { className?: string } = {}) {
  const theme = useSettings((state) => state.theme);
  const setTheme = useSettings((state) => state.setTheme);
  const light = theme === "light";
  function toggle(event: MouseEvent<HTMLButtonElement>) {
    const next = light ? "dark" : "light";
    const rect = event.currentTarget.getBoundingClientRect();
    const origin = event.detail === 0
      ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
      : { x: event.clientX, y: event.clientY };
    void runThemeTransition(origin, () => setTheme(next));
  }
  return (
    <button
      type="button"
      aria-label={light ? "Ativar modo escuro" : "Ativar modo claro"}
      aria-pressed={light}
      title={light ? "Modo escuro" : "Modo claro"}
      onClick={toggle}
      className={cx("relative flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full text-foreground-icon-secondary transition-colors hover:bg-background-primary-hover hover:text-foreground-icon-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring", className)}
    >
      <Sun className={cx("absolute size-[18px] transition-all duration-300", light ? "rotate-0 scale-100 opacity-100" : "-rotate-90 scale-50 opacity-0")} />
      <Moon className={cx("absolute size-[18px] transition-all duration-300", light ? "rotate-90 scale-50 opacity-0" : "rotate-0 scale-100 opacity-100")} />
    </button>
  );
}
