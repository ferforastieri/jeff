import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Database,
  Files,
  GitBranch,
  GitPullRequest,
  Globe2,
  Home,
  MenuBars,
  MessageSquarePlus,
  Search,
  TerminalSquare,
  X,
} from "@jeff/icons";
import { api, type Project, type SchemaTable, type WebTarget } from "../../../shared/api";
import { useApp } from "../../../app/store";
import { basename, dirname, quoteIdentifier } from "../../../shared/lib";
import BrandGlyph from "../../../shared/ui/BrandGlyph";
import ProjectSwitcher from "../../projects/components/ProjectSwitcher";
import { latestChatForJeff, useChats } from "../../conversations/store";
import { ensureJeff } from "../../agents/default-jeff";
import SessionsScreen from "../../../app/layouts/mobile/screens/SessionsScreen";
import FilesScreen from "../../../app/layouts/mobile/screens/FilesScreen";
import GitScreen from "../../../app/layouts/mobile/screens/GitScreen";
import DatabasesScreen from "../../../app/layouts/mobile/screens/DatabasesScreen";
import WebAppsScreen from "../../../app/layouts/mobile/screens/WebAppsScreen";
import MobileScreenHeader from "../../../app/layouts/mobile/components/MobileScreenHeader";
import MobileIconButton from "../../../app/layouts/mobile/components/MobileIconButton";
import MobileBranchSheet from "../../../app/layouts/mobile/MobileBranchSheet";
import EditorPanel from "../../editor/components/EditorPanel";
import DbPanelTab from "../../databases/components/DbPanelTab";
import WebPanelTab from "../../previews/components/WebPanelTab";
import DiffPanelTab from "../../editor/components/DiffPanelTab";
import BotStudioTab from "../../conversations/components/BotStudioTab";
import TerminalPanel from "../../terminal/components/TerminalPanel";
import QuickOpen from "../../explorer/components/QuickOpen";
import { MobileEmpty } from "./mobile-ui";

export type WorkspaceDevEntry =
  | "work"
  | "sessions"
  | "files"
  | "git"
  | "terminal"
  | "databases"
  | "web"
  | "projects";

type Pushed = null | { kind: "chat" } | { kind: "tab"; tabId: string };

interface Props {
  entry: WorkspaceDevEntry;
  token: number;
  /** A notification lands on the exact conversation, not just on the list. */
  initialChat?: { projectId?: string; chatId?: string; botId?: string } | null;
  /** Lets the Android back button close this surface's own layers first. */
  onBackRef: { current: (() => boolean) | null };
  onMenu: () => void;
  onExit: () => void;
  onEntry: (entry: WorkspaceDevEntry) => void;
}


const TAB_ICONS = {
  editor: Files,
  diff: Files,
  db: Database,
  web: Globe2,
  ai: BrandGlyph,
} as const;

function tabIcon(kind: keyof typeof TAB_ICONS) {
  const Glyph = TAB_ICONS[kind];
  return <Glyph className="m-devrow__glyph" />;
}

/** The phone's dev tools inside the Slack drawer: same shell, no separate mode. */
export default function WorkspaceDevMobile({ entry, token, initialChat, onBackRef, onMenu, onExit, onEntry }: Props) {
  const projects = useApp((state) => state.projects);
  const activeProjectId = useApp((state) => state.activeProjectId);
  const setActiveProject = useApp((state) => state.setActiveProject);
  const tabs = useApp((state) => state.tabs);
  const activeTabId = useApp((state) => state.activeTabId);
  const setActiveTab = useApp((state) => state.setActiveTab);
  const openTab = useApp((state) => state.openTab);
  const closeTab = useApp((state) => state.closeTab);
  const closeProjectTab = useApp((state) => state.closeProjectTab);
  const notify = useApp((state) => state.notify);
  const project = projects.find((item) => item.id === activeProjectId) ?? null;
  const chats = useChats((state) => (activeProjectId ? state.byProject[activeProjectId] : undefined));
  const activeChat = chats?.chats.find((chat) => chat.id === chats.activeChatId) ?? null;
  const [screen, setScreen] = useState<WorkspaceDevEntry>(entry);
  const [pushed, setPushed] = useState<Pushed>(null);
  const [currentBranch, setCurrentBranch] = useState("");
  const [sessionFilter, setSessionFilter] = useState("");
  const [branchOpen, setBranchOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchToken, setSearchToken] = useState(0);
  const projectTabs = useMemo(() => (project ? tabs.filter((tab) => tab.projectId === project.id) : []), [project, tabs]);

  useEffect(() => {
    setScreen(entry);
    setPushed(null);
  }, [entry, token]);

  // A notification lands on the exact conversation, once the project layout
  // hydrates the chat list. The token reopens it on every dev entry.
  useEffect(() => {
    const projectId = project?.id;
    if (!projectId || !initialChat || (!initialChat.chatId && !initialChat.botId)) return;
    if (initialChat.projectId && initialChat.projectId !== projectId) return;
    let cancelled = false;
    let stop: (() => void) | undefined;
    const tryOpen = () => {
      if (cancelled) return false;
      const snapshot = useChats.getState().byProject[projectId];
      const chatId = initialChat.chatId
        ?? (initialChat.botId ? latestChatForJeff(snapshot, initialChat.botId)?.id : undefined);
      if (!chatId) return false;
      openChat(chatId);
      return true;
    };
    useChats.getState().ensure(projectId);
    if (!tryOpen()) {
      stop = useChats.subscribe(() => {
        if (cancelled) return;
        if (tryOpen()) stop?.();
      });
    }
    return () => {
      cancelled = true;
      stop?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialChat, token, project?.id]);

  // A closed tab must not leave the pushed screen pointing at nothing.
  useEffect(() => {
    if (pushed?.kind !== "tab") return;
    if (!project || !projectTabs.some((tab) => tab.id === pushed.tabId)) setPushed(null);
  }, [pushed, project, projectTabs]);

  useEffect(() => {
    onBackRef.current = () => {
      if (searchOpen) {
        setSearchOpen(false);
        return true;
      }
      if (branchOpen) {
        setBranchOpen(false);
        return true;
      }
      if (pushed) {
        setPushed(null);
        return true;
      }
      return false;
    };
    return () => { onBackRef.current = null; };
  }, [branchOpen, onBackRef, pushed, searchOpen]);

  useEffect(() => {
    useApp.getState().setMobileScreen(pushed?.kind === "chat" ? "bots" : "more");
  }, [pushed]);

  useEffect(() => () => {
    useApp.getState().setMobileScreen("more");
  }, []);

  useEffect(() => {
    if (!project) {
      setCurrentBranch("");
      return;
    }
    api.gitBranches(project.id)
      .then((info) => setCurrentBranch(info.current))
      .catch(() => setCurrentBranch(""));
  }, [project?.id]);

  function selectProject(id: string) {
    setActiveProject(id);
    setPushed(null);
    setScreen("work");
    onEntry("work");
  }

  function go(next: WorkspaceDevEntry) {
    setScreen(next);
    onEntry(next);
  }

  async function closeProject(id: string) {
    const target = projects.find((item) => item.id === id);
    if (!target) return;
    if (!window.confirm(`Fechar ${target.name}? Os terminais e processos deste repo serão encerrados.`)) return;
    try {
      await api.closeProject(id);
      useChats.getState().forget(id);
      closeProjectTab(id);
      notify("info", `Repo ${target.name} fechado.`);
      if (activeProjectId === id) setScreen("projects");
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "Não foi possível fechar o repo.");
    }
  }

  function openChat(chatId: string) {
    if (!project) return;
    setActiveProject(project.id);
    useApp.getState().markChatNotificationsRead(chatId);
    useChats.getState().setActiveChat(project.id, chatId);
    useChats.getState().touchConversation(project.id, chatId);
    setPushed({ kind: "chat" });
  }

  function newTask() {
    if (!project) return;
    const jeff = ensureJeff(project.id);
    if (!jeff) return;
    const created = useChats.getState().createConversation(project.id, [jeff.id]);
    if (created) openChat(created.id);
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
    setPushed({ kind: "tab", tabId: id });
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
    setPushed({ kind: "tab", tabId: id });
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
    setPushed({ kind: "tab", tabId: id });
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
    setPushed({ kind: "tab", tabId: id });
  }

  function openSearch() {
    setSearchOpen(true);
    setSearchToken((value) => value + 1);
  }

  const menuButton = <MobileIconButton icon={MenuBars} label="Abrir navegação" onClick={onMenu} />;
  const homeButton = <MobileIconButton icon={Home} label="Voltar ao workspace" onClick={onExit} />;

  function header(title: string, subtitle: string, actions: ReactNode = null) {
    return (
      <MobileScreenHeader
        title={title}
        subtitle={subtitle}
        lead={menuButton}
        actions={
          <>
            {title === "Arquivos" || title === "Trabalho" ? (
              <MobileIconButton icon={Search} label="Buscar arquivos" onClick={openSearch} />
            ) : null}
            {actions}
            {homeButton}
          </>
        }
      />
    );
  }

  function workScreen() {
    return (
      <div className="m-screen">
        {header("Trabalho", project?.name ?? "Abrir repo")}
        <div className="m-devwork">
          <div className="m-quickgrid">
            <button type="button" className="m-quick" onClick={newTask}>
              <MessageSquarePlus className="m-quick__glyph" />
              <span>Nova tarefa</span>
            </button>
            <button type="button" className="m-quick" onClick={() => go("files")}>
              <Files className="m-quick__glyph" />
              <span>Arquivos</span>
            </button>
            <button type="button" className="m-quick" onClick={() => go("terminal")}>
              <TerminalSquare className="m-quick__glyph" />
              <span>Terminal</span>
            </button>
            <button type="button" className="m-quick" onClick={() => go("git")}>
              <GitBranch className="m-quick__glyph" />
              <span>Git</span>
            </button>
            <button type="button" className="m-quick" onClick={() => go("projects")}>
              <GitBranch className="m-quick__glyph" />
              <span>Repos</span>
            </button>
            <button type="button" className="m-quick" onClick={() => setBranchOpen(true)}>
              <GitPullRequest className="m-quick__glyph" />
              <span>Branch</span>
            </button>
          </div>
          <header className="m-blockhead">
            <div>
              <h2>Abas abertas</h2>
              <p>O que está aberto neste repo.</p>
            </div>
          </header>
          <div className="m-devtablist">
            {projectTabs.map((item) => (
              <div key={item.id} className="m-devrowwrap" data-active={item.id === activeTabId || undefined}>
                <button type="button" className="m-devrow" onClick={() => { setActiveTab(item.id); setPushed({ kind: "tab", tabId: item.id }); }}>
                  <span className="m-devrow__icon">{tabIcon(item.kind)}</span>
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
            {projectTabs.length === 0 ? (
              <MobileEmpty icon={<Files className="m-empty__glyph" />} title="Nenhuma aba aberta">
                Abra um arquivo, um banco ou um web app para começar.
              </MobileEmpty>
            ) : null}
          </div>
          <div className="m-scroll__end" />
        </div>
      </div>
    );
  }

  function pushedScreen() {
    if (pushed?.kind === "chat") {
      const activeChatId = chats?.activeChatId ?? null;
      return (
        <div className="m-screen">
          <MobileScreenHeader
            onBack={() => setPushed(null)}
            backLabel="Voltar"
            lead={<span className="m-devface"><BrandGlyph size={22} /></span>}
            title={activeChat?.name?.trim() || "Nova tarefa"}
            subtitle={`${project?.name ?? ""} · ${currentBranch || "repo"}`}
            actions={<MobileIconButton icon={MessageSquarePlus} label="Nova tarefa" onClick={newTask} />}
          />
          {project && activeChatId ? (
            <BotStudioTab
              key={activeChatId}
              project={project}
              conversationId={activeChatId}
              mobile
              onOpenFile={openFile}
            />
          ) : (
            <MobileEmpty title="Nenhuma sessão aberta">Escolha uma tarefa na lista.</MobileEmpty>
          )}
        </div>
      );
    }
    const item = pushed?.kind === "tab" ? projectTabs.find((tab) => tab.id === pushed.tabId) : null;
    if (!item || !project) return null;
    return (
      <div className="m-screen">
        <MobileScreenHeader
          title={item.title}
          subtitle={project.name}
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
          {item.kind === "editor" ? <EditorPanel tab={item} project={project} mobile onOpenChanges={(path) => openDiff(path, false)} /> : null}
          {item.kind === "db" ? <DbPanelTab tab={item} /> : null}
          {item.kind === "web" ? <WebPanelTab tab={item} /> : null}
          {item.kind === "diff" ? <DiffPanelTab tab={item} project={project} mobile /> : null}
          {item.kind === "ai" && item.chatId ? <BotStudioTab project={project} conversationId={item.chatId} mobile onOpenFile={openFile} /> : null}
        </div>
      </div>
    );
  }

  function body() {
    if (!project) {
      return (
        <div className="m-screen">
          {header("Repos", "Escolha um repo para abrir o workbench")}
          <div className="m-pushed__body">
            <ProjectSwitcher onSelect={selectProject} onCloseProject={(id) => void closeProject(id)} heading="Repos" />
            <button type="button" className="m-wideaction" onClick={onExit}>
              <Home className="m-wideaction__icon" />
              Voltar ao workspace
            </button>
          </div>
        </div>
      );
    }
    if (screen === "projects") {
      return (
        <div className="m-screen">
          {header("Repos", "Trocar de projeto")}
          <div className="m-pushed__body">
            <ProjectSwitcher onSelect={selectProject} onCloseProject={(id) => void closeProject(id)} heading="Repos abertos" />
            <button type="button" className="m-wideaction" onClick={onExit}>
              <Home className="m-wideaction__icon" />
              Voltar ao workspace
            </button>
          </div>
        </div>
      );
    }
    if (screen === "sessions") {
      return (
        <div className="m-screen">
          {header("Sessões", project.name, <MobileIconButton icon={MessageSquarePlus} label="Nova tarefa" onClick={newTask} />)}
          <SessionsScreen
            project={project}
            filter={sessionFilter}
            onFilter={setSessionFilter}
            onOpenChat={openChat}
          />
        </div>
      );
    }
    if (screen === "files") {
      return (
        <div className="m-screen">
          {header("Arquivos", project.name)}
          <FilesScreen project={project} onOpenFile={openFile} />
        </div>
      );
    }
    if (screen === "git") {
      return (
        <div className="m-screen">
          {header("Git", currentBranch || project.name)}
          <GitScreen
            project={project}
            branch={currentBranch}
            onOpenDiff={openDiff}
            onBranch={() => setBranchOpen(true)}
          />
        </div>
      );
    }
    if (screen === "terminal") {
      return (
        <div className="m-screen">
          {header("Terminal", project.name)}
          <div className="m-pushed__body m-pushed__body--terminal">
            <TerminalPanel project={project} onOpenFile={openFile} sheet onClose={() => setScreen("work")} />
          </div>
        </div>
      );
    }
    if (screen === "databases") {
      return (
        <div className="m-screen">
          {header("Bancos", project.name)}
          <div className="m-pushed__body m-pushed__body--panel">
            <DatabasesScreen project={project} onOpenTable={openTable} />
          </div>
        </div>
      );
    }
    if (screen === "web") {
      return (
        <div className="m-screen">
          {header("Web apps", project.name)}
          <div className="m-pushed__body m-pushed__body--panel">
            <WebAppsScreen onOpenWeb={openWeb} />
          </div>
        </div>
      );
    }
    return workScreen();
  }

  return (
    <>
      <div className="m-dev-surface">{pushed ? pushedScreen() : body()}</div>
      <MobileBranchSheet
        open={branchOpen}
        projectId={project?.id ?? ""}
        onClose={() => setBranchOpen(false)}
        onChanged={() => {
          if (project) api.gitBranches(project.id).then((info) => setCurrentBranch(info.current)).catch(() => undefined);
        }}
      />
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
              project={project ?? ({ id: "", name: "", root: "", color: "", createdAt: "", updatedAt: "" } as Project)}
              focusToken={searchToken}
              onOpenFile={(path, line) => { setSearchOpen(false); openFile(path, line); }}
              floating
            />
          </div>
        </div>
      ) : null}
    </>
  );
}
