import { useEffect, useState, type ReactNode } from "react";
import { Globe2, LoaderCircle, TerminalSquare } from "@jeff/icons";
import { Group, Panel, Separator } from "react-resizable-panels";
import { api, type Project } from "../../../shared/api";
import { useSettings } from "../../settings/store";
import { TerminalView } from "../../terminal/components/TerminalPanel";
import DebugBrowserPanel from "./DebugBrowserPanel";
import { cx } from "@jeff/ui";

interface Props {
  project: Project;
  children: ReactNode;
  mobile?: boolean;
  onOpenFile?: (path: string, line?: number) => void;
}

type DebugTab = "terminal" | "browser";

/**
 * Debug mode inside the agent: the conversation, the visible terminal the
 * agent drives and the live browser it controls, side by side.
 */
export default function AgentDebugWorkspace({ project, children, mobile = false, onOpenFile }: Props) {
  const theme = useSettings((state) => state.theme);
  const [terminal, setTerminal] = useState<{ id: string; shell: string } | null>(null);
  const [terminalError, setTerminalError] = useState("");
  const [tab, setTab] = useState<DebugTab>("terminal");

  useEffect(() => {
    let cancelled = false;
    setTerminal(null);
    setTerminalError("");
    api
      .debugTerminal(project.id)
      .then((info) => {
        if (!cancelled) setTerminal({ id: info.id, shell: info.shell });
      })
      .catch((error) => {
        if (!cancelled) setTerminalError(error instanceof Error ? error.message : "Não foi possível abrir o terminal de debug.");
      });
    return () => {
      cancelled = true;
    };
  }, [project.id]);

  const terminalBody = (
    <section className="flex h-full min-h-0 flex-col overflow-hidden bg-background-full">
      <header className="flex h-8 shrink-0 items-center gap-2 border-b border-separator-border px-2 text-caption-2-medium text-text-secondary">
        <TerminalSquare size={13} />
        <span>Terminal do agente</span>
        <span className="truncate text-text-tertiary">— cada comando aparece aqui</span>
      </header>
      <div className="min-h-0 flex-1 p-1">
        {terminalError ? (
          <p role="alert" className="p-3 text-caption-1-regular text-text-error-primary">{terminalError}</p>
        ) : terminal ? (
          <TerminalView
            session={{ id: terminal.id, shell: terminal.shell, title: "Debug" }}
            theme={theme}
            clearNonce={0}
            focusNonce={0}
            mobile={mobile}
            onOutput={() => undefined}
            onOpenFile={(path, line) => onOpenFile?.(path, line)}
          />
        ) : (
          <div className="flex h-full items-center justify-center gap-2 text-caption-1-regular text-text-tertiary">
            <LoaderCircle size={15} className="animate-spin" /> Preparando o terminal…
          </div>
        )}
      </div>
    </section>
  );

  const browserBody = <DebugBrowserPanel projectId={project.id} />;

  if (mobile) {
    return (
      <Group orientation="vertical" className="h-full min-h-0 w-full">
        <Panel defaultSize="52" minSize="25">
          <div className="h-full min-h-0">{children}</div>
        </Panel>
        <Separator className="group relative h-px bg-separator-border after:absolute after:inset-x-0 after:top-1/2 after:h-2 after:-translate-y-1/2 after:content-[''] hover:after:bg-ring/50" />
        <Panel defaultSize="48" minSize="20">
          <section className="flex h-full min-h-0 flex-col overflow-hidden bg-background-full">
            <div className="flex h-8 shrink-0 items-center gap-1 border-b border-separator-border px-1.5">
              {([
                { id: "terminal", label: "Terminal", icon: TerminalSquare },
                { id: "browser", label: "Browser", icon: Globe2 },
              ] as const).map((item) => {
                const Icon = item.icon;
                const active = tab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setTab(item.id)}
                    className={cx(
                      "flex h-6 items-center gap-1 rounded-md px-2 text-caption-2-medium transition-colors",
                      active ? "bg-background-secondary-hover text-text-primary" : "text-text-tertiary hover:text-text-primary",
                    )}
                    aria-pressed={active}
                  >
                    <Icon size={12} /> {item.label}
                  </button>
                );
              })}
            </div>
            <div className="min-h-0 flex-1">{tab === "terminal" ? terminalBody : browserBody}</div>
          </section>
        </Panel>
      </Group>
    );
  }

  return (
    <Group orientation="horizontal" className="h-full min-h-0 w-full">
      <Panel defaultSize="56" minSize="30">
        <div className="h-full min-h-0">{children}</div>
      </Panel>
      <Separator className="group relative w-px bg-separator-border after:absolute after:inset-y-0 after:left-1/2 after:w-2 after:-translate-x-1/2 after:content-[''] hover:after:bg-ring/50" />
      <Panel defaultSize="44" minSize="24">
        <Group orientation="vertical" className="h-full min-h-0">
          <Panel defaultSize="36" minSize="18">
            {terminalBody}
          </Panel>
          <Separator className="group relative h-px bg-separator-border after:absolute after:inset-x-0 after:top-1/2 after:h-2 after:-translate-y-1/2 after:content-[''] hover:after:bg-ring/50" />
          <Panel defaultSize="64" minSize="25">
            {browserBody}
          </Panel>
        </Group>
      </Panel>
    </Group>
  );
}
