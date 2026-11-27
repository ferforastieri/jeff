import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  MessageSquarePlus,
  Search,
  X,
} from "@jeff/icons";
import { api, type Project, type SchemaTable, type WebTarget } from "../../../shared/api";
import { Icon } from "faang-ui";
import { useApp } from "../../../app/store";
import { basename, quoteIdentifier } from "../../../shared/lib";
import BrandGlyph from "../../../shared/ui/BrandGlyph";
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
import QuickOpen from "../../explorer/components/QuickOpen";
import { MobileEmpty } from "./mobile-ui";
import { CHANNEL_DEV_TOOLS, type ChannelDevTool } from "../channelDev";

type Pushed = null | { kind: "chat" } | { kind: "tab"; tabId: string };

interface Props {
  project: Project;
  tool: ChannelDevTool;
  /** A notification can land on the exact session inside Sessões. */
  target?: { chatId?: string; botId?: string } | null;
  onBack: () => void;
  onBackRef: { current: (() => boolean) | null };
  onSelectTool: (tool: ChannelDevTool) => void;
  busy?: boolean;
}

const TITLES: Record<ChannelDevTool, string> = {
  files: "Explorer",
  bots: "Sessões",
  scm: "Source Control",
  db: "Databases",
  web: "Web apps",
};

/** The channel's dev tools: the repo comes from the channel, never a picker. */
export default function ChannelDevMobile({ project, tool, target, onBack, onBackRef, onSelectTool, busy = false }: Props) {
  const tabs = useApp((state) => state.tabs);
  const openTab = useApp((state) => state.openTab);
  const closeTab = useApp((state) => state.closeTab);
  const chats = useChats((state) => state.byProject[project.id]);
  const activeChat = chats?.chats.find((chat) => chat.id === chats.activeChatId) ?? null;
  const [pushed, setPushed] = useState<Pushed>(null);
  const [currentBranch, setCurrentBranch] = useState("");
  const [sessionFilter, setSessionFilter] = useState("");
  const [branchOpen, setBranchOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchToken, setSearchToken] = useState(0);
  const projectTabs = useMemo(() => tabs.filter((tab) => tab.projectId === project.id), [project.id, tabs]);
  const openedTarget = useRef<string | null>(null);
  const lastTool = useRef(tool);

  useEffect(() => {
    if (lastTool.current === tool) return;
    lastTool.current = tool;
    openedTarget.current = null;
    setPushed(null);
  }, [tool]);

  useEffect(() => {
    if (tool !== "bots" || !target) return;
    const key = `${target.chatId ?? ""}:${target.botId ?? ""}`;
    if (openedTarget.current === key) return;
    const chatId = target.chatId
      ?? (target.botId ? latestChatForJeff(chats, target.botId)?.id : undefined);
    if (!chatId) return;
    openedTarget.current = key;
    openChat(chatId);
    // openChat is stable enough for this one-shot notification landing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chats, target, tool]);

  // A closed tab must not leave the pushed screen pointing at nothing.
  useEffect(() => {
    if (pushed?.kind !== "tab") return;
    if (!projectTabs.some((tab) => tab.id === pushed.tabId)) setPushed(null);
  }, [projectTabs, pushed]);

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
    api.gitBranches(project.id)
      .then((info) => setCurrentBranch(info.current))
      .catch(() => setCurrentBranch(""));
  }, [project.id]);

  function openChat(chatId: string) {
    useApp.getState().markChatNotificationsRead(chatId);
    useChats.getState().setActiveChat(project.id, chatId);
    useChats.getState().touchConversation(project.id, chatId);
    setPushed({ kind: "chat" });
  }

  function newTask() {
    const jeff = ensureJeff(project.id);
    if (!jeff) return;
    const created = useChats.getState().createConversation(project.id, [jeff.id]);
    if (created) openChat(created.id);
  }

  function openFile(path: string, line?: number) {
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

  function header(actions?: ReactNode) {
    return (
      <MobileScreenHeader
        title={TITLES[tool]}
        subtitle={project.name}
        onBack={onBack}
        backLabel="Voltar ao canal"
        actions={actions}
      >
        <div className="m-devbar" role="tablist" aria-label="Ferramentas do canal">
          {CHANNEL_DEV_TOOLS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={item.id === tool}
              className={`m-devbar__tab${item.id === tool ? " is-active" : ""}`}
              disabled={busy}
              onClick={() => onSelectTool(item.id)}
            >
              <Icon name={item.icon} size={16} />
              {item.label}
            </button>
          ))}
        </div>
      </MobileScreenHeader>
    );
  }

  function toolScreen() {
    if (tool === "files") {
      return (
        <div className="m-screen">
          {header(<MobileIconButton icon={Search} label="Buscar arquivos" onClick={openSearch} />)}
          <FilesScreen project={project} onOpenFile={openFile} />
        </div>
      );
    }
    if (tool === "bots") {
      return (
        <div className="m-screen">
          {header(<MobileIconButton icon={MessageSquarePlus} label="Nova tarefa" onClick={newTask} />)}
          <SessionsScreen
            project={project}
            filter={sessionFilter}
            onFilter={setSessionFilter}
            onOpenChat={openChat}
          />
        </div>
      );
    }
    if (tool === "scm") {
      return (
        <div className="m-screen">
          {header()}
          <GitScreen
            project={project}
            branch={currentBranch}
            onOpenDiff={openDiff}
            onBranch={() => setBranchOpen(true)}
          />
        </div>
      );
    }
    if (tool === "db") {
      return (
        <div className="m-screen">
          {header()}
          <div className="m-pushed__body m-pushed__body--panel">
            <DatabasesScreen project={project} onOpenTable={openTable} />
          </div>
        </div>
      );
    }
    return (
      <div className="m-screen">
        {header()}
        <div className="m-pushed__body m-pushed__body--panel">
          <WebAppsScreen onOpenWeb={openWeb} />
        </div>
      </div>
    );
  }

  function pushedScreen() {
    if (pushed?.kind === "chat") {
      return (
        <div className="m-screen">
          <MobileScreenHeader
            onBack={() => setPushed(null)}
            backLabel={`Voltar a ${TITLES[tool]}`}
            lead={<span className="m-devface"><BrandGlyph size={22} /></span>}
            title={activeChat?.name?.trim() || "Nova tarefa"}
            subtitle={`${project.name} · ${currentBranch || "repo"}`}
            actions={<MobileIconButton icon={MessageSquarePlus} label="Nova tarefa" onClick={newTask} />}
          />
          {chats?.activeChatId ? (
            <BotStudioTab
              key={chats.activeChatId}
              project={project}
              conversationId={chats.activeChatId}
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
    if (!item) return null;
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

  return (
    <>
      <div className="m-dev-surface">{pushed ? pushedScreen() : toolScreen()}</div>
      <MobileBranchSheet
        open={branchOpen}
        projectId={project.id}
        onClose={() => setBranchOpen(false)}
        onChanged={() => {
          api.gitBranches(project.id).then((info) => setCurrentBranch(info.current)).catch(() => undefined);
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
              project={project}
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
