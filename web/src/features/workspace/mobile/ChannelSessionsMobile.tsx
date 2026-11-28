import { useEffect, useRef, useState, type ReactNode } from "react";
import { MessageSquarePlus } from "@jeff/icons";
import { Icon } from "faang-ui";
import { api, type Project } from "../../../shared/api";
import type { ChannelCategory } from "../../rooms/api";
import { useApp } from "../../../app/store";
import { latestChatForJeff, useChats } from "../../conversations/store";
import { CategoryGlyph } from "../WorkspaceGlyph";
import { ensureJeff } from "../../agents/default-jeff";
import SessionsScreen from "../../../app/layouts/mobile/screens/SessionsScreen";
import MobileScreenHeader from "../../../app/layouts/mobile/components/MobileScreenHeader";
import MobileIconButton from "../../../app/layouts/mobile/components/MobileIconButton";
import BotStudioTab from "../../conversations/components/BotStudioTab";
import BrandGlyph from "../../../shared/ui/BrandGlyph";
import { MobileEmpty } from "./mobile-ui";

interface Props {
  project: Project;
  category?: ChannelCategory | null;
  initialChatId?: string | null;
  initialBotId?: string | null;
  onBack: () => void;
  onBackRef: { current: (() => boolean) | null };
  viewTabs?: ReactNode;
}

/** The private sessions half of Mensagens, inside the channel. */
export default function ChannelSessionsMobile({
  project,
  category,
  initialChatId,
  initialBotId,
  onBack,
  onBackRef,
  viewTabs,
}: Props) {
  const chats = useChats((state) => state.byProject[project.id]);
  const [filter, setFilter] = useState("");
  const [chatId, setChatId] = useState<string | null>(null);
  const [branch, setBranch] = useState("");
  const openedTarget = useRef<string | null>(null);

  useEffect(() => {
    api.gitBranches(project.id)
      .then((info) => setBranch(info.current))
      .catch(() => setBranch(""));
  }, [project.id]);

  useEffect(() => {
    if (!chats?.hydrated) return;
    const key = `${initialChatId ?? ""}:${initialBotId ?? ""}`;
    if (key === ":" || openedTarget.current === key) return;
    const target = initialChatId
      ?? (initialBotId ? latestChatForJeff(chats, initialBotId)?.id : undefined);
    if (!target) return;
    openedTarget.current = key;
    openChat(target);
  }, [chats, initialBotId, initialChatId]);

  useEffect(() => {
    useApp.getState().setMobileScreen(chatId ? "bots" : "more");
  }, [chatId]);

  useEffect(() => () => {
    useApp.getState().setMobileScreen("more");
  }, []);

  useEffect(() => {
    onBackRef.current = () => {
      if (!chatId) return false;
      setChatId(null);
      return true;
    };
    return () => { onBackRef.current = null; };
  }, [chatId, onBackRef]);

  function openChat(id: string) {
    useApp.getState().markChatNotificationsRead(id);
    useChats.getState().setActiveChat(project.id, id);
    useChats.getState().touchConversation(project.id, id);
    setChatId(id);
  }

  function newTask() {
    const jeff = ensureJeff(project.id);
    if (!jeff) return;
    const created = useChats.getState().createConversation(project.id, [jeff.id]);
    if (created) openChat(created.id);
  }

  if (chatId) {
    const chat = chats?.chats.find((item) => item.id === chatId) ?? null;
    return (
      <div className="m-screen">
        <MobileScreenHeader
          onBack={() => setChatId(null)}
          backLabel="Voltar às sessões"
          lead={<span className="m-devface"><BrandGlyph size={22} /></span>}
          title={chat?.name?.trim() || "Nova tarefa"}
          subtitle={`${project.name} · ${branch || "repo"}`}
          actions={<MobileIconButton icon={MessageSquarePlus} label="Nova tarefa" onClick={newTask} />}
        />
        {chatId ? (
          <BotStudioTab
            key={chatId}
            project={project}
            conversationId={chatId}
            mobile
          />
        ) : (
          <MobileEmpty title="Nenhuma sessão aberta">Escolha uma tarefa na lista.</MobileEmpty>
        )}
      </div>
    );
  }

  return (
    <div className="m-screen">
      <MobileScreenHeader
        icon={
          <span className="m-chathead__icons">
            {category?.icon ? <CategoryGlyph category={category} size={14} /> : null}
            {category?.icon ? <Icon name="chevronRight" size={14} className="m-chathead__chevron" /> : null}
            <Icon name="channel" size={18} />
          </span>
        }
        title="Sessões"
        subtitle={project.name}
        onBack={onBack}
        backLabel="Voltar ao canal"
        actions={<MobileIconButton icon={MessageSquarePlus} label="Nova tarefa" onClick={newTask} />}
      >
        {viewTabs}
      </MobileScreenHeader>
      <SessionsScreen
        project={project}
        filter={filter}
        onFilter={setFilter}
        onOpenChat={openChat}
      />
    </div>
  );
}
