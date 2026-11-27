import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Search, X } from "@jeff/icons";
import { api, type Project, type SchemaTable } from "../../../shared/api";
import { useApp } from "../../../app/store";
import { basename, quoteIdentifier } from "../../../shared/lib";
import FilesScreen from "../../../app/layouts/mobile/screens/FilesScreen";
import GitScreen from "../../../app/layouts/mobile/screens/GitScreen";
import DatabasesScreen from "../../../app/layouts/mobile/screens/DatabasesScreen";
import TerminalPanel from "../../terminal/components/TerminalPanel";
import MobileScreenHeader from "../../../app/layouts/mobile/components/MobileScreenHeader";
import MobileIconButton from "../../../app/layouts/mobile/components/MobileIconButton";
import MobileBranchSheet from "../../../app/layouts/mobile/MobileBranchSheet";
import EditorPanel from "../../editor/components/EditorPanel";
import DbPanelTab from "../../databases/components/DbPanelTab";
import DiffPanelTab from "../../editor/components/DiffPanelTab";
import BotStudioTab from "../../conversations/components/BotStudioTab";
import QuickOpen from "../../explorer/components/QuickOpen";
import type { ChannelDevTool } from "../channelDev";

type Pushed = null | { kind: "tab"; tabId: string };

interface Props {
  project: Project;
  tool: ChannelDevTool;
  onBack: () => void;
  onBackRef: { current: (() => boolean) | null };
}

const TITLES: Record<ChannelDevTool, string> = {
  files: "Explorer",
  scm: "Source Control",
  db: "Databases",
  terminal: "Terminal",
};

/** The channel's dev tools: the repo comes from the channel, never a picker. */
export default function ChannelDevMobile({ project, tool, onBack, onBackRef }: Props) {
  const tabs = useApp((state) => state.tabs);
  const openTab = useApp((state) => state.openTab);
  const closeTab = useApp((state) => state.closeTab);
  const [pushed, setPushed] = useState<Pushed>(null);
  const [currentBranch, setCurrentBranch] = useState("");
  const [branchOpen, setBranchOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchToken, setSearchToken] = useState(0);
  const projectTabs = useMemo(() => tabs.filter((tab) => tab.projectId === project.id), [project.id, tabs]);
  const lastTool = useRef(tool);

  useEffect(() => {
    if (lastTool.current === tool) return;
    lastTool.current = tool;
    setPushed(null);
  }, [tool]);

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
      />
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
    if (tool === "terminal") {
      return (
        <div className="m-screen">
          {header()}
          <div className="m-pushed__body m-pushed__body--terminal">
            <TerminalPanel project={project} onOpenFile={openFile} sheet onClose={onBack} />
          </div>
        </div>
      );
    }
    return (
      <div className="m-screen">
        {header()}
        <div className="m-pushed__body m-pushed__body--panel">
          <DatabasesScreen project={project} onOpenTable={openTable} />
        </div>
      </div>
    );
  }

  function pushedScreen() {
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
