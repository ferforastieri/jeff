import { cx } from "@jeff/ui";
import { useProjectRunning } from "../../agents/activity";

/** Pulsing dot over a project icon while any of its agents is running. */
export default function ProjectRunningDot({ projectId, className }: { projectId: string; className?: string }) {
  const running = useProjectRunning(projectId);
  if (!running) return null;
  return (
    <span className={cx("pointer-events-none absolute flex size-2.5", className)} title="Agente rodando" aria-label="Agente rodando">
      <span className="absolute inline-flex size-full animate-ping rounded-full bg-status-lime-text opacity-50" />
      <span className="relative inline-flex size-2.5 rounded-full border border-background-primary-default bg-status-lime-text" />
    </span>
  );
}
