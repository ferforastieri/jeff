import { JeffSky, type JeffSkyItem } from "@jeff/ui/kit";

/**
 * A quiet group of Jeffs for the sidebars: more than a watermark, still low
 * enough that the rows and people keep the room.
 */
const SIDEBAR_JEFFS: readonly JeffSkyItem[] = [
  { left: "6%", top: "36%", size: 28, opacity: 0.55, image: "jeff-12", duration: 12, delay: -3 },
  { left: "74%", top: "48%", size: 34, opacity: 0.45, image: "jeff-21", duration: 10, delay: -2 },
  { left: "38%", top: "64%", size: 24, opacity: 0.4, image: "jeff-25", duration: 14, delay: -7 },
  { left: "18%", top: "76%", size: 22, opacity: 0.42, image: "jeff-07", duration: 16, delay: -5 },
  { left: "62%", top: "80%", size: 20, opacity: 0.38, image: "jeff-18", duration: 13, delay: -9 },
  { left: "86%", top: "70%", size: 26, opacity: 0.42, image: "jeff-30", duration: 11, delay: -4 },
  { left: "48%", top: "88%", size: 18, opacity: 0.36, image: "jeff-12", duration: 15, delay: -6 },
];

export default function SidebarJeffs({ className, subtle = false }: { className?: string; subtle?: boolean }) {
  return (
    <div className={`ws-sidebar-sky${subtle ? " is-subtle" : ""}${className ? ` ${className}` : ""}`} aria-hidden="true">
      <JeffSky
        srcFor={(name) => `${import.meta.env.BASE_URL}jeffs/${name}.png`}
        items={subtle ? SIDEBAR_JEFFS.slice(0, 6) : SIDEBAR_JEFFS}
      />
    </div>
  );
}
