import { flushSync } from "react-dom";

/**
 * A live reorder with the rows sliding to their new places: measure, commit
 * the new order, then animate every row from where it was to where it is.
 */
export function animateReorder(container: HTMLElement | null, update: () => void) {
  if (!container || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    update();
    return;
  }
  const before = new Map(
    [...container.querySelectorAll<HTMLElement>("[data-sort-id]")].map((el) => [
      el.dataset.sortId ?? "",
      el.getBoundingClientRect().top,
    ]),
  );
  flushSync(update);
  for (const el of container.querySelectorAll<HTMLElement>("[data-sort-id]")) {
    const start = before.get(el.dataset.sortId ?? "");
    if (start === undefined) continue;
    const delta = start - el.getBoundingClientRect().top;
    if (Math.abs(delta) < 1) continue;
    el.animate(
      [{ transform: `translateY(${delta}px)` }, { transform: "translateY(0)" }],
      { duration: 180, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
    );
  }
}
