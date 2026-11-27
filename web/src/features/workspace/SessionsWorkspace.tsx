import { useEffect, useRef, useState } from "react";
import { api, type Project, type WorkspaceLayout } from "../../shared/api";
import type { ProjectChats } from "../conversations/store";
import { latestChatForJeff, useChats } from "../conversations/store";
import { useWorkspacePersistence } from "../projects/hooks/useWorkspacePersistence";
import { useApp } from "../../app/store";
import BotsSidebar from "../agents/components/BotsSidebar";
import BotStudioTab from "../conversations/components/BotStudioTab";
import { PixelSpinner } from "@jeff/ui";
import BrandGlyph from "../../shared/ui/BrandGlyph";

interface Props {
  project: Project;
  initialChatId?: string | null;
  initialBotId?: string | null;
}

/**
 * The private sessions half of Mensagens. It shares the repo's project and
 * keeps the channel's tab layout intact while the user talks to an agent.
 */
export default function SessionsWorkspace({ project, initialChatId, initialBotId }: Props) {
  const [layout, setLayout] = useState<WorkspaceLayout | null>(null);
  const [ready, setReady] = useState(false);
  const [epoch, setEpoch] = useState(0);
  const activeChatId = useChats((state) => state.byProject[project.id]?.activeChatId ?? null);
  const chats = useChats((state) => state.byProject[project.id]);
  const openedTarget = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setReady(false);
    setLayout(null);
    useChats.getState().unload(project.id);
    void api.layout(project.id)
      .then((saved) => {
        if (cancelled) return;
        setLayout({
          tabs: saved.tabs ?? [],
          activeTabId: saved.activeTabId ?? null,
          sidebar: saved.sidebar,
          terminalOpen: saved.terminalOpen,
        });
        useChats.getState().load(project.id, saved.chats as ProjectChats | null | undefined);
        setReady(true);
        setEpoch((value) => value + 1);
      })
      .catch(() => {
        if (cancelled) return;
        useChats.getState().load(project.id, null);
        setReady(true);
        setEpoch((value) => value + 1);
      });
    return () => { cancelled = true; };
  }, [project.id]);

  useEffect(() => {
    if (!ready || !chats?.hydrated) return;
    const key = `${initialChatId ?? ""}:${initialBotId ?? ""}`;
    if (key === ":" || openedTarget.current === key) return;
    const chatId = initialChatId
      ?? (initialBotId ? latestChatForJeff(chats, initialBotId)?.id : undefined);
    if (!chatId) return;
    openedTarget.current = key;
    useApp.getState().markChatNotificationsRead(chatId);
    useChats.getState().setActiveChat(project.id, chatId);
    useChats.getState().touchConversation(project.id, chatId);
  }, [chats, initialBotId, initialChatId, project.id, ready]);

  useWorkspacePersistence(project.id, ready && layout !== null, {
    tabs: layout?.tabs ?? [],
    activeTabId: layout?.activeTabId ?? null,
    sidebar: layout?.sidebar,
    terminalOpen: layout?.terminalOpen,
  }, epoch);

  if (!ready) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-caption-1-regular text-text-tertiary">
        <PixelSpinner size={16} /> Carregando sessões…
      </div>
    );
  }

  return (
    <div className="ws-sessions">
      <aside className="ws-sessions-list">
        <BotsSidebar project={project} onOpenChat={() => undefined} title="Sessões" />
      </aside>
      <section className="ws-sessions-chat">
        {activeChatId ? (
          <BotStudioTab key={activeChatId} project={project} conversationId={activeChatId} embedded />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
            <span className="flex size-11 items-center justify-center rounded-2xl bg-background-secondary-default text-accent-500">
              <BrandGlyph size={24} />
            </span>
            <strong className="text-title-3-medium text-text-primary">Sessões privadas</strong>
            <p className="max-w-sm text-caption-1-regular text-text-secondary">
              Escolha uma sessão ao lado ou comece uma nova tarefa com o agente do repo.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
