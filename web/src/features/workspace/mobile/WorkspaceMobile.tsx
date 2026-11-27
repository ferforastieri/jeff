import { useEffect, useRef, useState, type ReactNode } from "react";
import { useApp } from "../../../app/store";
import {
  Bell,
  BookOpen,
  Braces,
  HardDrive,
  Home,
  MessageSquare,
  PlugZap,
  Rows3,
  Search,
  Settings2,
  Sparkles,
  TerminalSquare,
  Timer,
  UserRound,
  Users,
} from "@jeff/icons";
import { api, type AIModel, type OnboardingStatus, type Project, type User } from "../../../shared/api";
import type { AppNotification, Tab } from "../../../app/store";
import { channelsApi, type ChannelCategory, type Principal, type Room, type RoomMessage } from "../../rooms/api";
import type { Section } from "../../settings/components/JeffSettings";
import { SettingsView } from "../../settings/components/JeffSettings";
import { MEMBER_STATUS_LABEL, type MemberStatus } from "../../../shared/ui/presence";
import { Icon, Menu, MenuItem, MenuRadioGroup, type IconName } from "faang-ui";
import { usePrefs } from "../../../shared/prefs";
import MobileScreenHeader from "../../../app/layouts/mobile/components/MobileScreenHeader";
import MobileIconButton from "../../../app/layouts/mobile/components/MobileIconButton";
import MobileDrawer, { type MobileDrawerRow, type MobileDrawerSection } from "../../../app/layouts/mobile/components/MobileDrawer";
import { useMobileBack } from "../../../app/layouts/mobile/useMobileBack";
import { useChats, type ProjectChats } from "../../conversations/store";
import { useAgentActivityBridge } from "../../agents/activity";
import { restoredLayoutTabs } from "../../projects/layout";
import { useLayoutTabs, useWorkspacePersistence } from "../../projects/hooks/useWorkspacePersistence";
import { featureEnabled, useSettings, type WorkspaceFeature } from "../../settings/store";
import { faceOf } from "../face";
import HomeDashboard from "../HomeDashboard";
import Board from "../../rooms/Board";
import CalendarPanel from "../CalendarPanel";
import DrivePanel from "../DrivePanel";
import WikiPanel from "../WikiPanel";
import WorkspaceSearch from "../WorkspaceSearch";
import ConversasScreen, { type MobileTeamMember } from "./ConversasScreen";
import ChatScreen from "./ChatScreen";
import WorkHub from "./WorkHub";
import AlertsScreen from "./AlertsScreen";
import YouScreen from "./YouScreen";
import ChannelDevMobile from "./ChannelDevMobile";
import ChannelSessionsMobile from "./ChannelSessionsMobile";
import { CHANNEL_DEV_TOOLS, type ChannelDevTool } from "../channelDev";
import { MobileEmpty, MobileWorkspaceButton } from "./mobile-ui";

export type MobileTab = "home" | "conversas" | "trabalho" | "alertas" | "voce";
type MobilePane = "root" | "chat" | "tasks" | "calendar" | "drive" | "wiki" | "settings" | "search";

interface Props {
  status: OnboardingStatus;
  teamName: string;
  workspaceLogo: string;
  memberCount: number;
  bots: Principal[];
  me: Principal | null;
  rooms: Room[];
  categories: ChannelCategory[];
  teamMembers: MobileTeamMember[];
  user: User | null;
  userName: string;
  userFace: ReactNode;
  userStatus: MemberStatus;
  isAdmin: boolean;
  unread: number;
  roomUnread: number;
  unreadRoomIds: Set<string>;
  activeAgents: number;
  selectedRoomId: string;
  selectedRoom: Room | null;
  agent: Principal | null;
  messages: RoomMessage[];
  people: Map<string, Principal>;
  roomTitle: string;
  roomSubtitle: string;
  draft: string;
  models: AIModel[];
  boardProject: Project;
  driveProject: Project;
  welcome: ReactNode;
  onSelectRoom: (room: Room) => void;
  onOpenAgent: (agent: Principal) => Promise<void> | void;
  onEditPerson: (user: User) => void;
  onEditAgent: (agent: Principal) => void;
  onCreateChannel: (categoryId?: string | null) => void;
  onCreateCategory: () => void;
  onRenameCategory: (category: ChannelCategory) => void;
  onDeleteCategory: (category: ChannelCategory) => void;
  onEditChannel: (room: Room) => void;
  onDeleteChannel: (room: Room) => void;
  onOpenChannelAgents: () => void;
  onOpenChannelRepos: () => void;
  onDraft: (value: string) => void;
  onSend: (text: string) => void;
  onConnectAI: () => void;
  onAgentUpdated: (agent: Principal) => void;
  onOpenNotification: (notification: AppNotification) => void;
  onView: (view: "home" | "chat" | "tasks" | "calendar" | "drive" | "wiki" | "settings") => void;
  onInvite: () => void;
}

const SEARCH_VIEWS: { id: string; label: string; icon: IconName }[] = [
  { id: "home", label: "Início", icon: "home" },
  { id: "tasks", label: "Tarefas", icon: "checks" },
  { id: "calendar", label: "Calendário", icon: "calendar" },
  { id: "drive", label: "Drive", icon: "drive" },
  { id: "wiki", label: "Wiki", icon: "book" },
];

const SECTION_LABEL: Record<Section, string> = {
  general: "Geral",
  skills: "Skills",
  connectors: "Conectores e MCP",
  harness: "Harness",
  workspace: "Workspace",
};

/** The phone's whole workspace: Discord's channel list and chat, plus the tools as real screens. */
export default function WorkspaceMobile(props: Props) {
  const {
    status,
    teamName,
    workspaceLogo,
    memberCount,
    bots,
    me,
    rooms,
    categories,
    teamMembers,
    user,
    userName,
    userFace,
    userStatus,
    isAdmin,
    unread,
    roomUnread,
    unreadRoomIds,
    activeAgents,
    selectedRoomId,
    selectedRoom,
    agent,
    messages,
    people,
    roomTitle,
    roomSubtitle,
    draft,
    models,
    boardProject,
    driveProject,
    welcome,
    onSelectRoom,
    onOpenAgent,
    onEditPerson,
    onEditAgent,
    onCreateChannel,
    onCreateCategory,
    onRenameCategory,
    onDeleteCategory,
    onEditChannel,
    onDeleteChannel,
    onOpenChannelAgents,
    onOpenChannelRepos,
    onDraft,
    onSend,
    onConnectAI,
    onAgentUpdated,
    onOpenNotification,
    onView,
    onInvite,
  } = props;
  const [tab, setTab] = useState<MobileTab>("conversas");
  const [pane, setPane] = useState<MobilePane>("root");
  const [settingsSection, setSettingsSection] = useState<Section>("general");
  const [channelQuery, setChannelQuery] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [channelDevTool, setChannelDevTool] = useState<ChannelDevTool | null>(null);
  const [channelDevProjectId, setChannelDevProjectId] = useState<string | null>(null);
  const [channelDevRepoPath, setChannelDevRepoPath] = useState<string | null>(null);
  const [channelDevTarget, setChannelDevTarget] = useState<{ chatId?: string; botId?: string } | null>(null);
  const [messageMode, setMessageMode] = useState<"channel" | "sessions">("channel");
  const [channelDevBusy, setChannelDevBusy] = useState(false);
  const [projectLayout, setProjectLayout] = useState<{ sidebar?: string; terminalOpen?: boolean } | null>(null);
  const [layoutReady, setLayoutReady] = useState(false);
  const [layoutEpoch, setLayoutEpoch] = useState(0);
  const searchHost = useRef<HTMLDivElement>(null);
  const channelDevBack = useRef<(() => boolean) | null>(null);
  const channelSessionsBack = useRef<(() => boolean) | null>(null);
  const setStatus = usePrefs((state) => state.update);
  const projects = useApp((state) => state.projects);
  const openProjectIds = useApp((state) => state.openProjectIds);
  const tabs = useApp((state) => state.tabs);
  const activeTabId = useApp((state) => state.activeTabId);
  const layoutTabs = useLayoutTabs(tabs);
  const workspaceFeatures = useSettings((state) => state.workspaceFeatures);

  // The dev tools belong to the channel's repo; load that project's layout
  // (tabs and conversations) only when a channel dev tool is first opened.
  useEffect(() => {
    setLayoutReady(false);
    setProjectLayout(null);
    const projectId = channelDevProjectId;
    if (!projectId) return;
    let cancelled = false;
    useChats.getState().unload(projectId);
    useApp.getState().setTabs([]);
    void api.layout(projectId)
      .then((layout) => {
        if (cancelled) return;
        const features = useSettings.getState().workspaceFeatures;
        const enabled = (feature: WorkspaceFeature) => featureEnabled(features, feature);
        const restored = restoredLayoutTabs(layout.tabs, enabled);
        const restoredActive = typeof layout.activeTabId === "string" && restored.some((tab) => tab.id === layout.activeTabId)
          ? layout.activeTabId
          : null;
        useApp.getState().setTabs(restored.map((tab: Tab) => ({ ...tab, projectId })), restoredActive);
        useChats.getState().load(projectId, layout.chats as ProjectChats | null | undefined);
        setProjectLayout({
          sidebar: typeof layout.sidebar === "string" ? layout.sidebar : undefined,
          terminalOpen: typeof layout.terminalOpen === "boolean" ? layout.terminalOpen : undefined,
        });
        setLayoutReady(true);
        setLayoutEpoch((value) => value + 1);
      })
      .catch(() => {
        if (cancelled) return;
        useChats.getState().load(projectId, null);
        setLayoutReady(true);
        setLayoutEpoch((value) => value + 1);
      });
    return () => { cancelled = true; };
  }, [channelDevProjectId]);

  // The desktop workbench shares this layout; keep its sidebar and terminal
  // choices intact while the phone saves tabs and chats.
  useWorkspacePersistence(channelDevProjectId, layoutReady, {
    tabs: layoutTabs,
    activeTabId,
    sidebar: projectLayout?.sidebar,
    terminalOpen: projectLayout?.terminalOpen,
  }, layoutEpoch);

  useAgentActivityBridge(openProjectIds);

  useMobileBack(() => {
    if (drawerOpen) {
      setDrawerOpen(false);
      return true;
    }
    if (channelDevTool) {
      if (channelDevBack.current?.()) return true;
      setChannelDevTool(null);
      return true;
    }
    if (messageMode === "sessions") {
      if (channelSessionsBack.current?.()) return true;
      setMessageMode("channel");
      return true;
    }
    if (pane !== "root") {
      setPane("root");
      return true;
    }
    if (tab !== "conversas") {
      setTab("conversas");
      return true;
    }
    return false;
  });

  useEffect(() => {
    if (pane !== "search") return;
    const timer = window.setTimeout(() => {
      const input = searchHost.current?.querySelector<HTMLInputElement>("input");
      input?.focus();
    }, 80);
    return () => window.clearTimeout(timer);
  }, [pane]);

  function openDrawer() {
    setDrawerOpen(true);
  }

  function closeDrawer() {
    setDrawerOpen(false);
  }

  function selectTab(next: MobileTab) {
    setTab(next);
    setPane("root");
    setDrawerOpen(false);
    if (next === "home") onView("home");
  }

  function openRoom(room: Room) {
    onSelectRoom(room);
    setTab("conversas");
    setPane("chat");
    setDrawerOpen(false);
    resetChannelDev();
    setMessageMode("channel");
    if (room.kind === "room" && room.repos.length > 0) setChannelDevRepoPath(room.repos[0]);
  }

  async function openAgent(bot: Principal) {
    await onOpenAgent(bot);
    setTab("conversas");
    setPane("chat");
    setDrawerOpen(false);
  }

  function openSettings(section: Section) {
    setSettingsSection(section);
    setPane("settings");
    setDrawerOpen(false);
  }

  function openTool(view: "tasks" | "calendar" | "drive" | "wiki") {
    onView(view);
    setPane(view);
    setDrawerOpen(false);
  }

  function resetChannelDev() {
    setChannelDevTool(null);
    setChannelDevProjectId(null);
    setChannelDevRepoPath(null);
    setChannelDevTarget(null);
  }

  /** Resolves the channel's repo into a project and opens one of its tools. */
  async function resolveChannelProject(room: Room, repoPath?: string): Promise<string> {
    const repo = repoPath && room.repos.includes(repoPath)
      ? repoPath
      : channelDevRepoPath && room.repos.includes(channelDevRepoPath)
        ? channelDevRepoPath
        : room.repos[0];
    let project = useApp.getState().projects.find((item) => item.root === repo);
    if (!project) {
      const result = await channelsApi.devProject(room.id, repo);
      project = result.project;
      const app = useApp.getState();
      const exists = app.projects.some((item) => item.id === result.project.id);
      app.setProjects(exists ? app.projects : [...app.projects, result.project]);
    }
    const app = useApp.getState();
    app.setActiveProject(project.id);
    setChannelDevRepoPath(repo);
    setChannelDevProjectId(project.id);
    return project.id;
  }

  async function openChannelDev(
    tool: ChannelDevTool,
    room: Room | null = selectedRoom,
    repoPath?: string,
  ) {
    if (!status.devMode || !room || room.kind !== "room" || room.repos.length === 0) return;
    setChannelDevBusy(true);
    try {
      await resolveChannelProject(room, repoPath);
      if (tool !== "terminal") useApp.getState().setSidebar(tool);
      setChannelDevTarget(null);
      setMessageMode("channel");
      setChannelDevTool(tool);
      setPane("chat");
      setDrawerOpen(false);
    } catch (cause) {
      useApp.getState().notify(
        "error",
        cause instanceof Error ? cause.message : "Não foi possível abrir o projeto do canal.",
      );
    } finally {
      setChannelDevBusy(false);
    }
  }

  /** Private sessions are part of Mensagens and only for dev people. */
  async function openChannelSessions(
    room: Room | null = selectedRoom,
    repoPath?: string,
    target: { chatId?: string; botId?: string } | null = null,
  ) {
    if (!status.devMode || !room || room.kind !== "room" || room.repos.length === 0) return;
    setChannelDevBusy(true);
    try {
      await resolveChannelProject(room, repoPath);
      setChannelDevTool(null);
      setChannelDevTarget(target);
      setMessageMode("sessions");
      setPane("chat");
      setDrawerOpen(false);
    } catch (cause) {
      useApp.getState().notify(
        "error",
        cause instanceof Error ? cause.message : "Não foi possível abrir as sessões do canal.",
      );
    } finally {
      setChannelDevBusy(false);
    }
  }

  // A native push opened the app: land on the room, or on the exact dev chat.
  useEffect(() => {
    const open = (event: Event) => {
      const detail = (event as CustomEvent<{
        projectId?: string;
        chatId?: string;
        botId?: string;
        roomId?: string;
      }>).detail;
      if (!detail) return;
      if (detail.roomId) {
        const room = rooms.find((item) => item.id === detail.roomId);
        if (room) {
          openRoom(room);
          return;
        }
      }
      if (detail.projectId && (detail.chatId || detail.botId)) {
        void (async () => {
          const projects = await api.projects().catch(() => []);
          const project = projects.find((item) => item.id === detail.projectId);
          if (!project) return;
          const target = rooms.find((item) => item.kind === "room" && item.repos.includes(project.root));
          if (!target) return;
          openRoom(target);
          await openChannelSessions(target, project.root, { chatId: detail.chatId, botId: detail.botId });
        })();
      }
    };
    window.addEventListener("jeff:mobile-notification", open);
    return () => window.removeEventListener("jeff:mobile-notification", open);
  }, [rooms]);

  function drawerRow(
    id: string,
    label: string,
    icon: ReactNode,
    onSelect: () => void,
    options: Partial<Pick<MobileDrawerRow, "hint" | "badge" | "active" | "danger">> = {},
  ): MobileDrawerRow {
    return { id, label, icon, onSelect, ...options };
  }

  const drawerSections: MobileDrawerSection[] = [
    {
      id: "nav",
      rows: [
        drawerRow("home", "Início", <Home className="m-drawer__glyph" />, () => selectTab("home"), { active: pane === "root" && tab === "home" }),
        drawerRow("conversas", "Conversas", <MessageSquare className="m-drawer__glyph" />, () => selectTab("conversas"), { active: (pane === "root" || pane === "chat") && tab === "conversas", badge: roomUnread }),
        drawerRow("trabalho", "Trabalho", <Braces className="m-drawer__glyph" />, () => selectTab("trabalho"), { active: pane === "root" && tab === "trabalho" }),
        drawerRow("alertas", "Alertas", <Bell className="m-drawer__glyph" />, () => selectTab("alertas"), { active: pane === "root" && tab === "alertas", badge: unread }),
      ],
    },
    {
      id: "tools",
      label: "Ferramentas",
      rows: [
        drawerRow("tasks", "Tarefas", <Rows3 className="m-drawer__glyph" />, () => openTool("tasks"), { active: pane === "tasks" }),
        drawerRow("calendar", "Calendário", <Timer className="m-drawer__glyph" />, () => openTool("calendar"), { active: pane === "calendar" }),
        drawerRow("drive", "Drive", <HardDrive className="m-drawer__glyph" />, () => openTool("drive"), { active: pane === "drive" }),
        drawerRow("wiki", "Wiki", <BookOpen className="m-drawer__glyph" />, () => openTool("wiki"), { active: pane === "wiki" }),
      ],
    },
    {
      id: "settings",
      label: "Ajustes",
      rows: [
        drawerRow("general", "Configurações", <Settings2 className="m-drawer__glyph" />, () => openSettings("general"), { hint: "Conta, servidor e modelos", active: pane === "settings" }),
        drawerRow("you", "Você e conta", <UserRound className="m-drawer__glyph" />, () => selectTab("voce"), { hint: "Perfil, tema e sessão", active: pane === "root" && tab === "voce" }),
        drawerRow("connectors", "Conectores e MCP", <PlugZap className="m-drawer__glyph" />, () => openSettings("connectors")),
        drawerRow("skills", "Skills", <Sparkles className="m-drawer__glyph" />, () => openSettings("skills")),
        drawerRow("harness", "Harness", <TerminalSquare className="m-drawer__glyph" />, () => openSettings("harness")),
        drawerRow("workspace", "Configurações do workspace", <HardDrive className="m-drawer__glyph" />, () => openSettings("workspace")),
        ...(isAdmin
          ? [drawerRow("invite", "Convidar pessoas", <Users className="m-drawer__glyph" />, () => { closeDrawer(); onInvite(); })]
          : []),
      ],
    },
  ];

  function rootScreen() {
    if (tab === "home") {
      return (
        <div className="m-screen m-screen--home">
          <MobileScreenHeader
            variant="workspace"
            lead={
              <MobileWorkspaceButton
                logo={workspaceLogo}
                name={teamName}
                meta={`${memberCount} ${memberCount === 1 ? "membro" : "membros"}`}
                onClick={openDrawer}
                compact
              />
            }
            actions={
              <>
                <MobileIconButton icon={Search} label="Buscar" onClick={() => setPane("search")} />
                <MobileIconButton icon={Bell} label="Alertas" badge={unread} onClick={() => setTab("alertas")} />
              </>
            }
          />
          <div className="m-scroll m-scroll--dash">
            <HomeDashboard
              project={boardProject}
              rooms={rooms}
              bots={bots}
              me={me}
              userName={userName}
              activeAgents={activeAgents}
              onOpenAgent={(bot) => void openAgent(bot)}
              onInviteUser={onInvite}
              onOpenCalendar={() => openTool("calendar")}
            />
            <div className="m-scroll__end" />
          </div>
        </div>
      );
    }
    if (tab === "trabalho") {
      return (
        <WorkHub
          workspaceName={teamName}
          onOpenView={openTool}
          onOpenSearch={() => setPane("search")}
          onMenu={openDrawer}
        />
      );
    }
    if (tab === "alertas") {
      return (
        <AlertsScreen
          onMenu={openDrawer}
          onOpen={(notification) => onOpenNotification(notification)}
        />
      );
    }
    if (tab === "voce") {
      return (
        <YouScreen
          user={user}
          userName={userName}
          userFace={userFace}
          userStatus={userStatus}
          workspaceName={teamName}
          workspaceLogo={workspaceLogo}
          memberCount={memberCount}
          agentCount={bots.length}
          projectRoot={status.workspaceRoot}
          onOpenSettings={openSettings}
          onMenu={openDrawer}
        />
      );
    }
    return (
      <ConversasScreen
        teamName={teamName}
        workspaceLogo={workspaceLogo}
        memberCount={memberCount}
        onOpenDrawer={openDrawer}
        bots={bots}
        me={me}
        rooms={rooms}
        categories={categories}
        teamMembers={teamMembers}
        unread={unread}
        unreadRoomIds={unreadRoomIds}
        userName={userName}
        userFace={userFace}
        userStatus={userStatus}
        renderFace={faceOf}
        isAdmin={isAdmin}
        selectedRoomId={selectedRoomId}
        searchQuery={channelQuery}
        onSearchQuery={setChannelQuery}
        onSelectRoom={openRoom}
        onOpenAgent={(bot) => void openAgent(bot)}
        onEditPerson={onEditPerson}
        onEditAgent={onEditAgent}
        onCreateChannel={onCreateChannel}
        onCreateCategory={onCreateCategory}
        onRenameCategory={onRenameCategory}
        onDeleteCategory={onDeleteCategory}
        onEditChannel={onEditChannel}
        onDeleteChannel={onDeleteChannel}
        onOpenSearch={() => setPane("search")}
        onOpenNotifications={() => setTab("alertas")}
      />
    );
  }

  function channelDevBar() {
    if (selectedRoom?.kind !== "room" || !status.devMode || selectedRoom.repos.length === 0) return null;
    const repo = channelDevRepoPath || selectedRoom.repos[0];
    return (
      <div className="m-devbar" role="toolbar" aria-label="Ferramentas do canal">
        {selectedRoom.repos.length === 1 ? (
          <span className="m-devbar__repo" title={repo}>
            <Icon name="repo" size={16} />
            {repo.split("/").pop() || repo}
          </span>
        ) : (
          <Menu
            align="start"
            label="Repositório do canal"
            trigger={
              <button type="button" className="m-devbar__tab m-devbar__repo" disabled={channelDevBusy}>
                <Icon name="repo" size={16} />
                {repo.split("/").pop()}
                <Icon name="chevronDown" size={14} />
              </button>
            }
          >
            {selectedRoom.repos.map((path) => (
              <MenuItem
                key={path}
                icon={repo === path ? "check" : "repo"}
                onSelect={() => {
                  if (repo === path) return;
                  setChannelDevRepoPath(path);
                  setChannelDevProjectId(null);
                  if (channelDevTool) void openChannelDev(channelDevTool, selectedRoom, path);
                  else if (messageMode === "sessions") void openChannelSessions(selectedRoom, path);
                }}
              >
                {path.split("/").pop() || path}
              </MenuItem>
            ))}
          </Menu>
        )}
        {CHANNEL_DEV_TOOLS
          .filter((tool) => !tool.feature || featureEnabled(workspaceFeatures, tool.feature))
          .map((tool) => (
            <button
              key={tool.id}
              type="button"
              role="tab"
              className="m-devbar__tab"
              disabled={channelDevBusy}
              onClick={() => void openChannelDev(tool.id)}
            >
              <Icon name={tool.icon} size={16} />
              {tool.label}
            </button>
          ))}
        {channelDevBusy ? <span className="m-devbar__busy">Abrindo…</span> : null}
      </div>
    );
  }

  function messageTabs() {
    if (selectedRoom?.kind !== "room" || !status.devMode || selectedRoom.repos.length === 0) return null;
    return (
      <div className="m-message-tabs" role="tablist" aria-label="Mensagens do canal">
        <button type="button" role="tab" aria-selected className="m-message-tab is-active">
          Canal
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={false}
          className="m-message-tab"
          disabled={channelDevBusy}
          onClick={() => void openChannelSessions()}
        >
          Sessões
        </button>
      </div>
    );
  }

  function pushedScreen() {
    if (channelDevTool) {
      const project = projects.find((item) => item.id === channelDevProjectId);
      if (!project) {
        return (
          <div className="m-screen">
            <MobileScreenHeader title="Dev" onBack={() => setChannelDevTool(null)} backLabel="Voltar ao canal" />
            <MobileEmpty title="Repositório indisponível">O canal não tem um projeto acessível.</MobileEmpty>
          </div>
        );
      }
      if (!layoutReady) {
        return (
          <div className="m-screen">
            <MobileScreenHeader title="Abrindo…" onBack={() => setChannelDevTool(null)} backLabel="Voltar ao canal" />
            <MobileEmpty title="Carregando o projeto">Buscando abas e sessões do repositório.</MobileEmpty>
          </div>
        );
      }
      return (
        <ChannelDevMobile
          project={project}
          tool={channelDevTool}
          onBack={() => setChannelDevTool(null)}
          onBackRef={channelDevBack}
          onSelectTool={(next) => void openChannelDev(next)}
          busy={channelDevBusy}
        />
      );
    }
    if (pane === "chat") {
      if (!selectedRoom) {
        return (
          <div className="m-screen">
            <MobileScreenHeader title="Conversa" onBack={() => setPane("root")} />
            <MobileEmpty title="Nenhuma conversa aberta">Escolha um canal ou uma pessoa.</MobileEmpty>
          </div>
        );
      }
      if (messageMode === "sessions") {
        const project = projects.find((item) => item.id === channelDevProjectId);
        if (!project || !layoutReady) {
          return (
            <div className="m-screen">
              <MobileScreenHeader title="Sessões" onBack={() => setMessageMode("channel")} backLabel="Voltar ao canal" />
              <MobileEmpty title="Abrindo…">Carregando as sessões do repo.</MobileEmpty>
            </div>
          );
        }
        return (
          <ChannelSessionsMobile
            project={project}
            initialChatId={channelDevTarget?.chatId}
            initialBotId={channelDevTarget?.botId}
            onBack={() => setMessageMode("channel")}
            onBackRef={channelSessionsBack}
          />
        );
      }
      return (
        <ChatScreen
          room={selectedRoom}
          agent={agent}
          me={me}
          people={people}
          messages={messages}
          title={roomTitle}
          subtitle={roomSubtitle}
          draft={draft}
          models={models}
          welcome={welcome}
          onBack={() => setPane("root")}
          onDraft={onDraft}
          onSend={onSend}
          onConnectAI={onConnectAI}
          onAgentUpdated={onAgentUpdated}
          onOpenChannelAgents={onOpenChannelAgents}
          onOpenChannelRepos={onOpenChannelRepos}
          canManageRepos={isAdmin}
          onOpenAgent={(bot) => void openAgent(bot)}
          onOpenMember={onEditPerson}
          renderFace={faceOf}
          messageTabs={messageTabs()}
          devBar={channelDevBar()}
        />
      );
    }
    if (pane === "settings") {
      return (
        <div className="m-screen">
          <MobileScreenHeader
            title={SECTION_LABEL[settingsSection]}
            subtitle="Configurações"
            onBack={() => setPane("root")}
            backLabel="Voltar"
          />
          <div className="m-settingsects" role="tablist" aria-label="Seções de configurações">
            {(Object.keys(SECTION_LABEL) as Section[]).map((section) => (
              <button
                key={section}
                type="button"
                role="tab"
                aria-selected={settingsSection === section}
                className={settingsSection === section ? "is-active" : undefined}
                onClick={() => setSettingsSection(section)}
              >
                {SECTION_LABEL[section]}
              </button>
            ))}
          </div>
          <div className="m-pushed__body m-settingsbody">
            <SettingsView
              user={user}
              projectId={boardProject.id}
              section={settingsSection}
              onSection={setSettingsSection}
              embedded
              compact
            />
          </div>
        </div>
      );
    }
    if (pane === "search") {
      return (
        <div className="m-screen">
          <MobileScreenHeader title="Buscar" subtitle="Canais, mensagens, tarefas e pessoas" onBack={() => setPane("root")} backLabel="Fechar busca" />
          <div className="m-searchscreen" ref={searchHost}>
            <WorkspaceSearch
              projectId={boardProject.id}
              rooms={rooms}
              people={people.size ? [...people.values()] : []}
              bots={bots}
              me={me}
              views={SEARCH_VIEWS}
              onOpenRoom={(roomId) => {
                const room = rooms.find((item) => item.id === roomId);
                if (room) openRoom(room);
              }}
              onOpenAgent={(bot) => {
                void openAgent(bot);
              }}
              onOpenView={(view) => {
                setPane("root");
                if (view === "home") {
                  setTab("home");
                  onView("home");
                } else if (view === "tasks" || view === "calendar" || view === "drive" || view === "wiki") {
                  setTab("trabalho");
                  openTool(view);
                }
              }}
              onOpenCard={(roomId) => {
                const room = roomId ? rooms.find((item) => item.id === roomId) ?? null : selectedRoom;
                if (room) onSelectRoom(room);
                setTab("trabalho");
                setPane("tasks");
              }}
            />
          </div>
        </div>
      );
    }
    const titles: Record<Exclude<MobilePane, "root" | "chat" | "settings" | "search" | "dev">, string> = {
      tasks: "Tarefas",
      calendar: "Calendário",
      drive: "Drive",
      wiki: "Wiki",
    };
    const body =
      pane === "tasks" ? (
        <Board
          project={boardProject}
          people={people.size ? [...people.values()] : []}
          onOpenRoom={(id) => {
            const room = rooms.find((item) => item.id === id);
            if (room) openRoom(room);
          }}
        />
      ) : pane === "calendar" ? (
        <CalendarPanel
          project={boardProject}
          rooms={rooms}
          bots={bots}
          people={people.size ? [...people.values()] : []}
          selectedRoomId={selectedRoomId}
        />
      ) : pane === "drive" ? (
        <DrivePanel project={driveProject} />
      ) : (
        <WikiPanel project={boardProject} />
      );
    const view = pane as Exclude<MobilePane, "root" | "chat" | "settings" | "search" | "dev">;
    return (
      <div className="m-screen">
        <MobileScreenHeader
          title={titles[view]}
          subtitle={teamName}
          onBack={() => setPane("root")}
          actions={<MobileIconButton icon={Search} label="Buscar" onClick={() => setPane("search")} />}
        />
        <div className="m-pushed__body m-pushed__body--panel">{body}</div>
      </div>
    );
  }

  return (
    <div className="m-app">
      <div className="m-app__body">{pane === "root" ? rootScreen() : pushedScreen()}</div>
      <MobileDrawer
        open={drawerOpen}
        onClose={closeDrawer}
        title={teamName}
        meta={`${memberCount} ${memberCount === 1 ? "membro" : "membros"} · ${bots.length} ${bots.length === 1 ? "agente" : "agentes"}`}
        mark={<img src={workspaceLogo} alt="" draggable={false} />}
        sections={drawerSections}
        footer={
          <div className="m-profilebar">
            <Menu
              align="start"
              label="Seu status"
              trigger={
                <button type="button" className="m-profilebar__me" aria-label={`Seu status: ${MEMBER_STATUS_LABEL[userStatus]}`}>
                  <span className="m-profilebar__face">
                    {userFace}
                    <span className="m-presence" data-status={userStatus} aria-hidden="true" />
                  </span>
                  <span className="m-profilebar__copy">
                    <strong>{userName}</strong>
                    <small data-status={userStatus}>{MEMBER_STATUS_LABEL[userStatus]}</small>
                  </span>
                </button>
              }
            >
              <MenuRadioGroup
                label="Seu status"
                value={userStatus}
                onValueChange={(value) => setStatus({ userStatus: value as MemberStatus })}
                options={(["online", "away", "busy", "offline"] as MemberStatus[]).map((value) => ({
                  value,
                  label: MEMBER_STATUS_LABEL[value],
                  leading: <span className="m-status-mark" data-status={value} />,
                }))}
              />
            </Menu>
          </div>
        }
      />
    </div>
  );
}
