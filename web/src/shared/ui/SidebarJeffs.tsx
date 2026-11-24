import { JeffSky, type JeffSkyItem } from "@jeff/ui/kit";

/**
 * A handful of Jeffs for the sidebar, not the whole sky: three small sprites
 * low in the panel, half faded, so the tool rows and people keep the room.
 */
const SIDEBAR_JEFFS: readonly JeffSkyItem[] = [
  { left: "6%", top: "38%", size: 30, opacity: 0.55, image: "jeff-12", duration: 12, delay: -3 },
  { left: "74%", top: "56%", size: 36, opacity: 0.45, image: "jeff-21", duration: 10, delay: -2 },
  { left: "40%", top: "72%", size: 24, opacity: 0.4, image: "jeff-25", duration: 14, delay: -7 },
];

export default function SidebarJeffs({ className, subtle = false }: { className?: string; subtle?: boolean }) {
  return (
    <div className={`ws-sidebar-sky${subtle ? " is-subtle" : ""}${className ? ` ${className}` : ""}`} aria-hidden="true">
      <JeffSky
        srcFor={(name) => `${import.meta.env.BASE_URL}jeffs/${name}.png`}
        items={subtle ? SIDEBAR_JEFFS.slice(0, 2) : SIDEBAR_JEFFS}
      />
    </div>
  );
}
