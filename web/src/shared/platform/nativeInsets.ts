interface NativeInsets {
  top: number;
  bottom: number;
  left: number;
  right: number;
  keyboard?: number;
}

interface JeffInsetsBridge {
  insets?: () => string;
}

let installed = false;

const NON_TEXT_INPUTS = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "hidden",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);

function isEditable(element: Element | null): element is HTMLElement {
  if (!(element instanceof HTMLElement)) return false;
  if (element.isContentEditable) return true;
  if (element.tagName === "TEXTAREA" || element.tagName === "SELECT") return true;
  if (element.tagName !== "INPUT") return false;
  return !NON_TEXT_INPUTS.has((element as HTMLInputElement).type.toLowerCase());
}

/**
 * The on-screen keyboard overlays the layout viewport on Android and in most
 * mobile browsers. When a field is focused, bring it above the visible area so
 * forms inside sheets, dialogs and the workspace do not end up under the keys.
 */
function scrollFocusedIntoView(): void {
  const active = document.activeElement;
  if (!isEditable(active)) return;
  const viewport = window.visualViewport;
  const viewportTop = viewport?.offsetTop ?? 0;
  const viewportHeight = viewport?.height ?? window.innerHeight;
  const rect = active.getBoundingClientRect();
  const margin = 12;
  const above = viewportTop + margin;
  const below = viewportTop + viewportHeight - margin;
  if (rect.top >= above && rect.bottom <= below) return;
  active.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
}

function readInsets(): NativeInsets | null {
  const bridge = (window as unknown as { JeffInsets?: JeffInsetsBridge }).JeffInsets;
  if (!bridge?.insets) return null;
  try {
    const parsed = JSON.parse(bridge.insets()) as Partial<NativeInsets>;
    const values = [parsed.top, parsed.bottom, parsed.left, parsed.right];
    if (!values.every((value) => typeof value === "number" && Number.isFinite(value))) {
      return null;
    }
    return {
      top: Math.max(0, parsed.top ?? 0),
      bottom: Math.max(0, parsed.bottom ?? 0),
      left: Math.max(0, parsed.left ?? 0),
      right: Math.max(0, parsed.right ?? 0),
      keyboard: Math.max(0, parsed.keyboard ?? 0),
    };
  } catch {
    return null;
  }
}

export function installNativeInsets(): void {
  if (installed) return;
  installed = true;
  const root = document.documentElement;
  let frame = 0;
  let focusFrame = 0;

  const apply = () => {
    frame = 0;
    const insets = readInsets();
    const viewport = window.visualViewport;
    const viewportHeight = viewport?.height ?? window.innerHeight;
    const viewportOffsetTop = viewport?.offsetTop ?? 0;
    const visualKeyboard = Math.max(0, window.innerHeight - viewportHeight - viewportOffsetTop);
    const keyboard = Math.max(visualKeyboard, insets?.keyboard ?? 0);

    root.style.setProperty("--visual-viewport-height", `${viewportHeight}px`);
    root.style.setProperty("--visual-viewport-offset-top", `${viewportOffsetTop}px`);
    root.style.setProperty("--keyboard-inset", `${keyboard}px`);
    root.classList.toggle("keyboard-open", keyboard > 80);

    if (!insets) return;
    root.style.setProperty("--native-safe-top", `${insets.top}px`);
    root.style.setProperty("--native-safe-bottom", `${insets.bottom}px`);
    root.style.setProperty("--native-safe-left", `${insets.left}px`);
    root.style.setProperty("--native-safe-right", `${insets.right}px`);
  };

  const schedule = () => {
    if (frame) return;
    frame = window.requestAnimationFrame(apply);
  };

  // The keyboard animates after focus and after the visual viewport changes;
  // wait for it to settle before scrolling the field into view.
  const scheduleFocus = () => {
    if (focusFrame) window.clearTimeout(focusFrame);
    focusFrame = window.setTimeout(() => {
      focusFrame = 0;
      scrollFocusedIntoView();
    }, 280);
  };

  apply();
  window.addEventListener("resize", () => {
    schedule();
    scheduleFocus();
  }, { passive: true });
  window.addEventListener("orientationchange", schedule, { passive: true });
  window.addEventListener("focusin", () => {
    schedule();
    scheduleFocus();
  }, { passive: true });
  window.addEventListener("focusout", schedule, { passive: true });
  window.visualViewport?.addEventListener("resize", () => {
    schedule();
    scheduleFocus();
  }, { passive: true });
  window.visualViewport?.addEventListener("scroll", schedule, { passive: true });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) schedule();
  });
}
