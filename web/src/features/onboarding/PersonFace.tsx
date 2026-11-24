import { useLayoutEffect, useRef } from "react";
import { cleanRecipe, type PersonRecipe } from "faang-ui";
import { N, drawPerson } from "faang-ui/person/engine";

/** The FAANG person portrait on a transparent background: no dithered sky behind it. */
export function PersonFace({
  recipe,
  crop = "full",
  className,
}: {
  recipe: Partial<PersonRecipe>;
  crop?: "face" | "full";
  className?: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const code = JSON.stringify(recipe);

  useLayoutEffect(() => {
    const el = canvas.current;
    const parent = el?.parentElement;
    if (!el || !parent) return;
    const ratio = typeof devicePixelRatio === "number" ? Math.max(1, devicePixelRatio) : 1;
    const px = (parent.clientWidth || 36) * ratio;
    const [x0, y0, n] = crop === "face" ? [4, 3, 24] : [0, 0, N];
    const cell = Math.max(1, Math.ceil(px / n));
    el.width = cell * n;
    el.height = cell * n;
    const ctx = el.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, el.width, el.height);
    const cells = drawPerson(cleanRecipe(recipe));
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const color = cells[(y + y0) * N + (x + x0)];
        if (!color) continue;
        ctx.fillStyle = color;
        ctx.fillRect(x * cell, y * cell, cell, cell);
      }
    }
  }, [code, crop]);

  return <canvas ref={canvas} className={`jeff-person-face ${className ?? ""}`.trim()} aria-hidden="true" />;
}
