import { useEffect, useRef, useState } from "react";
import {
  Braces,
  ChevronDown,
  Home,
  Database,
  Files,
  GitBranch,
  Globe2,
  MenuBars,
  MessageSquarePlus,
  Search,
  Settings2,
  TerminalSquare,
  UserRound,
  X,
} from "@jeff/icons";
import { api, type Project, type SchemaTable, type WebTarget } from "../../../shared/api";
import { useApp } from "../../store";
import { nativePushToken, requestMobileNotificationPermission } from "../../../features/notifications/notifications";
import { basename, dirname, quoteIdentifier } from "../../../shared/lib";
import BrandMark from "@jeff/brand";
import BrandGlyph from "../../../shared/ui/BrandGlyph";
import BotStudioTab from "../../../features/conversations/components/BotStudioTab";
import DbPanelTab from "../../../features/databases/components/DbPanelTab";
import DiffPanelTab from "../../../features/editor/components/DiffPanelTab";
import EditorPanel from "../../../features/editor/components/EditorPanel";
import WebPanelTab from "../../../features/previews/components/WebPanelTab";
import TerminalPanel from "../../../features/terminal/components/TerminalPanel";
import Toasts from "../../../features/notifications/components/Toasts";
import FilesScreen from "./screens/FilesScreen";
import GitScreen from "./screens/GitScreen";
import DatabasesScreen from "./screens/DatabasesScreen";
import WebAppsScreen from "./screens/WebAppsScreen";
import SessionsScreen from "./screens/SessionsScreen";
import ProjectSwitcher from "../../../features/projects/components/ProjectSwitcher";
import QuickOpen from "../../../features/explorer/components/QuickOpen";
import CloseProjectModal from "../../../features/projects/components/CloseProjectModal";
import { latestChatForJeff, useChats } from "../../../features/conversations/store";
import { ensureJeff } from "../../../features/agents/default-jeff";
import { useJeffDrafts } from "../../../features/agents/drafts";
import MobileBranchSheet from "./MobileBranchSheet";
import MobileAccountSheet from "./MobileAccountSheet";
import { useMobileBack } from "./useMobileBack";
import { Avatar } from "faang-ui";
import JeffSettings from "../../../features/settings/components/JeffSettings";
import ProjectMonogram from "../../../features/projects/components/ProjectMonogram";
import MobileDrawer, { type MobileDrawerRow, type MobileDrawerSection } from "./components/MobileDrawer";
import MobileScreenHeader from "./components/MobileScreenHeader";
import MobileIconButton from "./components/MobileIconButton";
import { MobileEmpty } from "../../../features/workspace/mobile/mobile-ui";

type DevTab = "work" | "jeff" | "files" | "git";
type SettingsSection = "general" | "skills" | "connectors" | "harness" | "workspace";
type Pushed =
  | { kind: "projects" }
  | { kind: "chat" }
  | { kind: "tab"; tabId: string }
  | { kind: "terminal" }
  | { kind: "db" }
  | { kind: "web" };

const TAB_ICONS = {
  editor: Files,
  diff: Files,
  db: Database,
  web: Globe2,
  ai: BrandGlyph,
} as const;

function openSettings(section: SettingsSection) {
  window.dispatchEvent(new CustomEvent("jeff:open-settings", { detail: { section } }));
}

function tabIcon(tab: { kind: keyof typeof TAB_ICONS }) {
  const Glyph = TAB_ICONS[tab.kind];
  return <Glyph className="m-devrow__glyph" />;
}

/** The phone's dev workbench: Discord's shell around the project's tabs, sessions and tools. */
export default function MobileApp() {
  const projects = useApp((state) => state.projects);
  const activeProjectId = useApp((state) => state.activeProjectId);
  const setActiveProject = useApp((state) => state.setActiveProject);
  const tabs = useApp((state) => state.tabs);
  const activeTabId = useApp((state) => state.activeTabId);
  const setActiveTab = useApp((state) => state.setActiveTab);
  const openTab = useApp((state) => state.openTab);
  const closeTab = useApp((state) => state.closeTab);
  const notify = useApp((state) => state.notify);
  const user = useApp((state) => state.user);
  const closeProjectTab = useApp((state) => state.closeProjectTab);
  const project = projects.find((item) => item.id === activeProjectId) ?? null;

  const [tab, setTab] = useState<DevTab>("work");
  const [pushed, setPushed] = useState<Pushed | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sessionFilter, setSessionFilter] = useState("");
  const [branchOpen, setBranchOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchToken, setSearchToken] = useState(0);
  const [closeTarget, setCloseTarget] = useState<Project | null>(null);
  const [closeBusy, setCloseBusy] = useState(false);
  const [closeError, setCloseError] = useState("");
  const [currentBranch, setCurrentBranch] = useState("");
  const pendingBot = useRef<{ projectId: string; botId: string; chatId?: string } | null>(null);
  const chatsHydrated = useChats((state) => activeProjectId ? state.byProject[activeProjectId]?.hydrated === true : false);
  const activeConversationId = useChats((state) => activeProjectId ? state.byProject[activeProjectId]?.activeChatId ?? null : null);
  const activeChat = useChats((state) => activeProjectId && activeConversationId ? state.byProject[activeProjectId]?.chats.find((chat) => chat.id === activeConversationId) ?? null : null);


  useEffect(() => {
    function refreshBranch() {
      if (!project) {
        setCurrentBranch("");
        return;
      }
      api.gitBranches(project.id)
        .then((info) => setCurrentBranch(info.current))
        .catch(() => setCurrentBranch(""));
    }
    refreshBranch();
  }, [project?.id]);

  useEffect(() => {
    const timer = window.setTimeout(() => requestMobileNotificationPermission(), 900);
    let stopped = false;
    let attempts = 0;
    const register = async () => {
      const token = nativePushToken();
      if (!token || stopped) return false;
      try {
        await api.registerPushToken(token, "android");
        return true;
      } catch {
        return false;
      }
    };
    void register();
    const poll = window.setInterval(() => {
      attempts += 1;
      void register().then((registered) => {
        if ((registered || attempts > 20) && !stopped) {
          stopped = true;
          window.clearInterval(poll);
        }
      });
    }, 2500);
    const onToken = (token: string) => {
      if (token) void api.registerPushToken(token, "android").catch(() => undefined);
    };
    (window as unknown as { __jeffPushToken?: (token: string) => void }).__jeffPushToken = onToken;
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      window.clearInterval(poll);
      delete (window as unknown as { __jeffPushToken?: (token: string) => void }).__jeffPushToken;
    };
  }, []);

  useEffect(() => {
    const openBot = (event: Event) => {
      const detail = (event as CustomEvent<{ projectId?: string; botId?: string; chatId?: string }>).detail;
      if (!detail?.projectId) return;
      setActiveProject(detail.projectId);
      const chats = useChats.getState().byProject[detail.projectId];
      if (!chats?.hydrated) {
        pendingBot.current = { projectId: detail.projectId, botId: detail.botId ?? "", chatId: detail.chatId };
        setTab("jeff");
        setPushed({ kind: "chat" });
        return;
      }
      if (detail.chatId && chats.chats.some((chat) => chat.id === detail.chatId)) {
        useChats.getState().setActiveChat(detail.projectId, detail.chatId);
      } else if (detail.botId) {
        const latest = latestChatForJeff(chats, detail.botId)
          ?? useChats.getState().createConversation(detail.projectId, [detail.botId], { name: chats.jeffs.find((jeff) => jeff.id === detail.botId)?.name ?? "" });
        if (latest) useChats.getState().setActiveChat(detail.projectId, latest.id);
      }
      setTab("jeff");
      setPushed({ kind: "chat" });
    };
    const openTerminal = () => setPushed({ kind: "terminal" });
    window.addEventListener("jeff:open-bot", openBot);
    window.addEventListener("jeff:open-chat", openBot);
    window.addEventListener("jeff:open-terminal", openTerminal);
    return () => {
      window.removeEventListener("jeff:open-bot", openBot);
      window.removeEventListener("jeff:open-chat", openBot);
      window.removeEventListener("jeff:open-terminal", openTerminal);
    };
  }, [setActiveProject]);

  useEffect(() => {
    const pending = pendingBot.current;
    if (!pending || pending.projectId !== activeProjectId || !chatsHydrated) return;
    const chats = useChats.getState().byProject[pending.projectId];
    const chat = pending.chatId
      ? chats?.chats.find((item) => item.id === pending.chatId)
      : latestChatForJeff(chats, pending.botId)
        ?? (pending.botId ? useChats.getState().createConversation(pending.projectId, [pending.botId], { name: chats?.jeffs.find((jeff) => jeff.id === pending.botId)?.name ?? "" }) : null);
    if (chat) useChats.getState().setActiveChat(pending.projectId, chat.id);
    pendingBot.current = null;
  }, [activeProjectId, chatsHydrated]);

  useEffect(() => {
    const screen = pushed?.kind === "chat"
      ? "bots"
      : tab === "work"
        ? "workspace"
        : tab === "files"
          ? "files"
          : tab === "git"
            ? "scm"
            : "more";
    useApp.getState().setMobileScreen(screen);
  }, [pushed, tab]);

  useMobileBack(() => {
    if (drawerOpen) {
      setDrawerOpen(false);
      return true;
    }
    if (closeTarget) {
      setCloseTarget(null);
      return true;
    }
    if (searchOpen) {
      setSearchOpen(false);
      return true;
    }
    if (branchOpen) {
      setBranchOpen(false);
      return true;
    }
    if (accountOpen) {
      setAccountOpen(false);
      return true;
    }
    if (pushed) {
      setPushed(null);
      return true;
    }
    if (tab !== "work") {
      setTab("work");
      return true;
    }
    return false;
  });

  function selectProject(id: string) {
    useApp.getState().markProjectNotificationsRead(id);
    setActiveProject(id);
    setPushed(null);
    setTab("work");
  }

  function openDrawer() {
    setDrawerOpen(true);
  }

  function closeDrawer() {
    setDrawerOpen(false);
  }

  function selectTab(next: DevTab) {
    setTab(next);
    setPushed(null);
    setDrawerOpen(false);
  }

  function openProjectSheet() {
    setPushed({ kind: "projects" });
    setDrawerOpen(false);
  }

  function openChat(chatId?: string | null) {
    if (project && chatId) {
      useApp.getState().markChatNotificationsRead(chatId);
      useChats.getState().setActiveChat(project.id, chatId);
      useChats.getState().touchConversation(project.id, chatId);
    }
    setTab("jeff");
    setPushed({ kind: "chat" });
    setDrawerOpen(false);
  }

  function newTask() {
    if (!project) return;
    const jeff = ensureJeff(project.id);
    if (!jeff) return;
    const created = useChats.getState().createConversation(project.id, [jeff.id]);
    if (created) openChat(created.id);
  }

  function pushTab(tabId: string) {
    setActiveTab(tabId);
    setPushed({ kind: "tab", tabId });
  }

  function openFile(path: string, line?: number) {
    if (!project) return;
    const id = `editor:${project.id}:${path}`;
    openTab({
      id,
      kind: "editor",
      title: basename(path),
      projectId: project.id,
      path,
      line,
    });
    pushTab(id);
  }

  function openTable(profileId: string, table: SchemaTable, driver: string) {
    if (!project) return;
    const schema = table.schema;
    let sql = "";
    if (driver === "mongodb") {
      sql = JSON.stringify({ database: schema, collection: table.name, filter: {}, limit: 100 }, null, 2);
    } else if (driver === "redis") {
      sql = "SCAN 0 COUNT 100";
    } else if (driver === "elasticsearch") {
      sql = JSON.stringify({ index: table.name, body: { query: { match_all: {} }, size: 100 } }, null, 2);
    } else if (driver === "neo4j") {
      sql = `MATCH (n:${table.name}) RETURN n LIMIT 100;`;
    } else if (driver === "cassandra") {
      sql = `SELECT * FROM ${schema}.${table.name} LIMIT 100;`;
    } else {
      sql = `SELECT * FROM ${quoteIdentifier(driver, schema, table.name)} LIMIT 100;`;
    }
    const editable = !["mongodb", "redis", "elasticsearch", "neo4j", "cassandra"].includes(driver);
    const id = `db:table:${project.id}:${profileId}:${schema}.${table.name}`;
    openTab({
      id,
      kind: "db",
      title: table.name,
      projectId: project.id,
      profileId,
      sql,
      autoRun: true,
      table: editable
        ? {
            schema,
            name: table.name,
            primary: table.columns.filter((column) => column.primary).map((column) => column.name),
          }
        : undefined,
    });
    pushTab(id);
  }

  function openDiff(path: string, staged: boolean) {
    if (!project) return;
    const id = `diff:${project.id}:${staged ? "staged" : "worktree"}:${path}`;
    openTab({
      id,
      kind: "diff",
      title: basename(path),
      projectId: project.id,
      path,
      staged,
    });
    pushTab(id);
  }

  function openWeb(target: WebTarget) {
    if (!project) return;
    const id = `web:${project.id}:${target.id}`;
    openTab({
      id,
      kind: "web",
      title: target.name,
      projectId: project.id,
      url: target.url,
    });
    pushTab(id);
  }

  function requestCloseProject(id: string) {
    const target = projects.find((item) => item.id === id);
    if (!target) return;
    setPushed(null);
    setCloseError("");
    setCloseTarget(target);
  }

  async function confirmCloseProject() {
    if (!closeTarget || closeBusy) return;
    const id = closeTarget.id;
    const target = closeTarget;
    setCloseBusy(true);
    setCloseError("");
    try {
      const result = await api.closeProject(id);
      useChats.getState().forget(id);
      useJeffDrafts.getState().clearProject(id);
      closeProjectTab(id);
      setCloseTarget(null);
      const count = result.processes.length;
      notify("info", `Repo ${target.name} fechado. ${count} processo${count === 1 ? "" : "s"} encerrado${count === 1 ? "" : "s"}.`);
      if (result.failed.length > 0) {
        notify("error", `${result.failed.length} processo${result.failed.length === 1 ? "" : "s"} não puderam ser encerrados.`);
      }
    } catch (error) {
      setCloseError(error instanceof Error ? error.message : "Não foi possível fechar o repo.");
    } finally {
      setCloseBusy(false);
    }
  }

  function openWorkspace() {
    window.location.assign(window.location.pathname);
  }

  if (!project) {
    return (
      <main className="m-app m-app--picker">
        <header className="m-pickerhead">
          <BrandMark size="large" />
          <strong>Escolha um repo</strong>
          <p>O workbench abre no projeto que você escolher.</p>
        </header>
        <div className="m-pickerbody">
          <ProjectSwitcher onSelect={selectProject} heading="Repos" />
          <button type="button" className="m-wideaction" onClick={openWorkspace}>
            <Home className="m-wideaction__icon" />
            Voltar ao workspace
          </button>
        </div>
        <Toasts />
      </main>
    );
  }

  const repo = project;

  const projectLead = (
    <button type="button" className="m-devproject" onClick={openDrawer} aria-label={`Abrir navegação. ${repo.name}`}>
      <ProjectMonogram project={repo} size={32} />
      <span className="m-devproject__copy">
        <strong>{repo.name}</strong>
        <small>{currentBranch || repo.root}</small>
      </span>
      <ChevronDown className="m-devproject__chevron" />
    </button>
  );

  const menuLead = <MobileIconButton icon={MenuBars} label="Abrir navegação" onClick={openDrawer} />;

  function drawerRow(
    id: string,
    label: string,
    icon: React.ReactNode,
    onSelect: () => void,
    options: Partial<Pick<MobileDrawerRow, "hint" | "active" | "danger">> = {},
  ): MobileDrawerRow {
    return { id, label, icon, onSelect, ...options };
  }

  function pushTool(kind: "terminal" | "db" | "web") {
    setPushed({ kind });
    setDrawerOpen(false);
  }

  const drawerSections: MobileDrawerSection[] = [
    {
      id: "nav",
      rows: [
        drawerRow("work", "Trabalho", <Braces className="m-drawer__glyph" />, () => selectTab("work"), { active: tab === "work" && !pushed }),
        drawerRow("jeff", "Jeff", <BrandGlyph size={17} className="m-drawer__glyph" />, () => selectTab("jeff"), { active: tab === "jeff" && !pushed, hint: "Sessões e conversas" }),
        drawerRow("files", "Arquivos", <Files className="m-drawer__glyph" />, () => selectTab("files"), { active: tab === "files" && !pushed }),
        drawerRow("git", "Git", <GitBranch className="m-drawer__glyph" />, () => selectTab("git"), { active: tab === "git" && !pushed, hint: currentBranch || "mudanças" }),
      ],
    },
    {
      id: "tools",
      label: "Ferramentas",
      rows: [
        drawerRow("terminal", "Terminal", <TerminalSquare className="m-drawer__glyph" />, () => pushTool("terminal"), { hint: "Shell do repo" }),
        drawerRow("db", "Bancos", <Database className="m-drawer__glyph" />, () => pushTool("db"), { hint: "Conexões e queries" }),
        drawerRow("web", "Web apps", <Globe2 className="m-drawer__glyph" />, () => pushTool("web"), { hint: "Sites e previews" }),
      ],
    },
    {
      id: "project",
      label: "Projeto",
      rows: [
        drawerRow("new-task", "Nova tarefa", <MessageSquarePlus className="m-drawer__glyph" />, () => { closeDrawer(); newTask(); }),
        drawerRow("repos", "Repos", <GitBranch className="m-drawer__glyph" />, openProjectSheet, { hint: "Abrir ou fechar" }),
        drawerRow("branch", "Branch", <GitBranch className="m-drawer__glyph" />, () => { closeDrawer(); setBranchOpen(true); }, { hint: currentBranch || "Trocar ou criar" }),
      ],
    },
    {
      id: "app",
      label: "App",
      rows: [
        drawerRow("settings", "Configurações", <Settings2 className="m-drawer__glyph" />, () => { closeDrawer(); openSettings("general"); }, { hint: "Conta, skills, MCP e harness" }),
        drawerRow("account", "Conta", <UserRound className="m-drawer__glyph" />, () => { closeDrawer(); setAccountOpen(true); }, { hint: user?.username ?? "Sessão e servidor" }),
        drawerRow("workspace", "Voltar ao workspace", <Home className="m-drawer__glyph" />, openWorkspace, { hint: "Canais, tarefas e calendário" }),
      ],
    },
  ];

  function tabHeader() {
    if (tab === "work") {
      return (
        <MobileScreenHeader
          variant="workspace"
          lead={projectLead}
          actions={
            <>
              <MobileIconButton icon={Search} label="Buscar arquivos" onClick={() => { setSearchOpen(true); setSearchToken((token) => token + 1); }} />
              <MobileIconButton icon={MessageSquarePlus} label="Nova tarefa" onClick={newTask} />
            </>
          }
        />
      );
    }
    if (tab === "jeff") {
      return (
        <MobileScreenHeader
          title="Jeff"
          subtitle={`Tarefas do repo · ${repo.name}`}
          lead={
            <span className="m-header__leadrow">
              {menuLead}
              <span className="m-devface"><BrandGlyph size={22} /></span>
            </span>
          }
          actions={<MobileIconButton icon={MessageSquarePlus} label="Nova tarefa" onClick={newTask} />}
        />
      );
    }
    if (tab === "files") {
      return (
        <MobileScreenHeader
          title="Arquivos"
          subtitle={repo.name}
          lead={menuLead}
          actions={<MobileIconButton icon={Search} label="Buscar arquivos" onClick={() => { setSearchOpen(true); setSearchToken((token) => token + 1); }} />}
        />
      );
    }
    return (
      <MobileScreenHeader
        title="Git"
        subtitle={currentBranch || repo.name}
        lead={menuLead}
        actions={<MobileIconButton icon={GitBranch} label="Trocar branch" onClick={() => setBranchOpen(true)} />}
      />
    );
  }

  function tabBody() {
    if (tab === "work") {
      return (
        <div className="m-devwork">
          <div className="m-quickgrid">
            <button type="button" className="m-quick" onClick={newTask}>
              <MessageSquarePlus className="m-quick__glyph" />
              <span>Nova tarefa</span>
            </button>
            <button type="button" className="m-quick" onClick={() => setTab("files")}>
              <Files className="m-quick__glyph" />
              <span>Arquivos</span>
            </button>
            <button type="button" className="m-quick" onClick={() => setPushed({ kind: "terminal" })}>
              <TerminalSquare className="m-quick__glyph" />
              <span>Terminal</span>
            </button>
            <button type="button" className="m-quick" onClick={() => setTab("git")}>
              <GitBranch className="m-quick__glyph" />
              <span>Git</span>
            </button>
          </div>
          <header className="m-blockhead">
            <div>
              <h2>Abas abertas</h2>
              <p>O que está aberto neste repo.</p>
            </div>
          </header>
          <div className="m-devtablist">
            {tabs.map((item) => (
              <div key={item.id} className="m-devrowwrap" data-active={item.id === activeTabId || undefined}>
                <button type="button" className="m-devrow" onClick={() => pushTab(item.id)}>
                  <span className="m-devrow__icon">{tabIcon(item)}</span>
                  <span className="m-devrow__copy">
                    <strong>{item.title}</strong>
                    <small>
                      {item.kind === "editor" && item.path
                        ? dirname(item.path) || "raiz"
                        : item.kind === "diff"
                          ? "alterações"
                          : item.kind === "db"
                            ? "consulta"
                            : item.kind === "web"
                              ? "web app"
                              : "conversa"}
                    </small>
                  </span>
                  {item.dirty ? <span className="m-devrow__dirty" title="Não salvo" /> : null}
                </button>
                <MobileIconButton icon={X} label={`Fechar ${item.title}`} className="m-row__action" onClick={() => closeTab(item.id)} />
              </div>
            ))}
            {tabs.length === 0 ? (
              <MobileEmpty icon={<Files className="m-empty__glyph" />} title="Nenhuma aba aberta">
                Abra um arquivo, um banco ou um web app para começar.
              </MobileEmpty>
            ) : null}
          </div>
          <div className="m-scroll__end" />
        </div>
      );
    }
    if (tab === "jeff") {
      return (
        <SessionsScreen
          project={repo}
          filter={sessionFilter}
          onFilter={setSessionFilter}
          onOpenChat={(chatId) => openChat(chatId)}
        />
      );
    }
    if (tab === "files") {
      return <FilesScreen project={repo} onOpenFile={openFile} />;
    }
    if (tab === "git") {
      return (
        <GitScreen
          project={repo}
          branch={currentBranch}
          onOpenDiff={openDiff}
          onBranch={() => setBranchOpen(true)}
        />
      );
    }
    return null;
  }

  function pushedScreen() {
    if (!pushed) return null;
    if (pushed.kind === "projects") {
      return (
        <div className="m-screen">
          <MobileScreenHeader title="Repos" subtitle="Trocar de projeto" onBack={() => setPushed(null)} />
          <div className="m-pushed__body">
            <ProjectSwitcher
              heading="Repos abertos"
              onSelect={selectProject}
              onCloseProject={requestCloseProject}
            />
            <button type="button" className="m-wideaction" onClick={openWorkspace}>
              <Home className="m-wideaction__icon" />
              Voltar ao workspace
            </button>
          </div>
        </div>
      );
    }
    if (pushed.kind === "chat") {
      const chatTitle = activeChat?.name?.trim() || "Nova tarefa";
      return (
        <div className="m-screen m-screen--chat">
          <MobileScreenHeader
            onBack={() => setPushed(null)}
            backLabel="Voltar às tarefas"
            lead={<span className="m-devface"><BrandGlyph size={22} /></span>}
            title={chatTitle}
            subtitle={`${repo.name} · ${currentBranch || "repo"}`}
            actions={<MobileIconButton icon={MessageSquarePlus} label="Nova tarefa" onClick={newTask} />}
          />
          {activeConversationId ? (
            <BotStudioTab
              key={activeConversationId}
              project={repo}
              conversationId={activeConversationId}
              mobile
              onOpenFile={openFile}
            />
          ) : (
            <MobileEmpty icon={<BrandGlyph size={22} />} title="Nenhuma sessão aberta">
              Escolha uma tarefa na lista ou comece uma nova.
            </MobileEmpty>
          )}
        </div>
      );
    }
    if (pushed.kind === "terminal") {
      return (
        <div className="m-screen">
          <MobileScreenHeader title="Terminal" subtitle={repo.name} onBack={() => setPushed(null)} />
          <div className="m-pushed__body m-pushed__body--terminal">
            <TerminalPanel project={repo} onOpenFile={openFile} sheet onClose={() => setPushed(null)} />
          </div>
        </div>
      );
    }
    if (pushed.kind === "db") {
      return (
        <div className="m-screen">
          <MobileScreenHeader title="Bancos" subtitle={repo.name} onBack={() => setPushed(null)} />
          <div className="m-pushed__body m-pushed__body--panel">
            <DatabasesScreen project={repo} onOpenTable={openTable} />
          </div>
        </div>
      );
    }
    if (pushed.kind === "web") {
      return (
        <div className="m-screen">
          <MobileScreenHeader title="Web apps" subtitle={repo.name} onBack={() => setPushed(null)} />
          <div className="m-pushed__body m-pushed__body--panel">
            <WebAppsScreen onOpenWeb={openWeb} />
          </div>
        </div>
      );
    }
    const item = tabs.find((entry) => entry.id === pushed.tabId);
    if (!item) return null;
    return (
      <div className="m-screen">
        <MobileScreenHeader
          title={item.title}
          subtitle={repo.name}
          onBack={() => setPushed(null)}
          actions={
            <MobileIconButton
              icon={X}
              label={`Fechar ${item.title}`}
              onClick={() => {
                closeTab(item.id);
                setPushed(null);
              }}
            />
          }
        />
        <div className="m-pushed__body m-pushed__body--panel m-tabview">
          {item.kind === "editor" ? <EditorPanel tab={item} project={repo} mobile onOpenChanges={(path) => openDiff(path, false)} /> : null}
          {item.kind === "db" ? <DbPanelTab tab={item} /> : null}
          {item.kind === "web" ? <WebPanelTab tab={item} /> : null}
          {item.kind === "diff" ? <DiffPanelTab tab={item} project={repo} mobile /> : null}
          {item.kind === "ai" && item.chatId ? <BotStudioTab project={repo} conversationId={item.chatId} mobile onOpenFile={openFile} /> : null}
        </div>
      </div>
    );
  }

  return (
    <div className="m-app">
      <div className="m-app__body">
        {pushed ? (
          pushedScreen()
        ) : (
          <div className="m-screen" key={tab}>
            {tabHeader()}
            <div className="m-app__content">{tabBody()}</div>
          </div>
        )}
      </div>
      <MobileDrawer
        open={drawerOpen}
        onClose={closeDrawer}
        title={repo.name}
        meta={currentBranch || repo.root}
        mark={<ProjectMonogram project={repo} size={40} />}
        sections={drawerSections}
        footer={
          <div className="m-profilebar">
            <button
              type="button"
              className="m-profilebar__me"
              onClick={() => {
                closeDrawer();
                setAccountOpen(true);
              }}
            >
              <span className="m-profilebar__face">
                <Avatar name={user?.displayName || user?.username || "Conta"} size="sm" />
              </span>
              <span className="m-profilebar__copy">
                <strong>{user?.displayName || user?.username || "Conta"}</strong>
                <small>{repo.name}</small>
              </span>
            </button>
          </div>
        }
      />

      <MobileBranchSheet
        open={branchOpen}
        projectId={repo.id}
        onClose={() => setBranchOpen(false)}
        onChanged={() => {
          api.gitBranches(repo.id).then((info) => setCurrentBranch(info.current)).catch(() => undefined);
        }}
      />
      <MobileAccountSheet open={accountOpen} user={user} onClose={() => setAccountOpen(false)} />
      <JeffSettings user={user} projectRoot={repo.root} projectId={repo.id} hideTrigger />

      {searchOpen ? (
        <div
          className="mobile-search-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Buscar"
          onMouseDown={(event) => { if (event.target === event.currentTarget) setSearchOpen(false); }}
          onKeyDown={(event) => { if (event.key === "Escape") setSearchOpen(false); }}
        >
          <div className="mobile-search-card">
            <QuickOpen
              project={repo}
              focusToken={searchToken}
              onOpenFile={(path, line) => { setSearchOpen(false); openFile(path, line); }}
              floating
            />
          </div>
        </div>
      ) : null}
      <CloseProjectModal
        open={Boolean(closeTarget)}
        project={closeTarget}
        busy={closeBusy}
        error={closeError}
        mobile
        onClose={() => { if (!closeBusy) setCloseTarget(null); }}
        onConfirm={() => void confirmCloseProject()}
      />
      <Toasts />
    </div>
  );
}
