import { Button as KitButton } from "@jeff/ui/kit";
import { NativeSelect as KitSelect } from "@jeff/ui/kit";
import { useEffect, useState } from "react";
import { UserRound } from "@jeff/icons";
import { api } from "../../shared/api";
import type { Project } from "../../shared/api";
import DebugBrowserPanel from "../conversations/components/DebugBrowserPanel";

interface BrowserAgent {
  id: string;
  name: string;
}

interface Props {
  project: Project;
  bots: BrowserAgent[];
  initialAgentId?: string;
}

export default function BotBrowserPanel({ project, bots, initialAgentId }: Props) {
  const [agentId, setAgentId] = useState(initialAgentId ?? bots[0]?.id ?? "");
  const [takeover, setTakeover] = useState(false);

  useEffect(() => {
    if (!bots.some((bot) => bot.id === agentId)) setAgentId(bots[0]?.id ?? "");
  }, [bots, agentId]);

  useEffect(() => {
    if (!agentId) return;
    let cancelled = false;
    void api
      .botBrowser(project.id, agentId)
      .then((info) => {
        if (!cancelled) setTakeover(Boolean(info.takeover));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [project.id, agentId]);

  async function toggleTakeover() {
    const next = !takeover;
    try {
      await api.botBrowserTakeover(project.id, agentId, next);
      setTakeover(next);
    } catch {
      // Keep the previous state; the dock keeps working.
    }
  }

  if (!agentId) {
    return (
      <div className="flex flex-1 items-center justify-center text-caption-1-regular text-text-tertiary">
        Adicione um bot à sala para ver o navegador dele.
      </div>
    );
  }

  const bot = bots.find((item) => item.id === agentId);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-separator-border px-3">
        <KitSelect raw
          className="rounded-lg border border-border-button-default bg-background-primary-default px-2 py-1 text-caption-1-regular"
          value={agentId}
          onChange={(event) => setAgentId(event.target.value)}
        >
          {bots.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </KitSelect>
        <p className="min-w-0 flex-1 truncate text-caption-2-regular text-text-tertiary">
          {bot ? `o navegador privado de ${bot.name}` : ""}
          {takeover ? " · controle humano" : ""}
        </p>
        <KitButton variant="raw"
          className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-caption-1-medium ${
            takeover ? "bg-accent-500 text-white" : "text-text-secondary hover:bg-background-tertiary-default"
          }`}
          onClick={() => void toggleTakeover()}
          title="Quando você assume, as ferramentas do bot param de agir"
        >
          <UserRound size={14} /> {takeover ? "devolver" : "assumir"}
        </KitButton>
      </header>
      <div className="min-h-0 flex-1">
        <DebugBrowserPanel projectId={project.id} agentId={agentId} />
      </div>
    </div>
  );
}
