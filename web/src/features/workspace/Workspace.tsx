import { Fragment, Suspense, lazy, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Avatar,
  Button,
  Card,
  Checkbox,
  Chip,
  Composer,
  Dialog,
  DialogBody,
  DialogFooter,
  Field,
  GroupHeading,
  Icon,
  Input,
  ListRow,
  Menu,
  MenuCheckboxItem,
  MenuItem,
  MenuRadioGroup,
  MenuSeparator,
  Message,
  MessageText,
  SearchField,
  Select,
  type IconName,
} from "faang-ui";
import { api, type OnboardingStatus, type Project, type Repository, type User } from "../../shared/api";
import { useApp, type AppNotification, type Sidebar } from "../../app/store";
import { SettingsView, type Section } from "../settings/components/JeffSettings";
import {
  channelsApi,
  roomsApi,
  type ChannelCategory,
  type Principal,
  type Room,
  type RoomMessage,
} from "../rooms/api";
import { formatTime } from "../../shared/time";
import { WORKSPACE_FACE, faceOf, personName } from "./face";
import { modelSelectOptions, useAI } from "../providers/store";
import Board from "../rooms/Board";
import AgentComposerControls from "./AgentComposerControls";
import WorkspaceMenu, { WorkspaceMenuSky } from "./WorkspaceMenu";
import HomeDashboard from "./HomeDashboard";
import { EditAgentDialog, EditPersonDialog, InviteUserDialog } from "./TeamDialogs";
import WorkspaceSearch from "./WorkspaceSearch";
import CalendarPanel from "./CalendarPanel";
import DrivePanel from "./DrivePanel";
import WikiPanel from "./WikiPanel";
import { AGENT_ROLE_GROUPS, agentRoleById, type AgentRole } from "./agentRoles";
import BotAvatar from "../agents/components/BotAvatar";
import SidebarJeffs from "../../shared/ui/SidebarJeffs";
import { MEMBER_STATUS_LABEL, type MemberStatus } from "../../shared/ui/presence";
import { usePrefs } from "../../shared/prefs";
import { animateReorder } from "../../shared/ui/animateReorder";
import NotificationBell from "../notifications/components/NotificationBell";
import { useNotificationStream } from "../notifications/stream";
import { useJeffDrafts } from "../agents/drafts";
import { ThemeToggle } from "../../shared/ui/ThemeToggle";
import Toasts from "../notifications/components/Toasts";
import { useIsMobile } from "../../shared/ui/useIsMobile";
import WorkspaceMobile from "./mobile/WorkspaceMobile";
import { featureEnabled, useSettings, type WorkspaceFeature } from "../settings/store";

const Workbench = lazy(() => import("../../app/components/Workbench"));

type View = "home" | "chat" | "tasks" | "calendar" | "drive" | "wiki" | "settings" | "dev";

function isView(value: string | undefined): value is View {
  return value === "home" || value === "chat" || value === "tasks" || value === "calendar" || value === "drive" || value === "wiki";
}

interface NavItem {
  id: string;
  label: string;
  icon: IconName;
  view: View;
}

const NAV_ITEMS: NavItem[] = [
  { id: "home", label: "Início", icon: "home", view: "home" },
  { id: "tasks", label: "Tarefas", icon: "checks", view: "tasks" },
  { id: "calendar", label: "Calendário", icon: "calendar", view: "calendar" },
  { id: "drive", label: "Drive", icon: "drive", view: "drive" },
  { id: "wiki", label: "Wiki", icon: "book", view: "wiki" },
];

const NAV_DEFAULT = NAV_ITEMS.map((item) => item.id);

const DEV_TOOLS: Array<{ id: Sidebar; label: string; icon: IconName; feature?: WorkspaceFeature }> = [
  { id: "files", label: "Explorer", icon: "file", feature: "files" },
  { id: "bots", label: "Sessões", icon: "message" },
  { id: "scm", label: "Source Control", icon: "gitPull", feature: "sourceControl" },
  { id: "db", label: "Databases", icon: "database", feature: "databases" },
  { id: "web", label: "Web apps", icon: "globe", feature: "webApps" },
];

const EMOJI_LABELS = {
  dialog: "Emojis",
  search: "Buscar emoji",
  noResults: "Nenhum emoji encontrado",
  recent: "Usados recentemente",
  results: "Resultados",
  categories: {
    smileys: "Carinhas",
    people: "Pessoas",
    nature: "Natureza",
    food: "Comida",
    activities: "Atividades",
    travel: "Viagem",
    objects: "Objetos",
    symbols: "Símbolos",
  },
  button: "Emoji",
};

interface Props {
  status: OnboardingStatus;
}

export default function Workspace({ status }: Props) {
  const aiModels = useAI((state) => state.models);
  const aiModelsLoading = useAI((state) => state.loadingModels);
  const loadAIModels = useAI((state) => state.loadModels);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [selectedRoomId, setSelectedRoomId] = useState(
    status.workspaceState?.roomId || "",
  );
  const [me, setMe] = useState<Principal | null>(null);
  const [bots, setBots] = useState<Principal[]>([]);
  const [messages, setMessages] = useState<RoomMessage[]>([]);
  const [chatQuery, setChatQuery] = useState("");
  const [linkOnly, setLinkOnly] = useState(false);
  const [view, setView] = useState<View>(
    isView(status.workspaceState?.view) ? status.workspaceState.view : "home",
  );
  const [devMode, setDevMode] = useState(status.devMode);
  const [settingsSection, setSettingsSection] = useState<Section>("general");
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const workspaceMenuTrigger = useRef<HTMLButtonElement>(null);
  const [channelOpen, setChannelOpen] = useState(false);
  const [agentOpen, setAgentOpen] = useState(false);
  const [reposOpen, setReposOpen] = useState(false);
  const [repoQuery, setRepoQuery] = useState("");
  const [repoBusy, setRepoBusy] = useState(false);
  const [repoLoading, setRepoLoading] = useState(false);
  const [repoLoaded, setRepoLoaded] = useState(false);
  const [repoError, setRepoError] = useState("");
  const [availableRepos, setAvailableRepos] = useState<Repository[]>([]);
  const [draftRepos, setDraftRepos] = useState<string[]>([]);
  const [channelAgentsOpen, setChannelAgentsOpen] = useState(false);
  const [draftAgents, setDraftAgents] = useState<string[]>([]);
  const [agentsBusy, setAgentsBusy] = useState(false);
  const [agentsError, setAgentsError] = useState("");
  const [channelName, setChannelName] = useState("");
  const [channelTopic, setChannelTopic] = useState("");
  const [channelCategoryId, setChannelCategoryId] = useState<string | null>(null);
  const [channelVisibility, setChannelVisibility] = useState<"public" | "private">("public");
  const [channelMembers, setChannelMembers] = useState<string[]>([]);
  const [categories, setCategories] = useState<ChannelCategory[]>([]);
  const [teamPrincipals, setTeamPrincipals] = useState<Principal[]>([]);
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [categoryName, setCategoryName] = useState("");
  const [categoryChannels, setCategoryChannels] = useState<string[]>([]);
  const [renamingCategory, setRenamingCategory] = useState<ChannelCategory | null>(null);
  const [renameCategoryName, setRenameCategoryName] = useState("");
  const [agentName, setAgentName] = useState("");
  const [agentHandle, setAgentHandle] = useState("");
  const [agentTitle, setAgentTitle] = useState("");
  const [agentPersona, setAgentPersona] = useState("");
  const [agentEngine, setAgentEngine] = useState("opencode");
  const [agentModel, setAgentModel] = useState("");
  const [agentEffort, setAgentEffort] = useState("");
  const [agentChannels, setAgentChannels] = useState<string[]>([]);
  const [agentRoleId, setAgentRoleId] = useState("");
  const [teamUsers, setTeamUsers] = useState<User[]>([]);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [personEdit, setPersonEdit] = useState<User | null>(null);
  const [agentEdit, setAgentEdit] = useState<Principal | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const prefs = usePrefs((state) => state.prefs);
  const updatePrefs = usePrefs((state) => state.update);
  const savedNav = Array.isArray(prefs.navOrder) ? prefs.navOrder : NAV_DEFAULT;
  const navOrder = [
    ...savedNav.filter((id) => NAV_DEFAULT.includes(id)),
    ...NAV_DEFAULT.filter((id) => !savedNav.includes(id)),
  ];
  const userStatus = (prefs.userStatus ?? "online") as MemberStatus;
  const openSections = {
    channels: prefs.sidebarSections?.channels !== false,
    agents: prefs.sidebarSections?.agents !== false,
    dms: prefs.sidebarSections?.dms !== false,
  };
  const openCategories = prefs.sidebarCategories ?? {};
  const SECTION_DEFAULT = ["channels", "agents", "dms"] as const;
  type SectionId = (typeof SECTION_DEFAULT)[number];
  const savedSections = (prefs.sidebarSectionOrder ?? []).filter(
    (id): id is SectionId => SECTION_DEFAULT.includes(id as SectionId),
  );
  const sectionOrder: SectionId[] = [
    ...savedSections,
    ...SECTION_DEFAULT.filter((id) => !savedSections.includes(id)),
  ];
  const [draggedSection, setDraggedSection] = useState<SectionId | null>(null);
  const [sectionMark, setSectionMark] = useState<{ id: SectionId; where: "before" | "after" } | null>(null);
  const [draggedNav, setDraggedNav] = useState<string | null>(null);
  const [overNav, setOverNav] = useState<{ id: string; where: "before" | "after" } | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(true);
  const [activeAgents, setActiveAgents] = useState<import("../rooms/api").AgentActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const sidebar = useApp((state) => state.sidebar);
  const terminalOpen = useApp((state) => state.terminalOpen);
  const setTerminalOpen = useApp((state) => state.setTerminalOpen);
  const workspaceFeatures = useSettings((state) => state.workspaceFeatures);
  const bottom = useRef<HTMLDivElement>(null);
  const workspaceLogo = status.workspaceLogo || WORKSPACE_FACE;
  const user = useApp((state) => state.user);
  const notifications = useApp((state) => state.notifications);
  const hydrateNotifications = useApp((state) => state.hydrateNotifications);
  const mobile = useIsMobile();

  useNotificationStream({ onOpened: openInboxItem });

  useEffect(() => {
    let cancelled = false;
    void api
      .notifications()
      .then((items) => {
        if (!cancelled) hydrateNotifications(items);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [hydrateNotifications]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const [channelList, principals, categoryList, team] = await Promise.all([
          channelsApi.list(),
          roomsApi.principals(),
          channelsApi.categories(),
          status.isAdmin
            ? api.teamPrincipals()
            : Promise.resolve({ principals: [] as Principal[] }),
        ]);
        if (cancelled) return;
        setMe(principals.me);
        setBots(principals.bots);
        setRooms(channelList.rooms);
        setCategories(categoryList.categories);
        setTeamPrincipals(team.principals);

        const all = channelList.rooms;
        const requested = status.workspaceState?.roomId;
        const selected =
          all.find((room) => room.id === requested) ??
          all.find(
            (room) => room.kind === "dm" && room.members.some((member) => member.id === status.agentId),
          ) ??
          all[0];
        setSelectedRoomId(selected?.id ?? "");
        setError("");
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "Não foi possível carregar o workspace.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [status.agentId, status.workspaceState?.roomId]);

  const allRooms = rooms;
  const selectedRoom = useMemo(
    () => allRooms.find((room) => room.id === selectedRoomId) ?? null,
    [allRooms, selectedRoomId],
  );
  const selectedChannelAgents = useMemo(
    () =>
      selectedRoom?.kind === "room"
        ? selectedRoom.members.filter((member) => member.kind === "bot")
        : [],
    [selectedRoom],
  );
  const boardProject: Project = useMemo(
    () => ({
      id: selectedRoom?.projectId || status.projectId,
      name: status.teamName || "Workspace",
      root: "",
      color: "#0063D1",
      createdAt: "",
      updatedAt: "",
    }),
    [selectedRoom?.projectId, status.projectId, status.teamName],
  );
  // Drive is the workspace-wide file browser, not the room's repo: it reads
  // the silent workspace project so every configured root is in one place.
  const driveProject: Project = useMemo(
    () => ({
      ...boardProject,
      id: status.projectId,
      name: status.teamName || "Drive",
    }),
    [boardProject, status.projectId, status.teamName],
  );
  const draftKey = `${status.projectId}:slack:${selectedRoomId || "home"}`;
  const draft = useJeffDrafts((state) => state.drafts[draftKey] ?? "");
  const setDraft = useJeffDrafts((state) => state.setDraft);
  const clearDraft = useJeffDrafts((state) => state.clearDraft);
  const repoOptions = useMemo(() => {
    const map = new Map<string, Repository>();
    for (const repo of availableRepos) map.set(repo.path, repo);
    for (const path of draftRepos) {
      if (!map.has(path)) {
        map.set(path, { name: path.split("/").pop() || path, path, root: "", relative: "" });
      }
    }
    const needle = repoQuery.trim().toLowerCase();
    return [...map.values()].filter(
      (repo) => !needle || `${repo.name} ${repo.path}`.toLowerCase().includes(needle),
    );
  }, [availableRepos, draftRepos, repoQuery]);
  const agent = useMemo(() => {
    if (!selectedRoom) return bots[0] ?? null;
    if (selectedRoom.kind === "dm") {
      const member = selectedRoom.members.find((item) => item.kind === "bot");
      const bot = member ? bots.find((item) => item.id === member.id) ?? member : undefined;
      if (bot) return bot;
    }
    const byLead = selectedRoom.leadId
      ? bots.find((item) => item.id === selectedRoom.leadId)
      : undefined;
    const member = selectedRoom.members.find((item) => item.kind === "bot");
    return byLead
      ?? (member ? bots.find((item) => item.id === member.id) ?? member : undefined)
      ?? bots[0]
      ?? null;
  }, [selectedRoom, bots]);

  const userName =
    status.displayName.trim().split(/\s+/)[0] ||
    me?.name ||
    "você";
  const userFace = me ? faceOf({ ...me, name: userName }, 28) : null;

  const people = useMemo(() => {
    const map = new Map<string, Principal>();
    if (me) map.set(me.id, me);
    for (const bot of bots) map.set(bot.id, bot);
    for (const room of allRooms) {
      for (const member of room.members) map.set(member.id, member);
    }
    return map;
  }, [allRooms, bots, me]);

  const teamMembers = useMemo(() => {
    const visibleUsers = [...teamUsers];
    if (me && me.userId !== null && !visibleUsers.some((user) => user.id === me.userId)) {
      visibleUsers.push({
        id: me.userId,
        username: me.handle,
        createdAt: "",
        role: status.isAdmin ? "admin" : "member",
        displayName: userName,
        activity: "",
        devAccess: false,
      });
    }
    const members = [
      ...visibleUsers.map((user) => {
        const self = user.id === me?.userId;
        const presence: MemberStatus = self ? userStatus : "offline";
        return {
          key: `user:${user.id}`,
          name: user.displayName || user.username,
          meta: `@${user.username}${user.role === "admin" ? " · Admin" : ""}`,
          status: presence,
          statusText: MEMBER_STATUS_LABEL[presence],
          kind: "human" as const,
          user,
          bot: null as Principal | null,
        };
      }),
      ...bots.map((bot) => {
        const activity = activeAgents.find((item) => item.agentId === bot.id);
        const presence: MemberStatus = activity ? "working" : "online";
        return {
          key: `bot:${bot.id}`,
          name: bot.name,
          meta: bot.id === status.agentId ? "seu braço direito" : bot.bot?.title || "agente",
          status: presence,
          statusText: activity ? `Trabalhando · #${activity.roomName}` : "Online",
          kind: "bot" as const,
          user: null,
          bot,
        };
      }),
    ];
    return members.sort((a, b) => a.name.localeCompare(b.name));
  }, [activeAgents, bots, me, status.agentId, status.isAdmin, teamUsers, userName, userStatus]);

  const orderedNav = useMemo(
    () =>
      navOrder
        .map((id) => NAV_ITEMS.find((item) => item.id === id))
        .filter((item): item is (typeof NAV_ITEMS)[number] => Boolean(item)),
    [navOrder],
  );

  const placeNav = (target: string, where: "before" | "after" = "before", container?: HTMLElement | null) => {
    if (!draggedNav || draggedNav === target) return;
    const ids = navOrder;
    const rest = ids.filter((id) => id !== draggedNav);
    const at = rest.indexOf(target) + (where === "after" ? 1 : 0);
    if (at < 0) return;
    rest.splice(at, 0, draggedNav);
    if (rest.join("|") !== ids.join("|")) {
      animateReorder(container ?? document.querySelector<HTMLElement>(".ws-nav"), () =>
        updatePrefs({ navOrder: rest }),
      );
    }
  };

  const reorderNav = (target: string, where: "before" | "after" = "before") => {
    placeNav(target, where);
    setDraggedNav(null);
    setOverNav(null);
  };

  const moveNav = (id: string, delta: -1 | 1) => {
    const from = navOrder.indexOf(id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= navOrder.length) return;
    const next = [...navOrder];
    next.splice(from, 1);
    next.splice(to, 0, id);
    updatePrefs({ navOrder: next });
  };

  const isNavActive = (item: NavItem) => view === item.view;

  const openNav = (item: NavItem) => changeView(item.view);

  const openSettingsScreen = (section: Section) => {
    setWorkspaceMenuOpen(false);
    setSettingsSection(section);
    changeView("settings");
  };

  const sectionLabel: Record<SectionId, string> = {
    channels: "Canais",
    agents: "Equipe",
    dms: "Mensagens diretas",
  };

  const moveSection = (id: SectionId, delta: -1 | 1) => {
    const from = sectionOrder.indexOf(id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= sectionOrder.length) return;
    const next = [...sectionOrder];
    next.splice(from, 1);
    next.splice(to, 0, id);
    updatePrefs({ sidebarSectionOrder: next });
  };

  const restoreSections = () => updatePrefs({ sidebarSectionOrder: [...SECTION_DEFAULT] });

  const sectionProps = (id: SectionId) => ({
    style: { order: sectionOrder.indexOf(id) },
    "data-section": id,
    "data-sort-id": id,
    "data-drop": sectionMark?.id === id ? sectionMark.where : undefined,
    onDragOver: (event: React.DragEvent<HTMLElement>) => {
      if (!draggedSection || draggedSection === id) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      const rect = event.currentTarget.getBoundingClientRect();
      const where = event.clientY > rect.top + rect.height / 2 ? "after" : "before";
      if (where !== "before" || id !== draggedSection) {
        const rest = sectionOrder.filter((value) => value !== draggedSection);
        const at = rest.indexOf(id) + (where === "after" ? 1 : 0);
        rest.splice(at, 0, draggedSection);
        if (rest.join("|") !== sectionOrder.join("|")) {
          animateReorder(
            (event.currentTarget as HTMLElement).closest<HTMLElement>(".ws-sidebar-scroll"),
            () => updatePrefs({ sidebarSectionOrder: rest }),
          );
        }
      }
      if (sectionMark?.id !== id || sectionMark.where !== where) setSectionMark({ id, where });
    },
    onDrop: (event: React.DragEvent<HTMLElement>) => {
      event.preventDefault();
      setDraggedSection(null);
      setSectionMark(null);
    },
  });

  const sectionGrip = (id: SectionId) => {
    const index = sectionOrder.indexOf(id);
    return (
      <Menu
        align="end"
        label={`Mover ${sectionLabel[id]}`}
        trigger={
          <button
            type="button"
            className="ws-section-grip"
            draggable
            aria-label={`Mover ${sectionLabel[id]}`}
            title={`Mover ${sectionLabel[id]}`}
            onDragStart={(event) => {
              setDraggedSection(id);
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("text/plain", id);
              const head = event.currentTarget.parentElement?.querySelector<HTMLElement>(".ws-group-toggle");
              if (head) event.dataTransfer.setDragImage(head, 24, head.clientHeight / 2);
            }}
            onDragEnd={() => {
              setDraggedSection(null);
              setSectionMark(null);
            }}
          >
            <Icon name="grip" size={14} />
          </button>
        }
      >
        <MenuItem icon="chevronUp" disabled={index <= 0} onSelect={() => moveSection(id, -1)}>
          Mover para cima
        </MenuItem>
        <MenuItem icon="chevronDown" disabled={index >= sectionOrder.length - 1} onSelect={() => moveSection(id, 1)}>
          Mover para baixo
        </MenuItem>
        <MenuSeparator />
        <MenuItem
          icon="undo"
          disabled={sectionOrder.every((value, position) => value === SECTION_DEFAULT[position])}
          onSelect={restoreSections}
        >
          Restaurar ordem padrão
        </MenuItem>
      </Menu>
    );
  };

  const channels = allRooms.filter((room) => room.kind === "room");
  const directMessages = allRooms.filter(
    (room) => room.kind === "dm" && !room.members.some((member) => member.kind === "bot"),
  );
  const visibleChannels = channels;
  const visibleDms = directMessages;
  const uncategorizedChannels = visibleChannels.filter((room) => !room.categoryId);
  const categorizedChannels = categories.map((category) => ({
    category,
    rooms: visibleChannels.filter((room) => room.categoryId === category.id),
  }));
  const memberOptions = useMemo(() => {
    const map = new Map<string, Principal>();
    for (const principal of teamPrincipals) {
      if (principal.id !== me?.id) map.set(principal.id, principal);
    }
    for (const bot of bots) map.set(bot.id, bot);
    return [...map.values()];
  }, [teamPrincipals, bots, me?.id]);
  const channelOptions = channels.map((room) => ({ id: room.id, name: room.name }));
  const visibleMessages = messages.filter((message) => {
    if (linkOnly && !/https?:\/\/|!\[[^\]]*\]\(|\[[^\]]+\]\(/.test(message.text)) {
      return false;
    }
    const needle = chatQuery.trim().toLowerCase();
    return !needle || message.text.toLowerCase().includes(needle);
  });

  useEffect(() => setDevMode(status.devMode), [status.devMode]);

  // Turning the dev mode off must not leave the dev surface on screen.
  useEffect(() => {
    if (!devMode && view === "dev") setView("home");
  }, [devMode, view]);

  useEffect(() => {
    void loadAIModels();
  }, [loadAIModels]);

  // Coming back from the AI connection page (or opening an agent) must show
  // models connected in the meantime.
  useEffect(() => {
    if (view === "home" || view === "chat" || agentOpen || agentEdit) {
      void loadAIModels();
    }
  }, [view, agentOpen, agentEdit, loadAIModels]);

  useEffect(() => {
    if (localStorage.getItem("jeff_open_harness_settings") !== "1") return;
    localStorage.removeItem("jeff_open_harness_settings");
    setSettingsSection("harness");
    changeView("settings");
    // Run once after onboarding hands the user to the harness page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const section = localStorage.getItem("jeff_open_settings_section");
    if (section && ["general", "skills", "connectors", "harness", "workspace"].includes(section)) {
      localStorage.removeItem("jeff_open_settings_section");
      setSettingsSection(section as Section);
      changeView("settings");
    }
    if (localStorage.getItem("jeff_open_invite") === "1") {
      localStorage.removeItem("jeff_open_invite");
      setInviteOpen(true);
    }
    // The dev workspace menu hands these actions back to the Slack shell.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedRoomId) {
      setMessages([]);
      return;
    }
    let cancelled = false;
    async function load() {
      try {
        const result = await channelsApi.messages(selectedRoomId);
        if (!cancelled) setMessages(result.messages);
      } catch {
        /* the next poll tries again */
      }
    }
    void load();
    const timer = window.setInterval(() => void load(), 4000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [selectedRoomId]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const result = await roomsApi.activity();
        if (!cancelled) setActiveAgents(result.agents);
      } catch {
        /* the next poll tries again */
      }
    }
    void load();
    const timer = window.setInterval(() => void load(), 4000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [messages.length, selectedRoomId]);

  function savePosition(roomId: string, nextView: View) {
    void api
      .saveWorkspaceState({ roomId, view: nextView })
      .catch(() => undefined);
  }

  function changeView(next: View) {
    setView(next);
    setMenuOpen(false);
    if (next !== "settings" && next !== "dev") savePosition(selectedRoomId, next);
  }

  function toggleSection(section: "channels" | "agents" | "dms") {
    updatePrefs({
      sidebarSections: { ...openSections, [section]: !openSections[section] },
    });
  }

  function selectRoom(room: Room) {
    setSelectedRoomId(room.id);
    setView("chat");
    setMenuOpen(false);
    savePosition(room.id, "chat");
  }

  async function openAgent(bot: Principal) {
    const room = allRooms.find(
      (item) =>
        item.kind === "dm" &&
        item.members.some((member) => member.id === bot.id) &&
        item.members.some((member) => member.id === me?.id),
    );
    if (room) {
      selectRoom(room);
      return;
    }
    try {
      const created = await channelsApi.openDm(bot.id);
      setRooms((current) => [created, ...current]);
      selectRoom(created);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível abrir a conversa.");
    }
  }

  async function send(text: string) {
    const value = text.trim();
    if (!value || !selectedRoomId) return;
    clearDraft(draftKey);
    try {
      await channelsApi.send(selectedRoomId, { text: value });
      const result = await channelsApi.messages(selectedRoomId);
      setMessages(result.messages);
    } catch (cause) {
      setDraft(draftKey, value);
      setError(cause instanceof Error ? cause.message : "Não foi possível enviar.");
    }
  }

  function openChannel(categoryId: string | null = null) {
    setChannelName("");
    setChannelTopic("");
    setChannelCategoryId(categoryId);
    setChannelVisibility("public");
    setChannelMembers(status.agentId ? [status.agentId] : []);
    setError("");
    setChannelOpen(true);
  }

  async function createChannel() {
    if (!channelName.trim()) {
      setError("Dê um nome ao canal.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const room = await channelsApi.create({
        name: channelName.trim(),
        title: channelTopic.trim(),
        categoryId: channelCategoryId,
        visibility: channelVisibility,
        memberIds: channelMembers,
      });
      setRooms((current) => [room, ...current]);
      setSelectedRoomId(room.id);
      setChannelOpen(false);
      setView("home");
      savePosition(room.id, "chat");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível criar o canal.");
    } finally {
      setBusy(false);
    }
  }

  async function createCategory() {
    if (!categoryName.trim()) {
      setError("Dê um nome à categoria.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const created = await channelsApi.createCategory(categoryName.trim());
      for (const roomId of categoryChannels) {
        await channelsApi.setCategory(roomId, created.id);
      }
      setCategories((current) => [...current, created]);
      if (channelOpen) setChannelCategoryId(created.id);
      if (categoryChannels.length > 0) {
        setRooms((current) =>
          current.map((room) =>
            categoryChannels.includes(room.id) ? { ...room, categoryId: created.id } : room,
          ),
        );
      }
      setCategoryOpen(false);
      setCategoryName("");
      setCategoryChannels([]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível criar a categoria.");
    } finally {
      setBusy(false);
    }
  }

  async function renameCategory() {
    if (!renamingCategory || !renameCategoryName.trim()) return;
    setBusy(true);
    setError("");
    try {
      const updated = await channelsApi.renameCategory(
        renamingCategory.id,
        renameCategoryName.trim(),
      );
      setCategories((current) =>
        current.map((category) => (category.id === updated.id ? updated : category)),
      );
      setRenamingCategory(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível renomear a categoria.");
    } finally {
      setBusy(false);
    }
  }

  async function removeCategory(category: ChannelCategory) {
    if (!window.confirm(`Excluir a categoria “${category.name}”? Os canais continuam.`)) return;
    setBusy(true);
    setError("");
    try {
      await channelsApi.deleteCategory(category.id);
      setCategories((current) => current.filter((item) => item.id !== category.id));
      setRooms((current) =>
        current.map((room) =>
          room.categoryId === category.id ? { ...room, categoryId: null } : room,
        ),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível excluir a categoria.");
    } finally {
      setBusy(false);
    }
  }

  async function moveChannel(room: Room, categoryId: string | null) {
    try {
      const updated = await channelsApi.setCategory(room.id, categoryId);
      setRooms((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível mover o canal.");
    }
  }

  async function deleteChannel(room: Room) {
    if (!window.confirm(`Excluir o canal “${room.name}”? As mensagens saem do workspace.`)) return;
    try {
      await channelsApi.remove(room.id);
      setRooms((current) => current.filter((item) => item.id !== room.id));
      if (selectedRoomId === room.id) setSelectedRoomId("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível excluir o canal.");
    }
  }

  function toggleCategory(id: string) {
    updatePrefs({
      sidebarCategories: { ...openCategories, [id]: openCategories[id] === false },
    });
  }

  async function refreshTeamUsers() {
    if (!status.isAdmin) {
      setTeamUsers([]);
      return;
    }
    try {
      const result = await api.team();
      setTeamUsers(result.users);
    } catch {
      setTeamUsers([]);
    }
  }

  useEffect(() => {
    void refreshTeamUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status.isAdmin]);


  function startNewAgent(role?: AgentRole) {
    setError("");
    setAgentRoleId(role?.id ?? "");
    setAgentName(role?.label ?? "");
    setAgentHandle(role?.id ?? "");
    setAgentTitle(role?.title ?? "");
    setAgentPersona(role?.persona ?? "");
    setAgentEngine("opencode");
    setAgentModel("");
    setAgentEffort("");
    setAgentChannels([]);
    setAgentOpen(true);
  }

  function applyAgentRole(role: AgentRole) {
    setAgentRoleId(role.id);
    setAgentName(role.label);
    setAgentHandle(role.id);
    setAgentTitle(role.label);
    setAgentPersona(role.persona);
  }

  async function createAgent() {
    if (!agentName.trim()) {
      setError("Dê um nome ao agente.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const bot = await roomsApi.createBot({
        name: agentName.trim(),
        handle: agentHandle.trim(),
        title: agentTitle.trim(),
        persona: agentPersona.trim(),
        engine: agentEngine,
        model: agentModel.trim(),
        effort: agentEffort,
      });
      for (const roomId of agentChannels) {
        try {
          await channelsApi.addAgent(roomId, bot.id);
        } catch {
          /* the agent exists; the channel dialog can add it later */
        }
      }
      const principals = await roomsApi.principals();
      setMe(principals.me);
      setBots(principals.bots);
      setAgentOpen(false);
      setAgentName("");
      setAgentHandle("");
      setAgentTitle("");
      setAgentPersona("");
      setAgentModel("");
      setAgentEffort("");
      setAgentChannels([]);
      setAgentRoleId("");
      await refreshChannels();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível criar o agente.");
    } finally {
      setBusy(false);
    }
  }

  async function refreshChannels() {
    try {
      const [channelList, categoryList] = await Promise.all([
        channelsApi.list(),
        channelsApi.categories(),
      ]);
      setRooms(channelList.rooms);
      setCategories(categoryList.categories);
    } catch {
      /* keep the local state */
    }
  }

  async function openRepos() {
    if (!selectedRoom || selectedRoom.kind !== "room") return;
    setDraftRepos(selectedRoom.repos ?? []);
    setRepoQuery("");
    setRepoError("");
    setReposOpen(true);
    if (repoLoaded) return;
    setRepoLoading(true);
    try {
      setAvailableRepos(await api.repos());
      setRepoLoaded(true);
    } catch (cause) {
      setRepoError(cause instanceof Error ? cause.message : "Não foi possível listar os repos.");
    } finally {
      setRepoLoading(false);
    }
  }

  function toggleRepo(path: string) {
    setDraftRepos((current) =>
      current.includes(path) ? current.filter((item) => item !== path) : [...current, path],
    );
  }

  async function saveRepos() {
    if (!selectedRoom || selectedRoom.kind !== "room") return;
    setRepoBusy(true);
    setRepoError("");
    try {
      const updated = await channelsApi.setRepos(selectedRoom.id, draftRepos);
      setRooms((current) =>
        current.map((room) => (room.id === updated.id ? updated : room)),
      );
      setReposOpen(false);
    } catch (cause) {
      setRepoError(cause instanceof Error ? cause.message : "Não foi possível salvar os repos.");
    } finally {
      setRepoBusy(false);
    }
  }

  function openChannelAgents() {
    if (!selectedRoom || selectedRoom.kind !== "room") return;
    setDraftAgents(selectedChannelAgents.map((agent) => agent.id));
    setAgentsError("");
    setChannelAgentsOpen(true);
  }

  async function saveChannelAgents() {
    if (!selectedRoom || selectedRoom.kind !== "room") return;
    setAgentsBusy(true);
    setAgentsError("");
    try {
      const updated = await channelsApi.setAgents(selectedRoom.id, draftAgents);
      setRooms((current) =>
        current.map((room) => (room.id === updated.id ? updated : room)),
      );
      setChannelAgentsOpen(false);
    } catch (cause) {
      setAgentsError(cause instanceof Error ? cause.message : "Não foi possível salvar os agentes.");
    } finally {
      setAgentsBusy(false);
    }
  }

  function openDev(tool?: Sidebar) {
    if (!devMode) return;
    if (tool) useApp.getState().setSidebar(tool);
    setView("dev");
    setMenuOpen(false);
    if (tool) {
      window.dispatchEvent(new CustomEvent("jeff:dev-tool", { detail: { tool } }));
    }
  }

  function openDevTerminal() {
    if (!devMode) return;
    setTerminalOpen(true);
    setView("dev");
    setMenuOpen(false);
  }

  /**
   * Where a bell item lands: a room stays in the Slack shell; an agent
   * completion opens the dev surface on that exact conversation.
   */
  function openInboxItem(item: {
    projectId?: string;
    chatId?: string;
    botId?: string;
    roomId?: string;
  }) {
    // The phone manages its own panes, so it receives the notification and
    // decides between the dev chat and a room.
    if (mobile) {
      window.dispatchEvent(new CustomEvent("jeff:mobile-notification", { detail: item }));
      return;
    }
    const room = item.roomId
      ? allRooms.find((candidate) => candidate.id === item.roomId)
      : null;
    if (room) {
      selectRoom(room);
      setMenuOpen(false);
      return;
    }
    if (item.projectId && (item.chatId || item.botId)) {
      localStorage.setItem(
        "jeff_open_dev_chat",
        JSON.stringify({
          projectId: item.projectId,
          chatId: item.chatId,
          botId: item.botId,
        }),
      );
      setView("dev");
      setMenuOpen(false);
      // The workbench may already be mounted (the user is already in dev):
      // the handoff in localStorage is only for its first mount.
      window.dispatchEvent(
        new CustomEvent(item.chatId ? "jeff:open-chat" : "jeff:open-bot", {
          detail: { projectId: item.projectId, chatId: item.chatId, botId: item.botId },
        }),
      );
    }
  }

  const roomTitle =
    selectedRoom?.kind === "dm"
      ? personName(selectedRoom, me) || agent?.name || "Conversa"
      : selectedRoom?.name ?? "workspace";
  const roomSubtitle =
    selectedRoom?.kind === "dm"
      ? agent
        ? "Seu braço direito · age com as suas permissões"
        : "Conversa direta"
      : selectedRoom?.title || (selectedRoom ? `${selectedRoom.members.length} membros` : "Escolha um canal");

  return (
    <main className={`jeff-workspace-home${collapsed ? " is-collapsed" : ""}${mobile ? " is-mobile" : ""}`}>
      {mobile ? (
        <WorkspaceMobile
          status={status}
          teamName={status.teamName || "Seu workspace"}
          workspaceLogo={workspaceLogo}
          memberCount={status.memberCount}
          bots={bots}
          me={me}
          rooms={allRooms}
          categories={categories}
          teamMembers={teamMembers}
          user={user}
          userName={userName}
          userFace={userFace}
          userStatus={userStatus}
          isAdmin={status.isAdmin}
          unread={notifications.filter((notification) => !notification.read).length}
          roomUnread={notifications.filter((notification) => !notification.read && notification.roomId).length}
          unreadRoomIds={new Set(notifications.filter((notification) => !notification.read && notification.roomId).map((notification) => notification.roomId as string))}
          activeAgents={activeAgents.length}
          selectedRoomId={selectedRoomId}
          selectedRoom={selectedRoom}
          agent={agent}
          messages={messages}
          people={people}
          roomTitle={roomTitle}
          roomSubtitle={roomSubtitle}
          draft={draft}
          models={aiModels}
          boardProject={boardProject}
          driveProject={driveProject}
          welcome={
            <WelcomeCard
              agentName={agent?.name || "Jeff"}
              teamName={status.teamName}
              aiReady={aiModels.length > 0}
              aiModelCount={aiModels.length}
              onConnect={() => openSettingsScreen("harness")}
              onInvite={() => setInviteOpen(true)}
              onSettings={() => openSettingsScreen("connectors")}
            />
          }
          onSelectRoom={selectRoom}
          onOpenAgent={openAgent}
          onEditPerson={(person) => setPersonEdit(teamUsers.find((item) => item.id === person.id) ?? person)}
          onEditAgent={setAgentEdit}
          onCreateChannel={openChannel}
          onCreateCategory={() => {
            setCategoryName("");
            setCategoryChannels([]);
            setCategoryOpen(true);
          }}
          onRenameCategory={(category) => {
            setRenamingCategory(category);
            setRenameCategoryName(category.name);
          }}
          onDeleteCategory={(category) => void removeCategory(category)}
          onMoveChannel={(room, categoryId) => void moveChannel(room, categoryId)}
          onDeleteChannel={(room) => void deleteChannel(room)}
          onOpenChannelAgents={openChannelAgents}
          onOpenChannelRepos={() => void openRepos()}
          onDraft={(value) => setDraft(draftKey, value)}
          onSend={(text) => void send(text)}
          onConnectAI={() => openSettingsScreen("harness")}
          onAgentUpdated={(updated) => setBots((current) => current.map((bot) => (bot.id === updated.id ? updated : bot)))}
          onOpenNotification={openInboxItem}
          onView={changeView}
          onInvite={() => setInviteOpen(true)}
        />
      ) : (
      <>
      {collapsed ? (
        <WorkspaceRail
          workspaceLogo={workspaceLogo}
          onExpand={() => {
            if (window.matchMedia("(max-width: 640px)").matches) {
              setCollapsed(false);
              setMenuOpen(true);
            } else {
              setCollapsed(false);
            }
          }}
          view={view}
          onOpenNav={openNav}
          isNavActive={isNavActive}
          channels={visibleChannels}
          navItems={orderedNav}
          selectedRoomId={selectedRoomId}
          onSelectRoom={selectRoom}
          onCreateChannel={() => openChannel(null)}
          userName={userName}
          userFace={userFace}
          userStatus={userStatus}
          onStatusChange={(value) => updatePrefs({ userStatus: value })}
          devMode={devMode}
          onDev={() => openDev("files")}
          onOpenNotification={openInboxItem}
        />
      ) : (
      <aside className={`ws-sidebar${menuOpen ? " is-open" : ""}`}>
        <div className="ws-ambient" aria-hidden="true" />
        <SidebarJeffs subtle />
        <div className="ws-workspace-head">
          <button
            ref={workspaceMenuTrigger}
            type="button"
            className="ws-workspace"
            aria-haspopup="dialog"
            aria-expanded={workspaceMenuOpen}
            aria-label={`Menu do workspace ${status.teamName || "Seu workspace"}`}
            onClick={() => setWorkspaceMenuOpen(true)}
          >
            <span className="ws-workspace-mark">
              <img src={workspaceLogo} alt="" draggable={false} />
            </span>
            <span className="ws-workspace-title">
              <strong>{status.teamName || "Seu workspace"}</strong>
              <small>
                Seu servidor · {status.memberCount} {status.memberCount === 1 ? "membro" : "membros"} ·{" "}
                {bots.length} {bots.length === 1 ? "agente" : "agentes"}
              </small>
            </span>
            <Icon name="chevronDown" size={16} />
          </button>
          {devMode ? (
            <Button
              variant="ghost"
              size="sm"
              iconOnly
              icon="code"
              aria-label="Abrir modo dev"
              title="Abrir modo dev"
              onClick={() => openDev("files")}
            />
          ) : null}
        </div>

        <div className="ws-search">
          <div className="ws-search-row">
            <WorkspaceSearch
              projectId={boardProject.id}
              rooms={allRooms}
              people={people.size ? [...people.values()] : []}
              bots={bots}
              me={me}
              views={NAV_ITEMS}
              onOpenRoom={(roomId) => {
                const room = allRooms.find((item) => item.id === roomId);
                if (room) selectRoom(room);
              }}
              onOpenAgent={(bot) => void openAgent(bot)}
              onOpenView={(next) => {
                const item = NAV_ITEMS.find((candidate) => candidate.id === next);
                if (item) openNav(item);
              }}
              onOpenCard={(roomId) => {
                const room =
                  (roomId ? allRooms.find((item) => item.id === roomId) : null) ??
                  selectedRoom ??
                  allRooms.find((item) => item.kind === "room");
                if (room) setSelectedRoomId(room.id);
                changeView("tasks");
              }}
            />
            <Button
              variant="ghost"
              size="sm"
              iconOnly
              icon="sidebar"
              aria-label="Recolher barra"
              onClick={() => {
                if (window.matchMedia("(max-width: 640px)").matches) setMenuOpen(false);
                else setCollapsed(true);
              }}
            />
          </div>
        </div>

        <nav className="ws-nav" aria-label="Workspace">
          {orderedNav.map((item) => (
            <ListRow
              key={item.id}
              className={[
                isNavActive(item) ? "is-active" : "",
                draggedNav === item.id ? "is-dragging" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              data-drop={overNav?.id === item.id && overNav.where}
              data-sort-id={item.id}
              lead={<Icon name={item.icon} size={16} />}
              title={item.label}
              trailing={
                <span
                  className="ws-nav-grip"
                  draggable
                  role="button"
                  tabIndex={-1}
                  aria-label={`Mover ${item.label}`}
                  title={`Mover ${item.label}`}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                  }}
                  onDragStart={(event) => {
                    setDraggedNav(item.id);
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/plain", item.id);
                    const row = event.currentTarget.closest<HTMLElement>(".ac-row");
                    if (row) event.dataTransfer.setDragImage(row, 24, row.clientHeight / 2);
                  }}
                  onDragEnd={() => {
                    setDraggedNav(null);
                    setOverNav(null);
                  }}
                >
                  <Icon name="grip" size={14} />
                </span>
              }
              onClick={() => openNav(item)}
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                const rect = event.currentTarget.getBoundingClientRect();
                const where = event.clientY > rect.top + rect.height / 2 ? "after" : "before";
                placeNav(item.id, where, event.currentTarget.closest<HTMLElement>(".ws-nav"));
                if (overNav?.id !== item.id || overNav.where !== where) setOverNav({ id: item.id, where });
              }}
              onDragLeave={() => setOverNav((current) => (current?.id === item.id ? null : current))}
              onDrop={(event) => {
                event.preventDefault();
                const rect = event.currentTarget.getBoundingClientRect();
                const where = event.clientY > rect.top + rect.height / 2 ? "after" : "before";
                reorderNav(item.id, where);
              }}
              onKeyDown={(event) => {
                if (!event.altKey || !event.shiftKey) return;
                if (event.key === "ArrowUp") {
                  event.preventDefault();
                  moveNav(item.id, -1);
                } else if (event.key === "ArrowDown") {
                  event.preventDefault();
                  moveNav(item.id, 1);
                }
              }}
            />
          ))}
        </nav>

        <div className="ws-sidebar-scroll">
          {devMode ? (
            <section className="ws-group ws-dev-group" aria-label="Modo dev">
              <div className="ws-group-head">
                <span className="ws-group-label">Dev</span>
                <span className="ws-dev-badge">modo dev</span>
              </div>
              <div className="ws-group-body">
                <ListRow
                  lead={<Icon name="code" size={16} />}
                  title="Workbench"
                  onClick={() => openDev()}
                />
                {DEV_TOOLS
                  .filter((tool) => !tool.feature || featureEnabled(workspaceFeatures, tool.feature))
                  .map((tool) => (
                    <ListRow
                      key={tool.id}
                      className={view === "dev" && sidebar === tool.id ? "is-active" : ""}
                      lead={<Icon name={tool.icon} size={16} />}
                      title={tool.label}
                      onClick={() => openDev(tool.id)}
                    />
                  ))}
                {featureEnabled(workspaceFeatures, "terminal") ? (
                  <ListRow
                    className={view === "dev" && terminalOpen ? "is-active" : ""}
                    lead={<Icon name="code" size={16} />}
                    title="Terminal"
                    onClick={openDevTerminal}
                  />
                ) : null}
              </div>
            </section>
          ) : null}
          <section className="ws-group" data-open={openSections.channels} {...sectionProps("channels")}>
            <div className="ws-group-head">
              <button
                type="button"
                className="ws-group-toggle"
                aria-expanded={openSections.channels}
                onClick={() => toggleSection("channels")}
              >
                <span className="ws-group-label">Canais</span>
                <Icon name="chevronDown" size={14} className="ws-group-chevron" />
              </button>
              {sectionGrip("channels")}
              {status.isAdmin ? (
                <Menu
                  align="end"
                  label="Criar canal"
                  trigger={
                    <Button
                      variant="ghost"
                      size="sm"
                      iconOnly
                      icon="plus"
                      className="ws-group-add"
                      aria-label="Criar canal ou categoria"
                    />
                  }
                >
                  <MenuItem icon="channel" onSelect={() => openChannel(null)}>
                    Novo canal
                  </MenuItem>
                  <MenuItem
                    icon="layers"
                    onSelect={() => {
                      setCategoryName("");
                      setCategoryChannels([]);
                      setCategoryOpen(true);
                    }}
                  >
                    Nova categoria
                  </MenuItem>
                </Menu>
              ) : null}
            </div>
            {openSections.channels ? (
              <div className="ws-group-body">
                {uncategorizedChannels.map((room) => (
                  <div className="ws-channel-wrap" key={room.id}>
                    <ListRow
                      className={`ws-channel-row${view === "chat" && selectedRoomId === room.id ? " is-active" : ""}`}
                      lead={<Icon name="channel" size={16} />}
                      title={room.name}
                      onClick={() => selectRoom(room)}
                    />
                    {status.isAdmin ? (
                      <Menu
                        align="end"
                        label={`Opções de ${room.name}`}
                        trigger={
                          <Button
                            variant="ghost"
                            size="sm"
                            iconOnly
                            icon="more"
                            className="ws-row-action"
                            aria-label={`Opções de ${room.name}`}
                          />
                        }
                      >
                        <MenuItem icon="channel" disabled>
                          Mover para categoria
                        </MenuItem>
                        <MenuItem
                          icon="layers"
                          onSelect={() => void moveChannel(room, null)}
                        >
                          Sem categoria
                        </MenuItem>
                        {categories.map((category) => (
                          <MenuItem
                            key={category.id}
                            icon="layers"
                            onSelect={() => void moveChannel(room, category.id)}
                          >
                            {category.name}
                          </MenuItem>
                        ))}
                        <MenuItem danger icon="trash" onSelect={() => void deleteChannel(room)}>
                          Excluir canal
                        </MenuItem>
                      </Menu>
                    ) : null}
                  </div>
                ))}
                {visibleChannels.length === 0 ? (
                  <p className="ws-empty">Nenhum canal ainda.</p>
                ) : null}
                {categorizedChannels.map(({ category, rooms }) => {
                  const open = openCategories[category.id] !== false;
                  return (
                    <div className="ws-category" data-open={open} key={category.id}>
                      <div className="ws-category-head">
                        <button
                          type="button"
                          className="ws-category-toggle"
                          aria-expanded={open}
                          onClick={() => toggleCategory(category.id)}
                        >
                          <span className="ws-category-label">{category.name}</span>
                          <Icon name="chevronDown" size={14} className="ws-category-chevron" />
                        </button>
                        {status.isAdmin ? (
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              iconOnly
                              icon="plus"
                              className="ws-group-add"
                              aria-label={`Novo canal em ${category.name}`}
                              onClick={() => openChannel(category.id)}
                            />
                            <Menu
                              align="end"
                              label={`Categoria ${category.name}`}
                              trigger={
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  iconOnly
                                  icon="more"
                                  className="ws-group-add"
                                  aria-label={`Opções de ${category.name}`}
                                />
                              }
                            >
                              <MenuItem
                                icon="edit"
                                onSelect={() => {
                                  setRenamingCategory(category);
                                  setRenameCategoryName(category.name);
                                }}
                              >
                                Renomear
                              </MenuItem>
                              <MenuItem danger onSelect={() => void removeCategory(category)}>
                                Excluir categoria
                              </MenuItem>
                            </Menu>
                          </>
                        ) : null}
                      </div>
                      {open ? (
                        <div className="ws-category-body">
                          {rooms.map((room) => (
                            <div className="ws-channel-wrap" key={room.id}>
                              <ListRow
                                className={`ws-channel-row${view === "chat" && selectedRoomId === room.id ? " is-active" : ""}`}
                                lead={<Icon name="channel" size={16} />}
                                title={room.name}
                                onClick={() => selectRoom(room)}
                              />
                              {status.isAdmin ? (
                                <Menu
                                  align="end"
                                  label={`Opções de ${room.name}`}
                                  trigger={
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      iconOnly
                                      icon="more"
                                      className="ws-row-action"
                                      aria-label={`Opções de ${room.name}`}
                                    />
                                  }
                                >
                                  <MenuItem icon="channel" disabled>
                                    Mover para categoria
                                  </MenuItem>
                                  <MenuItem
                                    icon="layers"
                                    onSelect={() => void moveChannel(room, null)}
                                  >
                                    Sem categoria
                                  </MenuItem>
                                  {categories.map((category) => (
                                    <MenuItem
                                      key={category.id}
                                      icon="layers"
                                      onSelect={() => void moveChannel(room, category.id)}
                                    >
                                      {category.name}
                                    </MenuItem>
                                  ))}
                                  <MenuItem
                                    danger
                                    icon="trash"
                                    onSelect={() => void deleteChannel(room)}
                                  >
                                    Excluir canal
                                  </MenuItem>
                                </Menu>
                              ) : null}
                            </div>
                          ))}
                          {rooms.length === 0 ? (
                            <p className="ws-empty">Nenhum canal nesta categoria.</p>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : null}
          </section>

          <section className="ws-group" data-open={openSections.agents} {...sectionProps("agents")}>
            <div className="ws-group-head">
              <button
                type="button"
                className="ws-group-toggle"
                aria-expanded={openSections.agents}
                onClick={() => toggleSection("agents")}
              >
                <span className="ws-group-label">Equipe</span>
                <span className="ws-group-count">{teamMembers.length}</span>
                <Icon name="chevronDown" size={14} className="ws-group-chevron" />
              </button>
              {sectionGrip("agents")}
              {status.isAdmin ? (
                <Menu
                  align="end"
                  label="Adicionar à equipe"
                  trigger={
                    <Button
                      variant="ghost"
                      size="sm"
                      iconOnly
                      icon="plus"
                      className="ws-group-add"
                      aria-label="Adicionar à equipe"
                    />
                  }
                >
                  <MenuItem icon="agent" onSelect={() => startNewAgent()}>
                    Novo agente
                  </MenuItem>
                  <MenuItem icon="personAdd" onSelect={() => setInviteOpen(true)}>
                    Novo usuário
                  </MenuItem>
                </Menu>
              ) : null}
            </div>
            {openSections.agents ? (
              <div className="ws-group-body">
                {teamMembers.map((member) => {
                  const active =
                    member.bot &&
                    selectedRoom?.kind === "dm" &&
                    selectedRoom.members.some((item) => item.id === member.bot?.id);
                  return (
                    <div className="ws-agent-wrap ws-team-member" key={member.key}>
                      <button
                        type="button"
                        className={`ws-agent-row${active ? " is-active" : ""}`}
                        onClick={() => {
                          if (member.bot) void openAgent(member.bot);
                          else if (member.user) setPersonEdit(member.user);
                        }}
                      >
                        <span className="ws-member-face">
                          {member.bot ? faceOf(member.bot, 36) : <Avatar name={member.name} size="md" />}
                          <span className="ws-member-presence" data-status={member.status} aria-hidden="true" />
                        </span>
                        <span className="ws-agent-copy">
                          <strong>{member.name}</strong>
                          <span className="ws-member-status" data-status={member.status}>
                            <i aria-hidden="true" />
                            {member.statusText}
                          </span>
                          <span className="ws-member-meta">{member.meta}</span>
                        </span>
                      </button>
                      {status.isAdmin ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          iconOnly
                          icon="edit"
                          className="ws-row-action ws-team-edit"
                          aria-label={`Editar ${member.name}`}
                          title={`Editar ${member.name}`}
                          onClick={() => {
                            if (member.bot) setAgentEdit(member.bot);
                            else if (member.user) setPersonEdit(member.user);
                          }}
                        />
                      ) : null}
                    </div>
                  );
                })}
                {teamMembers.length === 0 ? <p className="ws-dm-note">Ninguém na equipe ainda.</p> : null}
              </div>
            ) : null}
          </section>

          <section className="ws-group" data-open={openSections.dms} {...sectionProps("dms")}>
            <div className="ws-group-head">
              <button
                type="button"
                className="ws-group-toggle"
                aria-expanded={openSections.dms}
                onClick={() => toggleSection("dms")}
              >
                <span className="ws-group-label">Mensagens diretas</span>
                <Icon name="chevronDown" size={14} className="ws-group-chevron" />
              </button>
              {sectionGrip("dms")}
            </div>
            {openSections.dms ? (
              <div className="ws-group-body">
                {visibleDms.length === 0 ? (
                  <p className="ws-dm-note">Suas conversas com pessoas aparecem aqui.</p>
                ) : null}
                {visibleDms.map((room) => (
                  <ListRow
                    key={room.id}
                    className={view === "chat" && selectedRoomId === room.id ? "is-active" : ""}
                    lead={faceOf(room.members.find((member) => member.id !== me?.id), 28)}
                    title={personName(room, me) || room.name}
                    onClick={() => selectRoom(room)}
                  />
                ))}
              </div>
            ) : null}
          </section>
        </div>

        <footer className="ws-user">
          <Menu
            align="start"
            label="Seu status"
            trigger={
              <button
                type="button"
                className="ws-user-profile"
                aria-label={`Seu status: ${MEMBER_STATUS_LABEL[userStatus]}`}
                title="Mudar o seu status"
              >
                <span className="ws-user-face">
                  {userFace ?? <Avatar kind="person" name={userName} size="sm" />}
                  <span className="ws-user-presence" data-status={userStatus} aria-hidden="true" />
                </span>
                <span className="ws-user-copy">
                  <strong>{userName}</strong>
                  <small data-status={userStatus}>
                    <span className="ws-online-dot" aria-hidden="true" />
                    {MEMBER_STATUS_LABEL[userStatus]}
                  </small>
                </span>
              </button>
            }
          >
            <MenuRadioGroup
              label="Seu status"
              value={userStatus}
              onValueChange={(value) => updatePrefs({ userStatus: value })}
              options={(["online", "away", "busy", "offline"] as MemberStatus[]).map((value) => ({
                value,
                label: MEMBER_STATUS_LABEL[value],
                leading: <span className="ws-status-mark" data-status={value} />,
              }))}
            />
          </Menu>
          <div className="ws-user-actions">
            <ThemeToggle className="ws-theme-toggle" />
            <NotificationBell onOpenNotification={openInboxItem} />
          </div>
        </footer>
      </aside>
      )}
      {menuOpen ? (
        <button
          type="button"
          className="ws-backdrop"
          aria-label="Fechar menu"
          onClick={() => setMenuOpen(false)}
        />
      ) : null}

      <div className="ws-work">
      <div className="ws-pages">
      <div className="ws-shell" key={`${view}:${selectedRoomId}`}>
        {view === "chat" ? (
        <header className="ws-main-head">
          <span className="ws-main-face">{faceOf(agent, 32)}</span>
          <span className="ws-main-title">
            <h1>{roomTitle}</h1>
            <p>{roomSubtitle}</p>
          </span>
          <span className="ws-main-actions">
            <div className="ws-chat-search">
              <SearchField
                value={chatQuery}
                onChange={(event) => setChatQuery(event.target.value)}
                placeholder="Buscar nesta conversa"
                size="sm"
                onClear={() => setChatQuery("")}
                clearLabel="Limpar busca"
              />
              <Menu
                align="end"
                label="Filtros"
                trigger={
                  <Button
                    variant="ghost"
                    size="sm"
                    iconOnly
                    icon="filter"
                    className="ws-chat-filter"
                    aria-label="Filtros da conversa"
                  />
                }
              >
                <MenuCheckboxItem
                  checked={linkOnly}
                  onCheckedChange={setLinkOnly}
                  icon="link"
                  description="tem: link, arquivo, imagem ou cartão"
                >
                  Com link, arquivo, imagem ou cartão
                </MenuCheckboxItem>
                <MenuItem icon="filter" description="datas, só agentes, fixadas">
                  Mais filtros
                </MenuItem>
              </Menu>
            </div>
            {selectedRoom?.kind === "room" ? (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  iconOnly
                  icon="members"
                  className="ws-header-channel-action"
                  aria-label="Agentes do canal"
                  onClick={openChannelAgents}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  iconOnly
                  icon="repo"
                  className="ws-header-channel-action"
                  aria-label="Repos do canal"
                  onClick={() => void openRepos()}
                />
              </>
            ) : null}
            <Button
              variant="ghost"
              size="sm"
              iconOnly
              icon="search"
              className="ws-search-toggle"
              aria-label="Buscar"
            />
            <Button
              variant="ghost"
              size="sm"
              iconOnly
              icon="sidebar"
              className="ws-details-toggle"
              aria-label={detailsOpen ? "Ocultar detalhes" : "Mostrar detalhes"}
              onClick={() => setDetailsOpen((value) => !value)}
            />
          </span>
        </header>
        ) : null}

        <div className={`ws-body${view === "chat" && detailsOpen ? "" : " is-details-closed"}`}>
        <section className="ws-main">
        {view === "dev" ? (
          <div className="ws-panel ws-dev-panel">
            {devMode ? (
              <Suspense fallback={null}>
                <Workbench />
              </Suspense>
            ) : null}
          </div>
        ) : null}
        {view === "home" ? (
          <div className="ws-panel ws-home-panel">
            <HomeDashboard
              project={boardProject}
              rooms={allRooms}
              bots={bots}
              me={me}
              userName={userName}
              activeAgents={activeAgents.length}
              onOpenAgent={(bot) => void openAgent(bot)}
              onInviteUser={() => setInviteOpen(true)}
              onOpenCalendar={() => changeView("calendar")}
            />
          </div>
        ) : null}
        {view === "chat" ? (
          <>
            <div className="ws-messages">
              <div className="ws-message-list">
                {messages.length === 0 && agent ? (
                  <Message
                    className="ws-arrival-message"
                    avatar={faceOf(agent, 28)}
                    author={agent.name}
                    time={formatTime(Date.now())}
                    agent
                  >
                    <MessageText>
                      Oi, eu sou {agent.name}. Monto o time com você. Crio os agentes, conecto os
                      apps e convido as pessoas. Nada muda sem você pedir, e eu faço só o que você
                      pode fazer.
                    </MessageText>
                  </Message>
                ) : null}
                <WelcomeCard
                  agentName={agent?.name || "Jeff"}
                  teamName={status.teamName}
                  aiReady={aiModels.length > 0}
                  aiModelCount={aiModels.length}
                  onConnect={() => openSettingsScreen("harness")}
                  onInvite={() => setInviteOpen(true)}
                  onSettings={() => openSettingsScreen("connectors")}
                />
                {visibleMessages
                  .filter((message) => message.text.trim())
                  .map((message, index, list) => {
                    const author = people.get(message.author.id);
                    const previous = list[index - 1];
                    return (
                      <Message
                        key={message.id}
                        avatar={faceOf(author, 28)}
                        author={message.author.name}
                        time={formatTime(message.createdAt)}
                        own={message.author.id === me?.id}
                        agent={message.author.kind === "bot"}
                        grouped={previous?.author.id === message.author.id}
                      >
                        <MessageText>{message.text}</MessageText>
                      </Message>
                    );
                  })}
                <div ref={bottom} />
              </div>
            </div>
            <footer className="ws-composer">
              <Composer
                value={draft}
                onChange={(value) => setDraft(draftKey, value)}
                onSend={(text) => void send(text)}
                label={`Mensagem para ${roomTitle}`}
                placeholder={`Mensagem para ${roomTitle} · nada muda sem você`}
                sendLabel="Enviar"
                attachLabel="Anexar"
                emoji={EMOJI_LABELS}
                inlinePills
                pills={agent ? (
                  <AgentComposerControls
                    agent={agent}
                    models={aiModels}
                    onConnect={() => openSettingsScreen("harness")}
                    onUpdated={(updated) => setBots((current) => current.map((bot) => (bot.id === updated.id ? updated : bot)))}
                  />
                ) : undefined}
              />
            </footer>
          </>
        ) : null}

        {view === "tasks" && selectedRoom ? (
          <div className="ws-panel ws-tasks"><Board project={boardProject} people={people.size ? [...people.values()] : []} onOpenRoom={(id) => {
            const room = allRooms.find((item) => item.id === id);
            if (room) selectRoom(room);
          }} /></div>
        ) : null}
        {view === "drive" ? (
          <div className="ws-panel ws-drive-panel">
            <DrivePanel project={driveProject} />
          </div>
        ) : null}
        {view === "calendar" ? (
          <div className="ws-panel ws-calendar-panel">
            <CalendarPanel
              project={boardProject}
              rooms={allRooms}
              bots={bots}
              people={people.size ? [...people.values()] : []}
              selectedRoomId={selectedRoomId}
            />
          </div>
        ) : null}
        {view === "wiki" ? (
          <div className="ws-panel ws-wiki-panel">
            <WikiPanel project={boardProject} />
          </div>
        ) : null}
        {view === "settings" ? (
          <div className="ws-panel ws-settings-panel">
            <SettingsView
              user={user}
              projectId={boardProject.id}
              section={settingsSection}
              onSection={setSettingsSection}
              onBack={() => setWorkspaceMenuOpen(true)}
              embedded
            />
          </div>
        ) : null}
        {error ? <p className="ws-error">{error}</p> : null}
      </section>

      <aside className="ws-right">
        <div className="ws-agent-hero">
          {faceOf(agent, 64)}
          <h2>{agent?.name || "Jeff"}</h2>
          <p>Seu braço direito</p>
          <span className="ws-agent-status">Offline</span>
        </div>
        {selectedRoom?.kind === "room" ? (
          <div className="ws-right-section">
            <GroupHeading title="Agentes do canal" />
            <div className="ws-repos">
              {selectedChannelAgents.length ? (
                selectedChannelAgents.map((agent) => (
                  <Chip key={agent.id}>{agent.name}</Chip>
                ))
              ) : (
                <p className="ws-muted">Nenhum agente neste canal.</p>
              )}
            </div>
            <Button
              variant="default"
              size="sm"
              icon="members"
              onClick={openChannelAgents}
            >
              Escolher agentes
            </Button>
          </div>
        ) : null}
        {selectedRoom?.kind === "room" ? (
          <div className="ws-right-section">
            <GroupHeading title="Repos do canal" />
            <div className="ws-repos">
              {selectedRoom.repos?.length ? (
                selectedRoom.repos.map((path) => (
                  <Chip key={path}>{path.split("/").pop() || path}</Chip>
                ))
              ) : (
                <p className="ws-muted">Nenhum repo escolhido.</p>
              )}
            </div>
            <Button
              variant="default"
              size="sm"
              icon="repo"
              onClick={() => void openRepos()}
            >
              Escolher repos
            </Button>
          </div>
        ) : null}
        <div className="ws-right-section">
          <GroupHeading title="Computador" />
          <p className="ws-muted">
            Sem computador aqui. O computador do workspace roda todos os agentes como um só usuário.
          </p>
        </div>
        <div className="ws-right-section">
          <GroupHeading title="Como pensa" />
          <ListRow
            lead={<Icon name="brainAgent" size={18} />}
            title="Sua IA"
            meta={agent?.bot?.model || "Ninguém te responde aqui ainda"}
            trailing={<Icon name="chevronRight" size={14} />}
            onClick={() => openSettingsScreen("general")}
          />
        </div>
      </aside>
      </div>
      </div>
      </div>
      </div>
      </>
      )}

      <Toasts />

      <Dialog
        open={channelOpen}
        onOpenChange={setChannelOpen}
        title="Novo canal"
        description="Crie um canal com nome, tópico, categoria e quem participa."
        closeLabel="Fechar"
        width={560}
      >
        <DialogBody className="ws-form">
          <Field label="Nome do canal">
            <Input
              value={channelName}
              onChange={(event) => setChannelName(event.target.value)}
              placeholder="Ex.: marketing"
              autoFocus
            />
          </Field>
          <Field label="Tópico">
            <Input
              value={channelTopic}
              onChange={(event) => setChannelTopic(event.target.value)}
              placeholder="Do que o canal trata?"
            />
          </Field>
          <Field label="Categoria">
            <Select
              value={channelCategoryId ?? ""}
              onValueChange={(value) => {
                if (value === "__new") {
                  setChannelCategoryId(null);
                  setCategoryName("");
                  setCategoryChannels([]);
                  setCategoryOpen(true);
                  return;
                }
                setChannelCategoryId(value || null);
              }}
              placeholder="Sem categoria"
              options={[
                { value: "", label: "Sem categoria" },
                ...categories.map((category) => ({ value: category.id, label: category.name })),
                ...(status.isAdmin
                  ? [{ value: "__new", label: "Nova categoria…", action: true }]
                  : []),
              ]}
            />
          </Field>
          <Field label="Quem pode entrar">
            <Select
              value={channelVisibility}
              onValueChange={(value) =>
                setChannelVisibility(value === "private" ? "private" : "public")
              }
              options={[
                { value: "public", label: "Todos no workspace" },
                { value: "private", label: "Só quem for adicionado" },
              ]}
            />
          </Field>
          <Field label="Membros">
            <div className="ws-member-picker">
              {memberOptions.map((principal) => (
                <label className="ws-picker-row" key={principal.id}>
                  <Checkbox
                    checked={channelMembers.includes(principal.id)}
                    onCheckedChange={() =>
                      setChannelMembers((current) =>
                        current.includes(principal.id)
                          ? current.filter((id) => id !== principal.id)
                          : [...current, principal.id],
                      )
                    }
                  />
                  {faceOf(principal, 28)}
                  <span className="ws-picker-copy">
                    <strong>{principal.name}</strong>
                    <small>{principal.kind === "bot" ? "agente" : "pessoa"}</small>
                  </span>
                </label>
              ))}
              {memberOptions.length === 0 ? (
                <p className="ws-muted">Só você por aqui.</p>
              ) : null}
            </div>
          </Field>
          {error ? <p className="ws-error">{error}</p> : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="default" onClick={() => setChannelOpen(false)}>
            Cancelar
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void createChannel()}>
            Criar canal
          </Button>
        </DialogFooter>
      </Dialog>

      <Dialog
        open={categoryOpen}
        onOpenChange={setCategoryOpen}
        title="Nova categoria"
        description="Agrupe canais na barra lateral."
        closeLabel="Fechar"
        width={480}
      >
        <DialogBody className="ws-form">
          <Field label="Nome da categoria">
            <Input
              value={categoryName}
              onChange={(event) => setCategoryName(event.target.value)}
              placeholder="Ex.: Produto"
              autoFocus
            />
          </Field>
          <Field label="Canais">
            <div className="ws-member-picker">
              {channels.map((room) => (
                <label className="ws-picker-row" key={room.id}>
                  <Checkbox
                    checked={categoryChannels.includes(room.id)}
                    onCheckedChange={() =>
                      setCategoryChannels((current) =>
                        current.includes(room.id)
                          ? current.filter((id) => id !== room.id)
                          : [...current, room.id],
                      )
                    }
                  />
                  <Icon name="channel" size={16} />
                  <span className="ws-picker-copy">
                    <strong>{room.name}</strong>
                    <small>
                      {room.categoryId
                        ? categories.find((category) => category.id === room.categoryId)?.name
                        : "Sem categoria"}
                    </small>
                  </span>
                </label>
              ))}
            </div>
          </Field>
          {error ? <p className="ws-error">{error}</p> : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="default" onClick={() => setCategoryOpen(false)}>
            Cancelar
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void createCategory()}>
            Criar categoria
          </Button>
        </DialogFooter>
      </Dialog>

      <Dialog
        open={renamingCategory !== null}
        onOpenChange={(open) => {
          if (!open) setRenamingCategory(null);
        }}
        title="Renomear categoria"
        closeLabel="Fechar"
        width={420}
      >
        <DialogBody className="ws-form">
          <Field label="Nome da categoria">
            <Input
              value={renameCategoryName}
              onChange={(event) => setRenameCategoryName(event.target.value)}
              autoFocus
            />
          </Field>
          {error ? <p className="ws-error">{error}</p> : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="default" onClick={() => setRenamingCategory(null)}>
            Cancelar
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void renameCategory()}>
            Salvar
          </Button>
        </DialogFooter>
      </Dialog>

      <Dialog
        open={agentOpen}
        onOpenChange={setAgentOpen}
        title="Novo agente"
        description="Escolha um cargo para começar ou escreva as instruções do zero."
        closeLabel="Fechar"
        width={1000}
        className="ws-agent-dialog"
      >
        <DialogBody className="ws-agent-studio">
          <div className="ws-agent-list" role="listbox" aria-label="Cargos do agente">
            <ListRow
              role="option"
              aria-selected={!agentRoleId}
              className={!agentRoleId ? "is-active" : undefined}
              lead={
                <span className="ws-agent-zero">
                  <Icon name="plus" size={16} />
                </span>
              }
              title="Do zero"
              meta="Um agente com as suas próprias instruções."
              onClick={() => {
                setAgentRoleId("");
                setAgentName("");
                setAgentHandle("");
                setAgentTitle("");
                setAgentPersona("");
              }}
            />
            {AGENT_ROLE_GROUPS.map((group) => (
              <Fragment key={group.id}>
                <p className="ws-agent-group">
                  <Icon name={group.icon} size={14} />
                  {group.label}
                </p>
                {group.roles.map((role) => (
                  <ListRow
                    key={role.id}
                    role="option"
                    aria-selected={agentRoleId === role.id}
                    className={agentRoleId === role.id ? "is-active" : undefined}
                    lead={
                      <BotAvatar
                        bot={{ name: role.label, color: role.color, avatar: "jeff-logo" }}
                        size={32}
                        look={false}
                      />
                    }
                    title={role.label}
                    meta={role.description}
                    onClick={() => applyAgentRole(role)}
                  />
                ))}
              </Fragment>
            ))}
          </div>

          <Card className="ws-agent-card">
            <div className="ws-agent-cover">
              <WorkspaceMenuSky />
              <span className="ws-agent-card-hero">
                <BotAvatar
                  bot={{
                    name: agentName || "Novo agente",
                    color: agentRoleById(agentRoleId)?.color ?? "#5AA8FF",
                    avatar: "jeff-logo",
                  }}
                  size={104}
                />
              </span>
              <div className="ws-agent-bubble">
                <p className="ws-agent-hi">
                  Oi, eu sou{" "}
                  <input
                    className="ws-agent-name"
                    value={agentName}
                    maxLength={40}
                    placeholder={agentRoleById(agentRoleId)?.label ?? "novo agente"}
                    aria-label="Nome do agente"
                    autoComplete="off"
                    spellCheck={false}
                    onChange={(event) => setAgentName(event.target.value)}
                  />
                  <span aria-hidden="true">.</span>
                </p>
                <textarea
                  className="ws-agent-what"
                  rows={2}
                  maxLength={160}
                  value={agentTitle}
                  placeholder="O que eu faço?"
                  aria-label="O que ele faz"
                  onChange={(event) => setAgentTitle(event.target.value)}
                />
                <Icon name="edit" size={14} className="ws-agent-pen" />
              </div>
            </div>

            <div className="ws-agent-card__body">
              <label className="ws-agent-handle">
                @
                <input
                  value={agentHandle}
                  maxLength={40}
                  placeholder="handle"
                  aria-label="Handle"
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(event) => setAgentHandle(event.target.value)}
                />
              </label>

              <section className="ws-agent-sec">
                <span className="ws-agent-label">Onde trabalha</span>
                <div className="ws-agent-chips">
                  {channelOptions.length === 0 ? (
                    <span className="ws-agent-none">Nenhum canal ainda.</span>
                  ) : (
                    channelOptions.map((channel) => (
                      <button
                        key={channel.id}
                        type="button"
                        aria-pressed={agentChannels.includes(channel.id)}
                        className="ws-agent-chip"
                        onClick={() =>
                          setAgentChannels((current) =>
                            current.includes(channel.id)
                              ? current.filter((id) => id !== channel.id)
                              : [...current, channel.id],
                          )
                        }
                      >
                        <Icon name="channel" size={14} />
                        {channel.name}
                      </button>
                    ))
                  )}
                </div>
              </section>

              <section className="ws-agent-sec">
                <span className="ws-agent-label">Como pensa</span>
                <div className="ws-agent-thinking">
                  <label className="ws-agent-mini">
                    <span>Engine</span>
                    <Select
                      value={agentEngine}
                      onValueChange={setAgentEngine}
                      options={[
                        { value: "opencode", label: "OpenCode" },
                        { value: "claude", label: "Claude Code" },
                        { value: "codex", label: "Codex" },
                      ]}
                    />
                  </label>
                  <label className="ws-agent-mini">
                    <span>Esforço</span>
                    <Select
                      value={agentEffort}
                      onValueChange={setAgentEffort}
                      placeholder="Padrão"
                      options={[
                        { value: "", label: "Padrão" },
                        { value: "low", label: "Baixo" },
                        { value: "medium", label: "Médio" },
                        { value: "high", label: "Alto" },
                      ]}
                    />
                  </label>
                  <label className="ws-agent-mini">
                    <span>Modelo</span>
                    {aiModels.length > 0 ? (
                      <Select
                        value={agentModel}
                        onValueChange={(value) => {
                          setAgentModel(value);
                          const found = aiModels.find((model) => model.id === value);
                          if (found?.engine) setAgentEngine(found.engine);
                        }}
                        placeholder="Escolha um modelo"
                        options={modelSelectOptions(aiModels)}
                      />
                    ) : (
                      <Button
                        type="button"
                        variant="default"
                        size="sm"
                        disabled={aiModelsLoading}
                        onClick={() => {
                          setAgentOpen(false);
                          openSettingsScreen("harness");
                        }}
                      >
                        {aiModelsLoading ? "Carregando…" : "Conectar IA"}
                      </Button>
                    )}
                  </label>
                </div>
              </section>

              <section className="ws-agent-sec">
                <span className="ws-agent-label">Como trabalha</span>
                <textarea
                  className="ws-agent-instr"
                  rows={4}
                  value={agentPersona}
                  placeholder="Como ele deve trabalhar, o que evitar, o que priorizar…"
                  aria-label="Instruções"
                  onChange={(event) => setAgentPersona(event.target.value)}
                />
              </section>

              {error ? <p className="ws-error">{error}</p> : null}
            </div>
          </Card>
        </DialogBody>
        <DialogFooter note="Ele entra nos canais escolhidos ao ser criado.">
          <Button variant="default" onClick={() => setAgentOpen(false)}>
            Cancelar
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void createAgent()}>
            Criar agente
          </Button>
        </DialogFooter>
      </Dialog>

      <Dialog
        open={channelAgentsOpen}
        onOpenChange={setChannelAgentsOpen}
        title="Agentes do canal"
        description="Quem responde neste canal. Cada um pode trabalhar no seu repo."
        closeLabel="Fechar"
        width={460}
      >
        <DialogBody>
          <div className="ws-repo-list">
            {bots.map((bot) => (
              <label className="ws-repo-option" key={bot.id}>
                <Checkbox
                  checked={draftAgents.includes(bot.id)}
                  onCheckedChange={() =>
                    setDraftAgents((current) =>
                      current.includes(bot.id)
                        ? current.filter((id) => id !== bot.id)
                        : [...current, bot.id],
                    )
                  }
                />
                <span>
                  <strong>{bot.name}</strong>
                  <small>{bot.bot?.title || "agente"}</small>
                </span>
              </label>
            ))}
            {bots.length === 0 ? (
              <p className="ws-muted">Nenhum agente no workspace.</p>
            ) : null}
          </div>
          {agentsError ? <p className="ws-error">{agentsError}</p> : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="default" size="sm" onClick={() => setChannelAgentsOpen(false)}>
            Cancelar
          </Button>
          <Button variant="primary" size="sm" loading={agentsBusy} onClick={() => void saveChannelAgents()}>
            Salvar agentes
          </Button>
        </DialogFooter>
      </Dialog>

      <Dialog
        open={reposOpen}
        onOpenChange={setReposOpen}
        title="Repos do canal"
        description="Escolha um ou mais repositórios disponíveis neste canal."
        closeLabel="Fechar"
        width={520}
      >
        <DialogBody>
          <SearchField
            value={repoQuery}
            onChange={(event) => setRepoQuery(event.target.value)}
            placeholder="Buscar repo…"
            size="sm"
            onClear={() => setRepoQuery("")}
            clearLabel="Limpar busca"
          />
          <div className="ws-repo-list">
            {repoLoading ? <p className="ws-muted">Carregando repos…</p> : null}
            {!repoLoading && repoOptions.map((repo) => (
              <label className="ws-repo-option" key={repo.path}>
                <Checkbox
                  checked={draftRepos.includes(repo.path)}
                  onCheckedChange={() => toggleRepo(repo.path)}
                />
                <span>
                  <strong>{repo.name}</strong>
                  <small>{repo.path}</small>
                </span>
              </label>
            ))}
            {!repoLoading && repoOptions.length === 0 ? (
              <p className="ws-muted">Nenhum repositório encontrado.</p>
            ) : null}
          </div>
          {repoError ? <p className="ws-error">{repoError}</p> : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="default" size="sm" onClick={() => setReposOpen(false)}>
            Cancelar
          </Button>
          <Button variant="primary" size="sm" loading={repoBusy} onClick={() => void saveRepos()}>
            Salvar repos
          </Button>
        </DialogFooter>
      </Dialog>

      <WorkspaceMenu
        open={workspaceMenuOpen}
        onOpenChange={setWorkspaceMenuOpen}
        anchor={workspaceMenuTrigger}
        teamName={status.teamName || "Seu workspace"}
        workspaceLogo={workspaceLogo}
        memberCount={status.memberCount}
        botFaces={bots.map((bot) => ({ id: bot.id, face: faceOf(bot, 20) }))}
        userName={userName}
        user={user}
        isAdmin={status.isAdmin}
        onInvite={() => {
          setWorkspaceMenuOpen(false);
          setInviteOpen(true);
        }}
        onSettings={openSettingsScreen}
      />

      <InviteUserDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        onCreated={() => void refreshTeamUsers()}
      />
      <EditPersonDialog
        user={personEdit}
        channels={channels}
        currentUserId={me?.userId ?? null}
        onClose={() => setPersonEdit(null)}
        onChanged={() => void refreshTeamUsers()}
      />
      <EditAgentDialog
        agent={agentEdit}
        channels={channels}
        models={aiModels}
        onConnect={() => {
          setAgentEdit(null);
          openSettingsScreen("harness");
        }}
        onClose={() => setAgentEdit(null)}
        onSaved={(updated) => {
          setBots((current) => current.map((bot) => (bot.id === updated.id ? updated : bot)));
          void refreshChannels();
        }}
      />

      {loading ? <span className="ws-loading">Carregando workspace…</span> : null}
    </main>
  );
}

/**
 * The quiet sky of the cards that hold a Jeff (the new agent's cover): the same
 * Jeffs of the welcome and onboarding pages, drifting in the lower band with
 * their eyes following the pointer.
 */
function channelInitials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "#";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return words
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function WorkspaceRail({
  workspaceLogo,
  onExpand,
  view,
  onOpenNav,
  isNavActive,
  channels,
  navItems,
  selectedRoomId,
  onSelectRoom,
  onCreateChannel,
  userName,
  userFace,
  userStatus,
  onStatusChange,
  devMode,
  onDev,
  onOpenNotification,
}: {
  workspaceLogo: string;
  onExpand: () => void;
  view: View;
  onOpenNav: (item: NavItem) => void;
  isNavActive: (item: NavItem) => boolean;
  channels: Room[];
  navItems: NavItem[];
  selectedRoomId: string;
  onSelectRoom: (room: Room) => void;
  onCreateChannel: () => void;
  userName: string;
  userFace: ReactNode;
  userStatus: MemberStatus;
  onStatusChange: (status: MemberStatus) => void;
  devMode: boolean;
  onDev: () => void;
  onOpenNotification: (notification: AppNotification) => void;
}) {
  return (
    <aside className="ws-rail">
      <div className="ws-ambient" aria-hidden="true" />
      <button type="button" className="ws-rail-logo" onClick={onExpand} aria-label="Expandir barra">
        <img src={workspaceLogo} alt="" draggable={false} />
      </button>
      {devMode ? (
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          icon="code"
          aria-label="Abrir modo dev"
          title="Abrir modo dev"
          onClick={onDev}
        />
      ) : null}
      <Button
        variant="ghost"
        size="sm"
        iconOnly
        icon="search"
        aria-label="Buscar"
        title="Buscar"
        onClick={onExpand}
      />
      <Button
        variant="ghost"
        size="sm"
        iconOnly
        icon="sidebar"
        aria-label="Expandir barra"
        title="Expandir barra"
        onClick={onExpand}
      />

      <div className="ws-rail-separator" />
      <nav className="ws-rail-nav" aria-label="Workspace">
        {navItems.map((item) => (
          <Button
            key={item.id}
            variant="ghost"
            size="sm"
            iconOnly
            icon={item.icon}
            aria-label={item.label}
            title={item.label}
            className={isNavActive(item) ? "is-active" : ""}
            onClick={() => onOpenNav(item)}
          />
        ))}
      </nav>

      <div className="ws-rail-separator" />
      <div className="ws-rail-channels" aria-label="Canais">
        {channels.slice(0, 4).map((room) => (
          <button
            key={room.id}
            type="button"
            className={`ws-rail-channel${view === "chat" && selectedRoomId === room.id ? " is-active" : ""}`}
            title={`# ${room.name}`}
            onClick={() => onSelectRoom(room)}
          >
            {channelInitials(room.name)}
          </button>
        ))}
      </div>

      <Button
        variant="ghost"
        size="sm"
        iconOnly
        icon="plus"
        aria-label="Criar canal"
        title="Criar canal"
        onClick={onCreateChannel}
      />

      <div className="ws-rail-spacer" />
      <Menu
        align="start"
        label="Seu status"
        trigger={
          <button
            type="button"
            className="ws-rail-user"
            title={`${userName} · ${MEMBER_STATUS_LABEL[userStatus]}`}
            aria-label={`${userName} · ${MEMBER_STATUS_LABEL[userStatus]}`}
          >
            <span className="ws-user-face">
              {userFace}
              <span className="ws-user-presence" data-status={userStatus} aria-hidden="true" />
            </span>
          </button>
        }
      >
        <MenuRadioGroup
          label="Seu status"
          value={userStatus}
          onValueChange={(value) => onStatusChange(value as MemberStatus)}
          options={(["online", "away", "busy", "offline"] as MemberStatus[]).map((value) => ({
            value,
            label: MEMBER_STATUS_LABEL[value],
            leading: <span className="ws-status-mark" data-status={value} />,
          }))}
        />
      </Menu>
      <div className="ws-rail-actions">
        <ThemeToggle className="ws-theme-toggle" />
        <NotificationBell onOpenNotification={onOpenNotification} />
      </div>
    </aside>
  );
}

function WelcomeCard({
  agentName,
  teamName,
  aiReady,
  aiModelCount,
  onConnect,
  onInvite,
  onSettings,
}: {
  agentName: string;
  teamName: string;
  aiReady: boolean;
  aiModelCount: number;
  onConnect: () => void;
  onInvite: () => void;
  onSettings: () => void;
}) {
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteLink, setInviteLink] = useState("");
  const [skippedApps, setSkippedApps] = useState(false);
  const title = teamName
    ? `Para o time da ${teamName} começar a trabalhar`
    : "Para o time começar a trabalhar";

  async function createInviteLink() {
    try {
      const invite = await api.createInvite("member", 30);
      setInviteEmail("");
      setInviteLink(`${window.location.origin}/app/?invite=${encodeURIComponent(invite.token)}`);
    } catch {
      setInviteLink("");
    }
  }

  return (
    <section className="setup-cl ws-welcome" aria-label={title}>
      <div className="setup-cl__head">
        <span className="setup-cl__title">
          <b>{title}</b>
          <small>{agentName} já está por aqui.</small>
        </span>
        <Chip className="setup-cl__count">0 de 3</Chip>
      </div>
      <div className="setup-cl__meter" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
      <ul className="setup-cl__rows">
        <li className="setup-row ac-mediarow ac-mediarow--row">
          <span className="ac-mediarow__face">
            <Icon name="bolt" size={20} />
          </span>
          <span className="ac-mediarow__head">
            <b className="setup-row__title">{aiReady ? "IA conectada." : "Conecte uma IA."}</b>
          </span>
          <span className="ac-mediarow__body setup-row__text">
            <span>{aiReady ? `${aiModelCount} modelos disponíveis.` : "Veja os modelos que você já conectou."}</span>
          </span>
          <span className="ac-mediarow__end ac-mediarow__end--wrap setup-row__act">
            <Button size="sm" onClick={onConnect}>
              {aiReady ? "Ver modelos" : "Conectar"}
            </Button>
          </span>
        </li>
        <li
          className="setup-row ac-mediarow ac-mediarow--row"
          data-done={skippedApps || undefined}
        >
          <span className="ac-mediarow__face">
            {skippedApps ? (
              <span className="setup-row__check">
                <Icon name="check" size={14} />
              </span>
            ) : (
              <Icon name="plug" size={20} />
            )}
          </span>
          <span className="ac-mediarow__head">
            <b className="setup-row__title">Conecte os apps do trabalho.</b>
          </span>
          <span className="ac-mediarow__body setup-row__text">
            <span>Ler nunca muda nada.</span>
          </span>
          {!skippedApps ? (
            <span className="ac-mediarow__end ac-mediarow__end--wrap setup-row__act">
              <Button size="sm" variant="ghost" onClick={() => setSkippedApps(true)}>
                Agora não
              </Button>
              <Button size="sm" onClick={onSettings}>
                Escolher
              </Button>
            </span>
          ) : null}
        </li>
        <li className="setup-row ac-mediarow ac-mediarow--row">
          <span className="ac-mediarow__face">
            <Icon name="personAdd" size={20} />
          </span>
          <span className="ac-mediarow__head">
            <b className="setup-row__title">Chame quem trabalha com você.</b>
          </span>
          <span className="ac-mediarow__body setup-row__text">
            <span>Eles falam com os agentes também.</span>
          </span>
          <span className="ac-mediarow__body setup-row__form">
            <form
              className="setup-invite"
              onSubmit={(event) => {
                event.preventDefault();
                if (inviteEmail.trim()) void createInviteLink();
              }}
            >
              <span className="setup-invite__line">
                <Input
                  type="email"
                  className="setup-invite__email"
                  value={inviteEmail}
                  onChange={(event) => setInviteEmail(event.target.value)}
                  placeholder="nome@empresa.com"
                  aria-label="E-mail de quem você quer convidar"
                />
                <Button
                  type="submit"
                  size="sm"
                  variant="primary"
                  disabled={!inviteEmail.trim()}
                >
                  Enviar
                </Button>
              </span>
              {inviteLink ? (
                <span className="setup-invite__error">
                  Link criado: <code>{inviteLink}</code>
                </span>
              ) : null}
              <span className="setup-invite__more">
                <button type="button" className="ac-link" onClick={onInvite}>
                  Mais opções
                </button>
                <button
                  type="button"
                  className="ac-link"
                  onClick={() => setInviteEmail("")}
                >
                  Agora não
                </button>
              </span>
            </form>
          </span>
        </li>
      </ul>
    </section>
  );
}
