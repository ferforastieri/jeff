import { useEffect, useRef, useState, type ReactNode } from "react";
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
import type { AIModel, OnboardingStatus, Project, User } from "../../../shared/api";
import type { AppNotification } from "../../../app/store";
import type { ChannelCategory, Principal, Room, RoomMessage } from "../../rooms/api";
import type { Section } from "../../settings/components/JeffSettings";
import { SettingsView } from "../../settings/components/JeffSettings";
import { MEMBER_STATUS_LABEL, type MemberStatus } from "../../../shared/ui/presence";
import { Menu, MenuRadioGroup, type IconName } from "faang-ui";
import { usePrefs } from "../../../shared/prefs";
import MobileScreenHeader from "../../../app/layouts/mobile/components/MobileScreenHeader";
import MobileIconButton from "../../../app/layouts/mobile/components/MobileIconButton";
import MobileDrawer, { type MobileDrawerRow, type MobileDrawerSection } from "../../../app/layouts/mobile/components/MobileDrawer";
import { useMobileBack } from "../../../app/layouts/mobile/useMobileBack";
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
  onMoveChannel: (room: Room, categoryId: string | null) => void;
  onDeleteChannel: (room: Room) => void;
  onOpenChannelAgents: () => void;
  onOpenChannelRepos: () => void;
  onDraft: (value: string) => void;
  onSend: (text: string) => void;
  onConnectAI: () => void;
  onAgentUpdated: (agent: Principal) => void;
  onOpenWorkbench: (projectId?: string) => void;
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
    onMoveChannel,
    onDeleteChannel,
    onOpenChannelAgents,
    onOpenChannelRepos,
    onDraft,
    onSend,
    onConnectAI,
    onAgentUpdated,
    onOpenWorkbench,
    onOpenNotification,
    onView,
    onInvite,
  } = props;
  const [tab, setTab] = useState<MobileTab>("conversas");
  const [pane, setPane] = useState<MobilePane>("root");
  const [settingsSection, setSettingsSection] = useState<Section>("general");
  const [channelQuery, setChannelQuery] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const searchHost = useRef<HTMLDivElement>(null);
  const setStatus = usePrefs((state) => state.update);

  useMobileBack(() => {
    if (drawerOpen) {
      setDrawerOpen(false);
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
        drawerRow("home", "Início", <Home className="m-drawer__glyph" />, () => selectTab("home"), { active: tab === "home" && pane === "root" }),
        drawerRow("conversas", "Conversas", <MessageSquare className="m-drawer__glyph" />, () => selectTab("conversas"), { active: tab === "conversas", badge: roomUnread }),
        drawerRow("trabalho", "Trabalho", <Braces className="m-drawer__glyph" />, () => selectTab("trabalho"), { active: tab === "trabalho" && pane === "root" }),
        drawerRow("alertas", "Alertas", <Bell className="m-drawer__glyph" />, () => selectTab("alertas"), { active: tab === "alertas", badge: unread }),
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
      id: "repos",
      label: "Repos",
      rows: [
        drawerRow("workbench", "Abrir workbench", <TerminalSquare className="m-drawer__glyph" />, () => { closeDrawer(); onOpenWorkbench(); }, { hint: "Editor, terminal e abas" }),
      ],
    },
    {
      id: "settings",
      label: "Ajustes",
      rows: [
        drawerRow("you", "Você e conta", <UserRound className="m-drawer__glyph" />, () => selectTab("voce"), { hint: "Perfil, tema e sessão" }),
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
          onOpenWorkbench={onOpenWorkbench}
          onOpenSearch={() => setPane("search")}
          onOpenProjects={() => onOpenWorkbench()}
          devMode={status.devMode}
          onMenu={openDrawer}
        />
      );
    }
    if (tab === "alertas") {
      return (
        <AlertsScreen
          onMenu={openDrawer}
          onOpen={(notification) => {
            onOpenNotification(notification);
            if (notification.roomId) {
              const room = rooms.find((item) => item.id === notification.roomId);
              if (room) openRoom(room);
            }
          }}
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
          onOpenWorkbench={onOpenWorkbench}
          devMode={status.devMode}
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
        onMoveChannel={onMoveChannel}
        onDeleteChannel={onDeleteChannel}
        onOpenSearch={() => setPane("search")}
        onOpenNotifications={() => setTab("alertas")}
        onOpenSettings={() => openSettings("general")}
        onOpenWorkbench={() => onOpenWorkbench()}
      />
    );
  }

  function pushedScreen() {
    if (pane === "chat") {
      if (!selectedRoom) {
        return (
          <div className="m-screen">
            <MobileScreenHeader title="Conversa" onBack={() => setPane("root")} />
            <MobileEmpty title="Nenhuma conversa aberta">Escolha um canal ou uma pessoa.</MobileEmpty>
          </div>
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
          onOpenAgent={(bot) => void openAgent(bot)}
          onOpenMember={onEditPerson}
          renderFace={faceOf}
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
    const titles: Record<Exclude<MobilePane, "root" | "chat" | "settings" | "search">, string> = {
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
    const view = pane as Exclude<MobilePane, "root" | "chat" | "settings" | "search">;
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
            <div className="m-profilebar__actions">
              <MobileIconButton icon={Settings2} label="Configurações" onClick={() => openSettings("general")} />
            </div>
          </div>
        }
      />
    </div>
  );
}
