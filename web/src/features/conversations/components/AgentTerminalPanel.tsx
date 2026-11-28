import { useEffect, useState } from "react";
import { PixelSpinner } from "@jeff/ui";
import { api, type Project } from "../../../shared/api";
import { useSettings } from "../../settings/store";
import { TerminalView } from "../../terminal/components/TerminalPanel";

interface Props {
  project: Project;
  mobile?: boolean;
  onOpenFile?: (path: string, line?: number) => void;
}

/** The terminal the agent drives. It is the same PTY the user types into. */
export default function AgentTerminalPanel({ project, mobile = false, onOpenFile }: Props) {
  const theme = useSettings((state) => state.theme);
  const [terminal, setTerminal] = useState<{ id: string; shell: string } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setTerminal(null);
    setError("");
    api
      .agentTerminal(project.id)
      .then((info) => {
        if (!cancelled) setTerminal({ id: info.id, shell: info.shell });
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Não foi possível abrir o terminal do agente.");
      });
    return () => {
      cancelled = true;
    };
  }, [project.id]);

  if (error) {
    return <p role="alert" className="p-4 text-caption-1-regular text-text-error-primary">{error}</p>;
  }
  if (!terminal) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-caption-1-regular text-text-tertiary">
        <PixelSpinner size={16} /> Preparando o terminal…
      </div>
    );
  }
  return (
    <TerminalView
      session={{ id: terminal.id, shell: terminal.shell, title: "Agente" }}
      theme={theme}
      clearNonce={0}
      focusNonce={0}
      mobile={mobile}
      onOutput={() => undefined}
      onOpenFile={(path, line) => onOpenFile?.(path, line)}
    />
  );
}
