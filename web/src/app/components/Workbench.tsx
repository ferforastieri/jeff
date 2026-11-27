import { useProjectStream } from "../../features/projects/hooks/useProjectStream";
import { useLayoutTabs, useWorkspacePersistence } from "../../features/projects/hooks/useWorkspacePersistence";
import { lazy, Suspense, useEffect, useRef, useState, type FormEvent } from "react";
import { Bot, ChevronDown, Search, TerminalSquare, X } from "@jeff/icons";
import { api, type Project, type SchemaTable, type WebTarget } from "../../shared/api";
import { basename, expandGitPattern, quoteIdentifier, sanitizeBranchName } from "../../shared/lib";
import { useApp, type Sidebar } from "../store";
import { chatDisplayName, latestChatForJeff, useChats, type ProjectChats, type JeffChat } from "../../features/conversations/store";
import { ensureChatSubjects } from "../../features/conversations/subjects";
import { chatTabId } from "../../features/conversations/navigation";
import { useAI } from "../../features/providers/store";
import { PROJECT_EVENT, type ProjectEvent } from "../../features/projects/events";
import { restoredLayoutTabs } from "../../features/projects/layout";
import BotStudioTab from "../../features/conversations/components/BotStudioTab";
import { featureEnabled, isDesktopClient, isJeffOnly, sidebarFeature, useSettings, type WorkspaceFeature } from "../../features/settings/store";
import Tabs from "./Tabs";
import CloseProjectModal from "../../features/projects/components/CloseProjectModal";
import ProjectSwitcher from "../../features/projects/components/ProjectSwitcher";
import QuickOpen from "../../features/explorer/components/QuickOpen";
import ProjectMonogram from "../../features/projects/components/ProjectMonogram";
import BranchPicker from "../../features/git/components/BranchPicker";
import { useNotificationStream } from "../../features/notifications/stream";
import { unlockBotSound } from "../../features/conversations/sound";
import { IconButton } from "@jeff/ui/app";
import BrandMark from "@jeff/brand";
import { Button } from "@jeff/ui/app";
import { Input } from "@jeff/ui/app";
import { Modal } from "@jeff/ui/app";
import ResizeHandle from "../../shared/ui/resize";
import { isMobileViewport } from "../../shared/ui/useIsMobile";
import { useConfirm } from "../../shared/ui/confirm";
import { agentApi } from "../../features/agents/api";
import { useAgentActivityBridge } from "../../features/agents/activity";
import { useJeffDrafts } from "../../features/agents/drafts";
import { ensureSingleJeff, ensureJeff } from "../../features/agents/default-jeff";
import { suggestGitChanges } from "../../features/git/ai";
import { parseGitStatus } from "../../features/git/status";

const ExplorerPanel = lazy(() => import("../../features/explorer/components/ExplorerPanel"));
const DatabasesPanel = lazy(() => import("../../features/databases/components/DatabasesPanel"));
const WebSidebar = lazy(() => import("../../features/previews/components/WebSidebar"));
const EditorPanel = lazy(() => import("../../features/editor/components/EditorPanel"));
const DbPanelTab = lazy(() => import("../../features/databases/components/DbPanelTab"));
const BotsSidebar = lazy(() => import("../../features/agents/components/BotsSidebar"));
const WebPanelTab = lazy(() => import("../../features/previews/components/WebPanelTab"));
const DiffPanelTab = lazy(() => import("../../features/editor/components/DiffPanelTab"));
const TerminalPanel = lazy(() => import("../../features/terminal/components/TerminalPanel"));
const SourceControlPanel = lazy(() => import("../../features/git/components/SourceControlPanel"));

type RightPanel = "files" | "scm" | "db" | "web" | "bots";
const rightPanelFeatures: Record<RightPanel, WorkspaceFeature | null> = {
  files: "files",
  scm: "sourceControl",
  db: "databases",
  web: "webApps",
  bots: null,
};

function rightPanelForSidebar(sidebar: Sidebar): RightPanel | null {
  switch (sidebar) {
    case "files":
    case "scm":
    case "db":
    case "web":
    case "bots":
      return sidebar;
    default:
      return null;
  }
}

export default function Workbench() {
  const projects = useApp((state) => state.projects);
  const user = useApp((state) => state.user);
  const activeProjectId = useApp((state) => state.activeProjectId);
  const openProjectIds = useApp((state) => state.openProjectIds);
  const setProjects = useApp((state) => state.setProjects);
  const setActiveProject = useApp((state) => state.setActiveProject);
  const closeProjectTab = useApp((state) => state.closeProjectTab);
  const tabs = useApp((state) => state.tabs);
  const activeTabId = useApp((state) => state.activeTabId);
  const setTabs = useApp((state) => state.setTabs);
  const openTab = useApp((state) => state.openTab);
  const sidebar = useApp((state) => state.sidebar);
  const setSidebar = useApp((state) => state.setSidebar);
  const terminalOpen = useApp((state) => state.terminalOpen);
  const setTerminalOpen = useApp((state) => state.setTerminalOpen);
  const notify = useApp((state) => state.notify);
  const chatsHydrated = useChats((state) => activeProjectId ? state.byProject[activeProjectId]?.hydrated === true : false);
  const pendingJeffSelection = useRef<{ projectId: string; jeffId: string; chatId?: string } | null>(null);
  const pendingChatOpen = useRef<{ projectId: string; chatId: string; title?: string } | null>(null);
  const loadChats = useChats((state) => state.load);
  const snapshotChats = useChats((state) => state.snapshot);
  const loadAI = useAI((state) => state.load);
  const loadModels = useAI((state) => state.loadModels);
  const branchPattern = useSettings((state) => state.gitBranchPattern);
  const aiConfig = useAI((state) => state.config);
  const rightPanelWidth = useSettings((state) => state.aiPanelWidth);
  const updateSettings = useSettings((state) => state.update);
  const workspaceFeatures = useSettings((state) => state.workspaceFeatures);
  const confirm = useConfirm();

  const [closeTarget, setCloseTarget] = useState<Project | null>(null);
  const [repoPickerOpen, setRepoPickerOpen] = useState(false);
  const [closeBusy, setCloseBusy] = useState(false);
  const [closeError, setCloseError] = useState("");
  const [gitStatus, setGitStatus] = useState("");
  const [branchMenuOpen, setBranchMenuOpen] = useState(false);
  const [branchCreateOpen, setBranchCreateOpen] = useState(false);
  const [quickOpenToken, setQuickOpenToken] = useState(0);
  const [quickOpenOpen, setQuickOpenOpen] = useState(false);
  const [rightPanel, setRightPanel] = useState<RightPanel>("files");
  const [rightPanelOpen, setRightPanelOpen] = useState(false);
  const tabsVisible = workspaceFeatures.tabs;
  const [branchInfo, setBranchInfo] = useState<{ current: string; branches: string[] } | null>(null);
  const [branchBusy, setBranchBusy] = useState("");
  const [newBranchName, setNewBranchName] = useState("");
  const [branchFilter, setBranchFilter] = useState("");
  const [branchError, setBranchError] = useState("");
  const loadedProject = useRef<string | null>(null);
  const [projectEpoch, setProjectEpoch] = useState(0);
  const [projectsLoaded, setProjectsLoaded] = useState(false);
  const forceJeffsOnLoad = useRef(false);

  const project = projects.find((item) => item.id === activeProjectId) ?? null;
  const branch = gitStatus.split("\n")[0]?.replace(/^##\s*/, "").split("...")[0] ?? "";
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null;
  const activeChatMode = useChats((state) => {
    if (activeTab?.kind !== "ai" || !activeTab.chatId || !activeProjectId) return undefined;
    return state.byProject[activeProjectId]?.chats.find((chat) => chat.id === activeTab.chatId)?.mode;
  });
  const agentDebug = activeChatMode === "debug";
  const botsView = sidebar === "bots";
  const desktopClient = isDesktopClient();
  const filesEnabled = featureEnabled(workspaceFeatures, "files");
  const sourceControlEnabled = featureEnabled(workspaceFeatures, "sourceControl");
  const databasesEnabled = featureEnabled(workspaceFeatures, "databases");
  const terminalEnabled = featureEnabled(workspaceFeatures, "terminal");
  const projectEventsEnabled = filesEnabled || sourceControlEnabled || databasesEnabled;
  const sortedBranches = branchInfo
    ? [...branchInfo.branches].sort((a, b) => {
        if (a === branchInfo.current) return -1;
        if (b === branchInfo.current) return 1;
        return a.localeCompare(b);
      })
    : [];
  const visibleBranches = sortedBranches.filter((name) =>
    name.toLowerCase().includes(branchFilter.trim().toLowerCase()),
  );
  const rightPanelFeature = rightPanelFeatures[rightPanel];
  const rightPanelAvailable = !rightPanelFeature || featureEnabled(workspaceFeatures, rightPanelFeature);

  function featureIsEnabled(feature: WorkspaceFeature): boolean {
    return featureEnabled(workspaceFeatures, feature);
  }

  function selectSidebar(next: Sidebar): void {
    const feature = sidebarFeature(next);
    if (feature && !featureIsEnabled(feature)) return;
    setSidebar(next);
  }

  useEffect(() => {
    const panel = rightPanelForSidebar(sidebar);
    if (!panel) return;
    setRightPanel(panel);
    setRightPanelOpen(true);
  }, [sidebar]);

  useEffect(() => {
    const openTool = (event: Event) => {
      const tool = (event as CustomEvent<{ tool?: Sidebar }>).detail?.tool;
      if (!tool) return;
      const panel = rightPanelForSidebar(tool);
      if (!panel) return;
      setSidebar(tool);
      setRightPanel(panel);
      setRightPanelOpen(true);
    };
    window.addEventListener("jeff:dev-tool", openTool);
    return () => window.removeEventListener("jeff:dev-tool", openTool);
  }, [setSidebar]);

  useEffect(() => {
    const selectedFeature = sidebarFeature(sidebar);
    if ((!selectedFeature && sidebar !== "bots") || (selectedFeature && !featureIsEnabled(selectedFeature))) {
      setSidebar("bots");
    }
    if (!terminalEnabled && terminalOpen) {
      setTerminalOpen(false);
    }
    if (rightPanelOpen && rightPanelFeature && !featureEnabled(workspaceFeatures, rightPanelFeature)) {
      setRightPanelOpen(false);
    }
  }, [workspaceFeatures, sidebar, terminalOpen, terminalEnabled, rightPanel, rightPanelOpen, rightPanelFeature, setSidebar, setTerminalOpen]);

  useEffect(() => {
    if (!activeProjectId) return;
    if (!terminalEnabled) void api.closeProjectTerminals(activeProjectId).catch(() => undefined);
  }, [activeProjectId, terminalEnabled]);

  useEffect(() => {
    void loadAI().then(() => loadModels());
  }, [loadAI, loadModels]);

  // WebViews block audio until the user interacts, so warm the audio context on
  // the first gesture and revive it if the system suspended it later.
  useEffect(() => {
    window.addEventListener("pointerdown", unlockBotSound, true);
    window.addEventListener("keydown", unlockBotSound, true);
    return () => {
      window.removeEventListener("pointerdown", unlockBotSound, true);
      window.removeEventListener("keydown", unlockBotSound, true);
    };
  }, []);

  // Warm the branch list for the active project so opening the selector is instant.
  useEffect(() => {
    if (!activeProjectId || !sourceControlEnabled) return;
    setBranchMenuOpen(false);
    setBranchInfo(null);
    setBranchError("");
    void loadBranches();
  }, [activeProjectId, sourceControlEnabled]);

  useEffect(() => {
    const openQuick = () => {
      setQuickOpenOpen(true);
      setQuickOpenToken((current) => current + 1);
    };
    window.addEventListener("jeff:quick-open", openQuick);
    return () => window.removeEventListener("jeff:quick-open", openQuick);
  }, []);

  useEffect(() => {
    const openTerminal = (event: Event) => {
      const force = (event as CustomEvent<{ force?: boolean }>).detail?.force === true;
      if (!terminalEnabled && !force) return;
      if (force) {
        if (!terminalEnabled) updateSettings({ workspaceFeatures: { terminal: true } });
        setTerminalOpen(true);
      } else {
        setTerminalOpen(!useApp.getState().terminalOpen);
      }
    };
    window.addEventListener("jeff:open-terminal", openTerminal);
    return () => window.removeEventListener("jeff:open-terminal", openTerminal);
  }, [setTerminalOpen, terminalEnabled, updateSettings]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "p") {
        event.preventDefault();
        window.dispatchEvent(new CustomEvent("jeff:editor-command", { detail: { command: "editor.action.quickCommand" } }));
        return;
      }
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "p") {
        event.preventDefault();
        setQuickOpenOpen(true);
        setQuickOpenToken((current) => current + 1);
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "j") {
        event.preventDefault();
        if (!terminalEnabled) return;
        setTerminalOpen(!useApp.getState().terminalOpen);
        return;
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [setSidebar, setTerminalOpen, terminalEnabled]);

  useProjectStream(projectEventsEnabled);

  // The open project list is shared across devices: pull it once, then push
  // every change. Notifications come from the same server store.
  const openProjectsReady = useRef(false);
  const syncedOpenProjects = useRef("");
  useEffect(() => {
    let cancelled = false;
    const pull = async () => {
      try {
        const ids = await api.openProjects();
        if (cancelled) return;
        if (ids.length > 0) {
          syncedOpenProjects.current = ids.join("|");
          useApp.getState().setOpenProjectIds(ids);
        } else {
          // Nothing saved yet (first run on this account). The desktop is the
          // reference workspace, so a phone must not replace its open projects
          // with whatever list it happened to keep locally. A phone still
          // publishes when the user opens or closes a project on purpose.
          const local = useApp.getState().openProjectIds;
          const phoneShell =
            isMobileViewport() || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
          if (local.length > 0 && !phoneShell) {
            syncedOpenProjects.current = local.join("|");
            await api.saveOpenProjects(local);
          }
        }
      } catch {
        // Offline: keep the local list and try again on the next change.
      } finally {
        if (!cancelled) openProjectsReady.current = true;
      }
    };
    const pullNotifications = () => {
      void api.notifications()
        .then((items) => { if (!cancelled) useApp.getState().hydrateNotifications(items); })
        .catch(() => undefined);
    };
    void pull();
    pullNotifications();

    // Coming back to this device must show what happened on the other ones.
    const resync = () => {
      if (document.visibilityState === "hidden") return;
      pullNotifications();
      if (!openProjectsReady.current) return;
      const current = useApp.getState().openProjectIds.join("|");
      if (current === syncedOpenProjects.current) {
        void pull();
      } else {
        // A local change is still on its way to the server; do not clobber it.
        syncedOpenProjects.current = current;
        void api.saveOpenProjects(useApp.getState().openProjectIds).catch(() => undefined);
      }
    };
    document.addEventListener("visibilitychange", resync);
    window.addEventListener("focus", resync);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", resync);
      window.removeEventListener("focus", resync);
    };
  }, []);

  useEffect(() => {
    if (!openProjectsReady.current) return;
    const snapshot = openProjectIds.join("|");
    const timer = window.setTimeout(() => {
      void api.saveOpenProjects(openProjectIds)
        .then(() => { syncedOpenProjects.current = snapshot; })
        .catch(() => undefined);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [openProjectIds]);

  // Old sessions only know their Jeff names; read their first message once so
  // the tab labels can show what each conversation is about.
  useEffect(() => {
    if (!activeProjectId || !chatsHydrated) return;
    const projectChats = useChats.getState().byProject[activeProjectId];
    if (!projectChats) return;
    const openChats = tabs
      .filter((tab) => tab.kind === "ai" && tab.chatId)
      .map((tab) => projectChats.chats.find((chat) => chat.id === tab.chatId))
      .filter((chat): chat is JeffChat => Boolean(chat));
    void ensureChatSubjects(activeProjectId, openChats);
  }, [activeProjectId, chatsHydrated, tabs]);

  // Reading a conversation clears its unread answers, but only while it is on
  // screen: background completions keep their badge until the tab is opened.
  useEffect(() => {
    const mark = () => {
      const state = useApp.getState();
      const tab = state.tabs.find((item) => item.id === state.activeTabId);
      if (!tab || tab.kind !== "ai" || !tab.chatId) return;
      if (document.visibilityState !== "visible") return;
      if (isMobileViewport() && state.mobileScreen !== "bots") return;
      state.markChatNotificationsRead(tab.chatId);
    };
    mark();
    document.addEventListener("visibilitychange", mark);
    window.addEventListener("focus", mark);
    return () => {
      document.removeEventListener("visibilitychange", mark);
      window.removeEventListener("focus", mark);
    };
  }, [activeTabId]);

  useEffect(() => {
    if (!activeProjectId || !filesEnabled && !sourceControlEnabled) {
      setGitStatus("");
      return;
    }
    const onProjectEvent = (raw: Event) => {
      const event = (raw as CustomEvent<ProjectEvent>).detail;
      if (!event || event.projectId !== activeProjectId) return;
      if (event.type !== "git" && event.type !== "files" && event.type !== "sync") return;
      api.gitStatus(activeProjectId).then(setGitStatus).catch(() => undefined);
    };
    window.addEventListener(PROJECT_EVENT, onProjectEvent);
    return () => window.removeEventListener(PROJECT_EVENT, onProjectEvent);
  }, [activeProjectId, filesEnabled, sourceControlEnabled]);

  useNotificationStream();

  useEffect(() => {
    const onOpenBot = (event: Event) => {
      const payload = (event as CustomEvent<{ projectId?: string; botId?: string; notificationId?: string }>).detail;
      if (!payload?.projectId) return;
      localStorage.removeItem("jeff_open_dev_chat");
      const state = useApp.getState();
      if (payload.notificationId) {
        const notification = state.notifications.find((item) => item.notificationId === payload.notificationId);
        if (notification) state.markNotificationRead(notification.id);
      }
      const switchingProject = state.activeProjectId !== payload.projectId;
      const chatId = (payload as { chatId?: string }).chatId;
      state.setActiveProject(payload.projectId);
      forceJeffsOnLoad.current = true;
      if (payload.botId) {
        if (switchingProject) pendingJeffSelection.current = { projectId: payload.projectId, jeffId: payload.botId, chatId };
        else openJeffConversation(payload.projectId, payload.botId, chatId);
      } else if (chatId) {
        const chats = useChats.getState().byProject[payload.projectId];
        if (switchingProject || !chats?.hydrated) pendingChatOpen.current = { projectId: payload.projectId, chatId };
        else openConversation(payload.projectId, chatId);
      }
      state.setSidebar("bots");
    };
    window.addEventListener("jeff:open-bot", onOpenBot as EventListener);
    return () => window.removeEventListener("jeff:open-bot", onOpenBot as EventListener);
  }, []);

  useEffect(() => {
    const onOpenChat = (event: Event) => {
      const detail = (event as CustomEvent<{ projectId?: string; chatId?: string; title?: string }>).detail;
      if (!detail?.projectId || !detail.chatId) return;
      localStorage.removeItem("jeff_open_dev_chat");
      const state = useApp.getState();
      if (state.activeProjectId !== detail.projectId) {
        pendingChatOpen.current = { projectId: detail.projectId, chatId: detail.chatId, title: detail.title };
        state.setActiveProject(detail.projectId);
        state.setSidebar("bots");
        return;
      }
      const chats = useChats.getState().byProject[detail.projectId];
      if (!chats?.hydrated) {
        pendingChatOpen.current = { projectId: detail.projectId, chatId: detail.chatId, title: detail.title };
        return;
      }
      openConversation(detail.projectId, detail.chatId, detail.title);
      state.setSidebar("bots");
    };
    window.addEventListener("jeff:open-chat", onOpenChat);
    return () => window.removeEventListener("jeff:open-chat", onOpenChat);
  }, []);

  // A completion opened from the Slack bell lands on the exact dev conversation.
  useEffect(() => {
    const raw = localStorage.getItem("jeff_open_dev_chat");
    if (!raw) return;
    localStorage.removeItem("jeff_open_dev_chat");
    try {
      const detail = JSON.parse(raw) as { projectId?: string; chatId?: string; botId?: string };
      if (!detail?.projectId) return;
      if (detail.chatId) {
        window.dispatchEvent(
          new CustomEvent("jeff:open-chat", {
            detail: { projectId: detail.projectId, chatId: detail.chatId },
          }),
        );
      } else if (detail.botId) {
        window.dispatchEvent(new CustomEvent("jeff:open-bot", { detail }));
      }
    } catch {
      // A corrupted handoff must not keep the dev surface from opening.
    }
  }, []);

  useEffect(() => {
    const pending = pendingChatOpen.current;
    if (!pending || pending.projectId !== activeProjectId || !chatsHydrated) return;
    pendingChatOpen.current = null;
    openConversation(pending.projectId, pending.chatId, pending.title);
  }, [activeProjectId, chatsHydrated]);

  useEffect(() => {
    const pending = pendingJeffSelection.current;
    if (!pending || pending.projectId !== activeProjectId || !chatsHydrated) return;
    openJeffConversation(pending.projectId, pending.jeffId, pending.chatId);
  }, [activeProjectId, chatsHydrated]);

  // A deleted conversation (or a deleted participant) must not leave a dead tab.
  useEffect(() => {
    if (!activeProjectId || !chatsHydrated) return;
    const chats = useChats.getState().byProject[activeProjectId];
    const ids = new Set((chats?.chats ?? []).map((chat) => chat.id));
    const kept = tabs.filter((tab) => tab.kind !== "ai" || (tab.chatId && ids.has(tab.chatId)));
    if (kept.length === tabs.length) return;
    const nextActive = kept.some((tab) => tab.id === activeTabId) ? activeTabId : kept[0]?.id ?? null;
    setTabs(kept, nextActive);
  }, [activeProjectId, chatsHydrated, tabs, activeTabId, setTabs]);


  useEffect(() => {
    let cancelled = false;
    api
      .projects()
      .then((items) => {
        if (!cancelled) setProjects(items);
      })
      .catch((error) => {
        if (!cancelled) notify("error", error instanceof Error ? error.message : "Could not load projects.");
      })
      .finally(() => {
        if (!cancelled) setProjectsLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [notify, setProjects]);

  // The welcome page used to flash between projects loading. Pick the first
  // project instead and only show a picker when the account really has none.
  useEffect(() => {
    if (!projectsLoaded || project || projects.length === 0) return;
    setActiveProject(projects[0].id);
  }, [projectsLoaded, project, projects, setActiveProject]);

  // Keep the index.html splash (Jeff jumping) up until the workbench has
  // something real to show, instead of a black frame between the two.
  useEffect(() => {
    if (!projectsLoaded) return;
    if (projects.length > 0 && !project) return;
    const frame = window.requestAnimationFrame(() => {
      (window as Window & { __jeffWorkbenchReady?: boolean }).__jeffWorkbenchReady = true;
      window.dispatchEvent(new Event("jeff:workbench-ready"));
    });
    return () => window.cancelAnimationFrame(frame);
  }, [projectsLoaded, project, projects.length]);

  useEffect(() => {
    if (!activeProjectId) return;
    let cancelled = false;
    useChats.getState().unload(activeProjectId);
    loadedProject.current = null;
    setTabs([]);
    const initialFeatures = useSettings.getState().workspaceFeatures;
    const initialEnabled = (feature: WorkspaceFeature) => featureEnabled(initialFeatures, feature);
    const initialTopOnly = isJeffOnly(initialFeatures);
    setTerminalOpen(initialEnabled("terminal") && !initialTopOnly && !desktopClient);
    api
      .layout(activeProjectId)
      .then((layout) => {
        if (cancelled) return;
        const features = useSettings.getState().workspaceFeatures;
        const enabled = (feature: WorkspaceFeature) => featureEnabled(features, feature);
        const currentTopOnly = isJeffOnly(features);
        const restored = restoredLayoutTabs(layout.tabs, enabled);
        const restoredActive = typeof layout.activeTabId === "string" && restored.some((tab) => tab.id === layout.activeTabId)
          ? layout.activeTabId
          : null;
        setTabs(restored.map((tab) => ({ ...tab, projectId: activeProjectId })), restoredActive);
        const storedChats = layout.chats as ProjectChats | null | undefined;
        const migratingJeffs = !storedChats || storedChats.version !== 5;
        loadChats(activeProjectId, storedChats);
        const { removedIds } = ensureSingleJeff(activeProjectId);
        for (const id of removedIds) void agentApi.deleteJeff(activeProjectId, id).catch(() => undefined);
        if (currentTopOnly || forceJeffsOnLoad.current || migratingJeffs) {
          forceJeffsOnLoad.current = false;
          setSidebar("bots");
        }
        setTerminalOpen(
          enabled("terminal") && !currentTopOnly && (
            typeof layout.terminalOpen === "boolean" ? layout.terminalOpen : !desktopClient
          ),
        );
        loadedProject.current = activeProjectId;
        setProjectEpoch((value) => value + 1);
      })
      .catch((error) => {
        if (!cancelled) {
          if (forceJeffsOnLoad.current) {
            forceJeffsOnLoad.current = false;
            setSidebar("bots");
          }
          notify("error", error instanceof Error ? error.message : "Could not restore workspace.");
        }
      });
    return () => {
      cancelled = true;
      useChats.getState().unload(activeProjectId);
    };
  }, [activeProjectId, desktopClient, loadChats, notify, setSidebar, setTabs, setTerminalOpen]);

  useEffect(() => {
    if (!activeProjectId || (!filesEnabled && !sourceControlEnabled)) {
      setGitStatus("");
      return;
    }
    api
      .gitStatus(activeProjectId)
      .then(setGitStatus)
      .catch(() => setGitStatus(""));
  }, [activeProjectId, filesEnabled, sourceControlEnabled]);


  const layoutTabs = useLayoutTabs(tabs);
  useWorkspacePersistence(activeProjectId, loadedProject.current === activeProjectId, {
    tabs: layoutTabs, activeTabId, sidebar, terminalOpen,
  }, projectEpoch);
  useAgentActivityBridge(openProjectIds);

  function switchProject(next: string) {
    if (next === activeProjectId) return;
    if (project && loadedProject.current === project.id) {
      void api.saveLayout(project.id, {
        tabs: layoutTabs,
        activeTabId,
        sidebar,
        terminalOpen,
        chats: snapshotChats(project.id),
      });
    }
    forceJeffsOnLoad.current = true;
    loadedProject.current = null;
    setActiveProject(next);
  }







  async function loadBranches() {
    if (!project || !featureIsEnabled("sourceControl")) return;
    setBranchError("");
    try {
      setBranchInfo(await api.gitBranches(project.id));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Não foi possível listar as branches.";
      setBranchError(/not a git repository/i.test(message)
        ? "Esta pasta não é um repositório Git. Abra um repositório Git para gerenciar branches."
        : message);
      setBranchInfo({ current: "", branches: [] });
    }
  }

  function openBranchMenu() {
    if (!project || !featureIsEnabled("sourceControl")) return;
    setBranchMenuOpen(true);
    setNewBranchName("");
    setBranchFilter("");
    void loadBranches();
  }

  async function checkoutBranch(name: string) {
    if (!project || branchBusy) return;
    setBranchBusy(name);
    try {
      await api.gitCheckout(project.id, name);
      setGitStatus(await api.gitStatus(project.id));
      window.dispatchEvent(new Event("jeff:git-changed"));
      setBranchMenuOpen(false);
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "Não foi possível trocar de branch.");
    } finally {
      setBranchBusy("");
    }
  }

  async function pushBranch() {
    if (!project || branchBusy) return;
    setBranchBusy("push");
    try {
      const output = await api.gitPush(project.id);
      const last = output.trim().split("\n").pop() ?? "";
      notify("success", last || "Branch enviada para o remoto.");
      window.dispatchEvent(new Event("jeff:git-changed"));
      await loadBranches();
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "Não foi possível enviar a branch.");
    } finally {
      setBranchBusy("");
    }
  }

  async function collectBranchDiff(): Promise<string> {
    if (!project) return "";
    const parsed = parseGitStatus(await api.gitStatus(project.id));
    const seen = new Set<string>();
    const parts: string[] = [];
    for (const change of parsed.changes) {
      if (seen.has(change.path)) continue;
      seen.add(change.path);
      const staged = change.staged && !change.unstaged;
      const diff = await api.gitDiff(project.id, change.path, staged).catch(() => "");
      if (diff) parts.push(diff);
    }
    return parts.join("\n").slice(0, 16000);
  }

  async function generateBranchName() {
    if (!project || branchBusy) return;
    setBranchBusy("generate");
    try {
      const status = await api.gitStatus(project.id);
      const parsed = parseGitStatus(status);
      const diff = await collectBranchDiff();
      const suggestion = await suggestGitChanges(aiConfig, diff, parsed.branch);
      const generated = sanitizeBranchName(
        expandGitPattern(branchPattern, {
          repo: project.name,
          branch: parsed.branch,
          user: user?.username ?? "",
          task: suggestion.task,
          slug: suggestion.slug || "update",
          summary: suggestion.summary,
        }),
      );
      setNewBranchName(generated);
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "Não foi possível gerar a branch.");
    } finally {
      setBranchBusy("");
    }
  }

  async function deleteOtherBranches() {
    if (!project || !branchInfo || branchBusy) return;
    const current = branchInfo.current || branch;
    const others = branchInfo.branches.filter((name) => name !== current);
    if (others.length === 0) {
      notify("info", "Só existe a branch atual. Nada para excluir.");
      return;
    }
    const ok = await confirm({
      title: "Excluir outras branches?",
      message: `Excluir ${others.length} branch${others.length === 1 ? "" : "es"} e manter somente ${current}? Essa ação não pode ser desfeita.`,
      confirmLabel: "Excluir branches",
      danger: true,
    });
    if (!ok) return;
    setBranchBusy("delete");
    try {
      const deleted = await api.gitDeleteOtherBranches(project.id);
      setBranchInfo(await api.gitBranches(project.id));
      setGitStatus(await api.gitStatus(project.id));
      window.dispatchEvent(new Event("jeff:git-changed"));
      notify("success", `${deleted} branch${deleted === 1 ? "" : "es"} excluída${deleted === 1 ? "" : "s"}.`);
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "Não foi possível excluir as branches.");
    } finally {
      setBranchBusy("");
    }
  }

  async function createBranchFromMenu(event: FormEvent) {
    event.preventDefault();
    if (!project || !newBranchName.trim() || branchBusy) return;
    const name = newBranchName.trim();
    setBranchBusy("create");
    try {
      await api.gitCreateBranch(project.id, name);
      setNewBranchName("");
      setBranchCreateOpen(false);
      setGitStatus(await api.gitStatus(project.id));
      setBranchInfo(await api.gitBranches(project.id));
      window.dispatchEvent(new Event("jeff:git-changed"));
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "Não foi possível criar a branch.");
    } finally {
      setBranchBusy("");
    }
  }

  function openFile(path: string, line?: number) {
    if (!project || !featureIsEnabled("files")) return;
    openTab({
      id: `editor:${project.id}:${path}`,
      kind: "editor",
      title: basename(path),
      projectId: project.id,
      path,
      line,
    });
  }

  function openDiff(path: string, staged: boolean) {
    if (!project || !featureIsEnabled("files")) return;
    openTab({
      id: `diff:${project.id}:${staged ? "staged" : "worktree"}:${path}`,
      kind: "diff",
      title: basename(path),
      projectId: project.id,
      path,
      staged,
    });
  }

  function openTable(profileId: string, table: SchemaTable, driver: string) {
    if (!project || !featureIsEnabled("databases")) return;
    const schema = table.schema;
    let sql = "";
    if (driver === "mongodb") {
      sql = JSON.stringify(
        { database: schema, collection: table.name, filter: {}, limit: 100 },
        null,
        2,
      );
    } else if (driver === "redis") {
      sql = "SCAN 0 COUNT 100";
    } else if (driver === "elasticsearch") {
      sql = JSON.stringify(
        { index: table.name, body: { query: { match_all: {} }, size: 100 } },
        null,
        2,
      );
    } else if (driver === "neo4j") {
      sql = `MATCH (n:${table.name}) RETURN n LIMIT 100;`;
    } else if (driver === "cassandra") {
      sql = `SELECT * FROM ${schema}.${table.name} LIMIT 100;`;
    } else {
      sql = `SELECT * FROM ${quoteIdentifier(driver, schema, table.name)} LIMIT 100;`;
    }
    const editable = !["mongodb", "redis", "elasticsearch", "neo4j", "cassandra"].includes(driver);
    openTab({
      id: `db:table:${project.id}:${profileId}:${schema}.${table.name}`,
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
  }

  function openConversation(projectId: string, chatId: string, title?: string) {
    const chats = useChats.getState().byProject[projectId];
    const chat = chats?.chats.find((item) => item.id === chatId);
    if (!chat) return;
    openTab({
      id: chatTabId(projectId, chatId),
      kind: "ai",
      title: title?.trim() || chatDisplayName(chats, chat, 2) || "Conversa",
      projectId,
      chatId,
    });
    useChats.getState().setActiveChat(projectId, chatId);
    useChats.getState().touchConversation(projectId, chatId);
  }

  function newConversation() {
    if (!project) return;
    const jeff = ensureJeff(project.id);
    if (!jeff) return;
    const chat = useChats.getState().createConversation(project.id, [jeff.id], { name: jeff.name });
    if (chat) openConversation(project.id, chat.id, jeff.name);
  }

  function openJeffConversation(projectId: string, jeffId: string, chatId?: string) {
    const chats = useChats.getState().byProject[projectId];
    if (!chats?.hydrated) {
      pendingJeffSelection.current = { projectId, jeffId, chatId };
      return;
    }
    if (!chats.jeffs.some((item) => item.id === jeffId)) {
      pendingJeffSelection.current = null;
      return;
    }
    const chat = (chatId ? chats.chats.find((item) => item.id === chatId && item.participantIds.includes(jeffId)) : null)
      ?? latestChatForJeff(chats, jeffId)
      ?? useChats.getState().createConversation(projectId, [jeffId]);
    pendingJeffSelection.current = null;
    if (chat) openConversation(projectId, chat.id);
  }

  function openWeb(target: WebTarget) {
    if (!project || !featureIsEnabled("webApps")) return;
    openTab({
      id: `web:${project.id}:${target.id}`,
      kind: "web",
      title: target.name,
      projectId: project.id,
      url: target.url,
    });
  }

  function requestCloseProject(id: string) {
    const target = projects.find((item) => item.id === id);
    if (!target) return;
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
      if (activeProjectId === id && loadedProject.current === id) {
        await api
          .saveLayout(id, {
            tabs: layoutTabs,
            activeTabId,
            sidebar,
            terminalOpen,
            chats: snapshotChats(id),
          })
          .catch(() => undefined);
      }
      const result = await api.closeProject(id);
      useChats.getState().forget(id);
      useJeffDrafts.getState().clearProject(id);
      if (activeProjectId === id) {
        forceJeffsOnLoad.current = true;
        loadedProject.current = null;
      }
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

  if (!projectsLoaded) {
    return <div className="h-full bg-background-full" />;
  }

  if (!project) {
    if (projects.length === 0) {
      return (
        <main className="safe-screen relative flex h-full min-h-0 items-center justify-center overflow-y-auto bg-background-full p-4 sm:p-6">
          <section className="w-full max-w-lg rounded-3xl border border-border-button-white bg-background-primary-default p-3 shadow-2xl">
            <ProjectSwitcher onSelect={switchProject} heading="Repos abertos" />
          </section>
        </main>
      );
    }
    return <div className="h-full bg-background-full" />;
  }

  function branchPickerBody() {
    return (
      <BranchPicker
        current={branchInfo?.current || branch || "detached"}
        branches={visibleBranches}
        filter={branchFilter}
        onFilterChange={setBranchFilter}
        onCheckout={(name) => void checkoutBranch(name)}
        onPush={() => void pushBranch()}
        onCreate={() => { setBranchMenuOpen(false); setNewBranchName(""); setBranchCreateOpen(true); }}
        onDeleteOthers={() => void deleteOtherBranches()}
        onRetry={() => void loadBranches()}
        error={branchError}
        loading={!branchInfo && !branchError}
        busy={branchBusy}
        count={branchInfo?.branches.length}
        deleteDisabled={!branchInfo || branchInfo.branches.length <= 1}
      />
    );
  }
  const branchControl = sourceControlEnabled ? (
    <Button
      variant="ghost"
      size="small"
      className="max-w-[240px] justify-start"
      aria-label={`Branch ${branch || "detached"}`}
      title={`Branch atual: ${branch || "detached"}`}
      onClick={openBranchMenu}
    >
      <span className="min-w-0 flex-1 truncate text-start">{branch || "detached"}</span>
      <ChevronDown size={12} className="shrink-0" />
    </Button>
  ) : null;

  const rightPanelControl = (
    <IconButton
      icon={X}
      size="xs"
      className="border-transparent bg-transparent shadow-none"
      aria-label="Fechar painel direito"
      title="Fechar painel direito"
      onClick={() => setRightPanelOpen(false)}
    />
  );

  const rightPanelContent = project ? (
    <Suspense fallback={null}>
      {rightPanel === "files" && featureIsEnabled("files") && (
        <ExplorerPanel project={project} headerControl={rightPanelControl} onOpenFile={openFile} onStatusChange={setGitStatus} />
      )}
      {rightPanel === "scm" && featureIsEnabled("sourceControl") && (
        <SourceControlPanel project={project} view="scm" headerControl={rightPanelControl} onOpenDiff={openDiff} onStatusChange={setGitStatus} />
      )}
      {rightPanel === "db" && featureIsEnabled("databases") && (
        <DatabasesPanel project={project} headerControl={rightPanelControl} onOpenTable={openTable} />
      )}
      {rightPanel === "web" && featureIsEnabled("webApps") && (
        <WebSidebar headerControl={rightPanelControl} onOpenWeb={openWeb} />
      )}
      {rightPanel === "bots" && <BotsSidebar project={project} headerControl={rightPanelControl} />}
    </Suspense>
  ) : null;

  return (
    <div className="dev-embedded relative flex h-full min-h-0 flex-col overflow-hidden">
      <div className="relative flex min-h-0 flex-1 gap-0">
        <div className="dev-embedded__sheet relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
          <div className="dev-workbench__main-column flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <div className="dev-embedded__toolbar">
              <button type="button" className="dev-embedded__project" onClick={() => setRepoPickerOpen(true)} title={project?.root ?? "Abrir repo"}>
                {project ? <ProjectMonogram project={project} size={22} /> : <BrandMark size="small" />}
                <span>{project?.name ?? "Abrir repo"}</span>
                <ChevronDown size={12} />
              </button>
              {branchControl}
              <span className="dev-embedded__grow" />
              <IconButton
                icon={Search}
                size="small"
                aria-label="Buscar arquivos"
                title="Buscar (Ctrl+P)"
                onClick={() => {
                  setQuickOpenOpen(true);
                  setQuickOpenToken((current) => current + 1);
                }}
              />
              <IconButton
                icon={TerminalSquare}
                size="small"
                aria-label={terminalOpen ? "Fechar terminal" : "Abrir terminal"}
                title={terminalOpen ? "Fechar terminal" : "Abrir terminal (Ctrl+J)"}
                onClick={() => setTerminalOpen(!terminalOpen)}
              />
            </div>
          <main className="dev-workbench__main relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <div className="flex min-h-0 flex-1 flex-col">
              {tabsVisible && tabs.length > 0 ? <Tabs /> : null}
              <div key={activeTab?.id ?? "empty"} className="dev-tab-content relative flex min-h-0 flex-1 overflow-hidden">
                {!activeTab && project && (
                  <div className="flex h-full w-full flex-col items-center justify-center gap-4 p-8 text-center">
                    <BrandMark size="large" />
                    <h2 className="text-title-2-medium text-text-primary">{botsView ? "Nenhuma sessão aberta" : project.name}</h2>
                    <p className="max-w-lg text-body-regular text-text-secondary">
                      {botsView ? "Abra uma sessão na barra ao lado ou comece uma nova tarefa." : project.root}
                    </p>
                     <div className="flex flex-wrap items-center justify-center gap-2">
                       {featureIsEnabled("files") && <Button variant="secondary" size="small" onClick={() => selectSidebar("files")}>Explorer</Button>}
                       {featureIsEnabled("databases") && <Button variant="secondary" size="small" onClick={() => selectSidebar("db")}>Database</Button>}
                       <Button variant="secondary" size="small" onClick={newConversation}>Nova tarefa</Button>
                     </div>
                  </div>
                )}
                <Suspense fallback={null}>
                  {tabsVisible && activeTab?.kind === "editor" && project && featureIsEnabled("files") && <EditorPanel tab={activeTab} project={project} onOpenChanges={(path) => openDiff(path, false)} />}
                  {tabsVisible && activeTab?.kind === "db" && featureIsEnabled("databases") && <DbPanelTab tab={activeTab} />}
                  {tabsVisible && activeTab?.kind === "web" && featureIsEnabled("webApps") && <WebPanelTab tab={activeTab} />}
                  {tabsVisible && activeTab?.kind === "diff" && project && featureIsEnabled("files") && <DiffPanelTab tab={activeTab} project={project} />}
                  {activeTab?.kind === "ai" && project && activeTab.chatId && (
                    <BotStudioTab embedded key={activeTab.chatId} project={project} conversationId={activeTab.chatId} onOpenFile={(path, line) => openFile(path, line)} />
                  )}
                </Suspense>
              </div>
            </div>
          </main>

          {project && terminalEnabled && terminalOpen && !agentDebug ? (
            <Suspense fallback={null}>
              <div className="dev-workbench__terminal flex w-full min-w-0 shrink-0 flex-col">
                <TerminalPanel key={project.id} project={project} onOpenFile={openFile} />
              </div>
            </Suspense>
          ) : null}
          </div>

        {project && rightPanelOpen && rightPanelAvailable ? (
          <>
            <ResizeHandle
              className="right-panel-resize"
              orientation="vertical"
              value={rightPanelWidth}
              min={300}
              max={620}
              invert
              label="Redimensionar painel direito"
              onChange={(width) => document.documentElement.style.setProperty("--ai-panel-width", `${width}px`)}
              onCommit={(width) => updateSettings({ aiPanelWidth: width })}
            />
            <aside
              className="dev-workbench__right relative z-40 flex min-h-0 w-[var(--ai-panel-width)] shrink-0 flex-col overflow-hidden border-s border-border-button-default bg-background-primary-default [&>*]:min-h-0 [&>*]:flex-1"
              aria-label="Painel auxiliar"
            >
              <div key={rightPanel} className="dev-panel-content flex min-h-0 flex-1 flex-col">
                {rightPanelContent}
              </div>
            </aside>
          </>
        ) : null}
        </div>
      </div>

      {quickOpenOpen && project ? (
        <div
          className="dev-quickopen"
          role="dialog"
          aria-modal="true"
          aria-label="Buscar"
          onMouseDown={(event) => { if (event.target === event.currentTarget) setQuickOpenOpen(false); }}
          onKeyDown={(event) => { if (event.key === "Escape") setQuickOpenOpen(false); }}
        >
          <div className="dev-quickopen__card">
            <QuickOpen
              project={project}
              focusToken={quickOpenToken}
              onOpenFile={(path, line) => { setQuickOpenOpen(false); openFile(path, line); }}
              floating
            />
          </div>
        </div>
      ) : null}

      <Modal
        isOpen={repoPickerOpen}
        onClose={() => setRepoPickerOpen(false)}
        title="Abrir repo"
        description="Escolha um repositório disponível no servidor."
        size="md"
        bodyClassName="p-3"
      >
        <ProjectSwitcher
          onSelect={(id) => {
            setRepoPickerOpen(false);
            switchProject(id);
          }}
          onCloseProject={requestCloseProject}
        />
      </Modal>

      <Modal
        isOpen={branchMenuOpen && Boolean(project)}
        onClose={() => setBranchMenuOpen(false)}
        title="Branches"
        description="Troque de branch, crie uma nova ou exclua as que não usa."
        size="md"
        bodyClassName="p-0"
      >
        <div className="max-h-[min(600px,calc(100dvh-24px))] overflow-y-auto">{branchPickerBody()}</div>
      </Modal>

      <Modal
        isOpen={branchCreateOpen && Boolean(project)}
        onClose={() => setBranchCreateOpen(false)}
        title="Nova branch"
        description="Crie uma branch a partir da branch atual."
        size="sm"
      >
        <form className="flex flex-col gap-2" onSubmit={(event) => void createBranchFromMenu(event)}>
          <div className="relative w-full">
            <Input
              value={newBranchName}
              onChange={setNewBranchName}
              placeholder="nome-da-branch"
              aria-label="Nome da nova branch"
              autoFocus
              fieldClassName="pe-9"
            />
            <IconButton
              icon={Bot}
              size="small"
              aria-label="Gerar nome da branch"
              title="Gerar nome com IA"
              disabled={Boolean(branchBusy)}
              onClick={() => void generateBranchName()}
              className="absolute end-1 top-1/2 size-6 -translate-y-1/2 border-transparent bg-transparent p-0 shadow-none [&_svg]:size-4"
            />
          </div>
          <Button type="submit" size="small" className="w-full justify-center" disabled={!newBranchName.trim() || Boolean(branchBusy)}>{branchBusy === "create" ? "Criando..." : "Criar branch"}</Button>
        </form>
      </Modal>


      <CloseProjectModal
        open={Boolean(closeTarget)}
        project={closeTarget}
        busy={closeBusy}
        error={closeError}
        onClose={() => { if (!closeBusy) setCloseTarget(null); }}
        onConfirm={() => void confirmCloseProject()}
      />
    </div>
  );
}
