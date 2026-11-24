import { useEffect, useRef } from "react";

export type JeffSkyItem = {
  left: string;
  top: string;
  size: number;
  opacity: number;
  image: string;
  duration: number;
  delay: number;
};

export const JEFF_SKY = [
  { left: "3%", top: "10%", size: 40, opacity: 0.82, image: "jeff-02", duration: 11, delay: -2 },
  { left: "12%", top: "26%", size: 26, opacity: 0.6, image: "jeff-05", duration: 9, delay: -4 },
  { left: "86%", top: "8%", size: 48, opacity: 0.92, image: "jeff-07", duration: 13, delay: -1 },
  { left: "78%", top: "30%", size: 30, opacity: 0.7, image: "jeff-09", duration: 10, delay: -5 },
  { left: "5%", top: "55%", size: 44, opacity: 0.76, image: "jeff-12", duration: 12, delay: -3 },
  { left: "16%", top: "72%", size: 60, opacity: 0.95, image: "jeff-16", duration: 14, delay: -6 },
  { left: "88%", top: "58%", size: 42, opacity: 0.82, image: "jeff-21", duration: 10, delay: -2 },
  { left: "70%", top: "78%", size: 34, opacity: 0.66, image: "jeff-27", duration: 12, delay: -7 },
  { left: "30%", top: "82%", size: 26, opacity: 0.56, image: "jeff-orbit", duration: 9, delay: -1 },
  { left: "50%", top: "90%", size: 54, opacity: 0.75, image: "jeff-bloom", duration: 15, delay: -4 },
  { left: "64%", top: "12%", size: 32, opacity: 0.6, image: "jeff-comet", duration: 11, delay: -8 },
  { left: "36%", top: "8%", size: 24, opacity: 0.5, image: "jeff-pebble", duration: 10, delay: -3 },
  { left: "44%", top: "70%", size: 24, opacity: 0.4, image: "jeff-01", duration: 13, delay: -5 },
  { left: "56%", top: "28%", size: 20, opacity: 0.34, image: "jeff-04", duration: 9, delay: -2 },
  { left: "22%", top: "45%", size: 30, opacity: 0.5, image: "jeff-11", duration: 12, delay: -6 },
  { left: "76%", top: "45%", size: 24, opacity: 0.45, image: "jeff-18", duration: 10, delay: -1 },
  { left: "10%", top: "88%", size: 36, opacity: 0.65, image: "jeff-25", duration: 14, delay: -7 },
  { left: "92%", top: "82%", size: 30, opacity: 0.55, image: "jeff-30", duration: 11, delay: -3 },
] as const;

export function JeffSky({ srcFor, items = JEFF_SKY }: { srcFor: (name: string) => string; items?: readonly JeffSkyItem[] }) {
  const eyes = useRef<Array<HTMLImageElement | null>>([]);

  useEffect(() => {
    const move = (event: PointerEvent) => {
      for (const eye of eyes.current) {
        const box = eye?.parentElement?.getBoundingClientRect();
        if (!eye || !box || box.width === 0) continue;
        const dx = (event.clientX - (box.left + box.width / 2)) / (box.width / 2);
        const dy = (event.clientY - (box.top + box.height / 2)) / (box.height / 2);
        const x = Math.max(-1, Math.min(1, dx)) * 2.4;
        const y = Math.max(-1, Math.min(1, dy)) * 2.4;
        eye.style.transform = `translate(${x}px, ${y}px)`;
      }
    };
    window.addEventListener("pointermove", move, { passive: true });
    return () => window.removeEventListener("pointermove", move);
  }, []);

  return (
    <div aria-hidden="true" className="jeff-sky">
      {items.map((jeff, index) => (
        <span
          key={index}
          className="jeff-sky__jeff"
          style={{
            left: jeff.left,
            top: jeff.top,
            width: jeff.size,
            height: jeff.size,
            opacity: jeff.opacity,
            animationDuration: `${jeff.duration}s`,
            animationDelay: `${jeff.delay}s`,
          }}
        >
          <img
            src={srcFor(`${jeff.image}-eyeless`)}
            alt=""
            draggable={false}
            className="jeff-sky__body"
          />
          <img
            ref={(element) => {
              eyes.current[index] = element;
            }}
            src={srcFor(`${jeff.image}-eyes`)}
            alt=""
            draggable={false}
            className="jeff-sky__eyes"
          />
        </span>
      ))}
    </div>
  );
}
