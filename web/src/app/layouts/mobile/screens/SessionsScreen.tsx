import { useEffect, useMemo, useState } from "react";
import { MessageSquarePlus, Search } from "@jeff/icons";
import type { Project } from "../../../../shared/api";
import { useApp } from "../../../store";
import { useChats } from "../../../../features/conversations/store";
import { projectSessions } from "../../../../features/conversations/sessions";
import { agentApi, type HarnessSession } from "../../../../features/agents/api";
import { ensureChatSubjects } from "../../../../features/conversations/subjects";
import { ensureJeff } from "../../../../features/agents/default-jeff";
import { useActiveSessionIds } from "../../../../features/agents/useActiveSessionIds";
import { PixelSpinner } from "@jeff/ui";
import { sessionMessages, sessionWhen } from "../../../../features/conversations/sessions";
import BrandGlyph from "../../../../shared/ui/BrandGlyph";
import BotAvatar from "../../../../features/agents/components/BotAvatar";
import { MobileEmpty } from "../../../../features/workspace/mobile/mobile-ui";

interface Props {
  project: Project;
  onOpenChat: (chatId: string) => void;
  filter: string;
  onFilter: (value: string) => void;
}

/** Jeff: the project's tasks, newest first, as the phone's message list. */
export default function SessionsScreen({ project, onOpenChat, filter, onFilter }: Props) {
  const chats = useChats((state) => state.byProject[project.id]);
  const ensure = useChats((state) => state.ensure);
  const createConversation = useChats((state) => state.createConversation);
  const notifications = useApp((state) => state.notifications);
  const activeSessions = useActiveSessionIds(project.id);
  const [harness, setHarness] = useState<HarnessSession[] | null>(null);
  const sessionCount = chats?.chats.length ?? 0;

  useEffect(() => {
    ensure(project.id);
  }, [ensure, project.id]);

  useEffect(() => {
    if (chats?.hydrated) void ensureChatSubjects(project.id, chats.chats);
  }, [chats?.hydrated, chats?.chats, project.id]);

  useEffect(() => {
    let cancelled = false;
    void agentApi
      .harnessSessions(project.id)
      .then((items) => {
        if (!cancelled) setHarness(items);
      })
      .catch(() => {
        if (!cancelled) setHarness(null);
      });
    return () => {
      cancelled = true;
    };
  }, [project.id, sessionCount, activeSessions]);

  const allSessions = useMemo(
    () => projectSessions(chats, notifications, project.id, activeSessions),
    [activeSessions, chats, notifications, project.id],
  );

  const sessions = useMemo(() => {
    if (!harness || harness.length === 0) return allSessions;
    const byChat = new Map(allSessions.map((session) => [session.chat.id, session]));
    return harness.flatMap((item) => {
      const base = byChat.get(item.chatId);
      if (!base) return [];
      return [{
        ...base,
        title: item.title || base.title,
        activityAt: item.updatedAt || base.activityAt,
      }];
    });
  }, [allSessions, harness]);

  const needle = filter.trim().toLowerCase();
  const visible = needle
    ? sessions.filter((session) => session.title.toLowerCase().includes(needle))
    : sessions;

  function newTask() {
    const jeff = ensureJeff(project.id);
    if (!jeff) return;
    const created = createConversation(project.id, [jeff.id]);
    if (created) onOpenChat(created.id);
  }

  return (
    <div className="m-dev-sessions">
      <div className="m-searchline">
        <Search className="m-searchline__icon" />
        <input
          value={filter}
          onChange={(event) => onFilter(event.target.value)}
          placeholder="Buscar tarefas"
          aria-label="Buscar tarefas"
          inputMode="search"
        />
        {filter ? (
          <button type="button" className="m-searchline__clear" onClick={() => onFilter("")} aria-label="Limpar busca">
            <span aria-hidden="true">×</span>
          </button>
        ) : null}
      </div>
      <button type="button" className="m-wideaction m-wideaction--new" disabled={!chats?.hydrated} onClick={newTask}>
        <MessageSquarePlus className="m-wideaction__icon" />
        Nova tarefa
      </button>
      <div className="m-scroll">
        {!chats?.hydrated ? (
          <div className="m-sessions-loading">
            <PixelSpinner size={14} />
            Carregando tarefas…
          </div>
        ) : null}
        {chats?.hydrated && visible.length === 0 ? (
          <MobileEmpty
            icon={<BotAvatar bot={{ name: "Jeff", color: "", avatar: "jeff-logo" }} size={48} />}
            title={needle ? "Nenhuma tarefa encontrada" : "Nenhuma tarefa ainda"}
            action={
              <button type="button" className="m-wideaction m-wideaction--empty" onClick={newTask}>
                <MessageSquarePlus className="m-wideaction__icon" />
                Começar a primeira tarefa
              </button>
            }
          >
            {needle ? "Tente outro termo." : "Cada tarefa tem o próprio histórico neste repo."}
          </MobileEmpty>
        ) : null}
        {visible.length > 0 ? (
          <ul className="m-dev-sessionlist" aria-label="Tarefas">
            {visible.map((session) => (
              <li key={session.chat.id}>
                <button
                  type="button"
                  className="m-devrow m-devrow--session"
                  data-active={session.chat.id === chats?.activeChatId || undefined}
                  onClick={() => onOpenChat(session.chat.id)}
                  aria-current={session.chat.id === chats?.activeChatId ? "true" : undefined}
                >
                  <span className="m-devrow__icon m-devrow__icon--agent">
                    <BrandGlyph size={16} />
                  </span>
                  <span className="m-devrow__copy">
                    <span className="m-devrow__copy-line">
                      <strong>{session.title}</strong>
                      {session.running ? <PixelSpinner size={14} /> : null}
                    </span>
                    <small>{sessionMessages(session.messageCount)} · {sessionWhen(session.activityAt)}</small>
                  </span>
                  {session.unread ? <span className="m-devrow__dirty" aria-label="Não lida" /> : null}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="m-scroll__end" />
      </div>
    </div>
  );
}
