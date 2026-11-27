import { useEffect, useRef } from "react";
import type { Project } from "../../shared/api";
import { latestChatForJeff, useChats } from "../conversations/store";
import { useApp } from "../../app/store";
import BotStudioTab from "../conversations/components/BotStudioTab";
import { PixelSpinner } from "@jeff/ui";
import BrandGlyph from "../../shared/ui/BrandGlyph";

interface Props {
  project: Project;
  ready: boolean;
  initialChatId?: string | null;
  initialBotId?: string | null;
}

/** The center of the Sessões tab: the selected private conversation. */
export default function SessionsChat({ project, ready, initialChatId, initialBotId }: Props) {
  const chats = useChats((state) => state.byProject[project.id]);
  const activeChatId = chats?.activeChatId ?? null;
  const openedTarget = useRef<string | null>(null);

  useEffect(() => {
    if (!ready || !chats?.hydrated) return;
    const key = `${initialChatId ?? ""}:${initialBotId ?? ""}`;
    if (key === ":" || openedTarget.current === key) return;
    const target = initialChatId
      ?? (initialBotId ? latestChatForJeff(chats, initialBotId)?.id : undefined);
    if (!target) return;
    openedTarget.current = key;
    useApp.getState().markChatNotificationsRead(target);
    useChats.getState().setActiveChat(project.id, target);
    useChats.getState().touchConversation(project.id, target);
  }, [chats, initialBotId, initialChatId, project.id, ready]);

  if (!ready) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-caption-1-regular text-text-tertiary">
        <PixelSpinner size={16} /> Carregando sessões…
      </div>
    );
  }

  if (!activeChatId) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
        <span className="flex size-11 items-center justify-center rounded-2xl bg-background-secondary-default text-accent-500">
          <BrandGlyph size={24} />
        </span>
        <strong className="text-title-3-medium text-text-primary">Sessões privadas</strong>
        <p className="max-w-sm text-caption-1-regular text-text-secondary">
          Escolha uma sessão na barra à direita ou comece uma nova tarefa com o agente do repo.
        </p>
      </div>
    );
  }

  return <BotStudioTab key={activeChatId} project={project} conversationId={activeChatId} embedded />;
}
