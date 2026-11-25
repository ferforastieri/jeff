import { useState, type ReactNode } from "react";
import {
  Avatar,
  Button,
  Icon,
  Kbd,
  ListRow,
  Menu,
  MenuItem,
  type IconName,
} from "faang-ui";
import { cx } from "@jeff/ui";
import type { Project, User } from "../../shared/api";
import type { Sidebar } from "../store";
import { featureEnabled, useSettings, type WorkspaceFeature } from "../../features/settings/store";
import ProjectMonogram from "../../features/projects/components/ProjectMonogram";
import ProjectRunningDot from "../../features/projects/components/ProjectRunningDot";
import QuickOpen from "../../features/explorer/components/QuickOpen";
import SidebarJeffs from "../../shared/ui/SidebarJeffs";
import { ThemeToggle } from "../../shared/ui/ThemeToggle";
import NotificationBell from "../../features/notifications/components/NotificationBell";
import { usePrefs } from "../../shared/prefs";
import { animateReorder } from "../../shared/ui/animateReorder";

interface Tool {
  id: Sidebar;
  feature: WorkspaceFeature;
  label: string;
  icon: IconName;
}

const TOOLS: Tool[] = [
  { id: "files", feature: "files", label: "Explorer", icon: "file" },
  { id: "bots", feature: "bots", label: "Sessões", icon: "message" },
  { id: "scm", feature: "sourceControl", label: "Source Control", icon: "gitPull" },
  { id: "db", feature: "databases", label: "Databases", icon: "database" },
  { id: "web", feature: "webApps", label: "Web apps", icon: "globe" },
];

const EMPTY_PROJECT: Project = {
  id: "",
  name: "Dev",
  root: "",
  color: "#0063D1",
  createdAt: "",
  updatedAt: "",
};

export interface DevSidebarProps {
  project: Project | null;
  projects: Project[];
  openProjectIds: string[];
  activeProjectId: string | null;
  user: User | null;
  branch: string;
  branchControl: ReactNode;
  quickOpenToken: number;
  activeTool: Sidebar;
  terminalOpen: boolean;
  onBack: () => void;
  onOpenFile: (path: string, line?: number) => void;
  onOpenProject: (id: string) => void;
  onCloseProject: (id: string) => void;
  onOpenRepoPicker: () => void;
  onOpenTool: (tool: Sidebar) => void;
  onTerminal: () => void;
  onQuickOpen: () => void;
  collapsed: boolean;
  onCollapse: (collapsed: boolean) => void;
}



/**
 * The dev surface's left column, wearing the Slack sidebar's clothes: the same
 * workspace header, search row, nav rows, groups and person footer. The only
 * dev-only parts are the repos and the branch; theme and settings stay in the
 * Slack shell.
 */
export default function DevSidebar({
  project,
  projects,
  openProjectIds,
  activeProjectId,
  user,
  branch,
  branchControl,
  quickOpenToken,
  activeTool,
  terminalOpen,
  onBack,
  onOpenFile,
  onOpenProject,
  onCloseProject,
  onOpenRepoPicker,
  onOpenTool,
  onTerminal,
  onQuickOpen,
  collapsed,
  onCollapse,
}: DevSidebarProps) {
  const features = useSettings((state) => state.workspaceFeatures);
  const [openRepos, setOpenRepos] = useState(true);
  const prefs = usePrefs((state) => state.prefs);
  const updatePrefs = usePrefs((state) => state.update);
  const defaultTools: Sidebar[] = ["files", "bots", "scm", "db", "web"];
  const savedTools = (prefs.devToolOrder ?? []) as Sidebar[];
  const toolOrder = [
    ...savedTools.filter((id) => defaultTools.includes(id)),
    ...defaultTools.filter((id) => !savedTools.includes(id)),
  ];
  const [draggedTool, setDraggedTool] = useState<Sidebar | null>(null);
  const [overTool, setOverTool] = useState<{ id: Sidebar; where: "before" | "after" } | null>(null);
  const openProjects = openProjectIds
    .map((id) => projects.find((item) => item.id === id))
    .filter((item): item is Project => Boolean(item));
  const userName = user?.displayName || user?.username || "você";
  const visibleTools = toolOrder
    .map((id) => TOOLS.find((tool) => tool.id === id))
    .filter((tool): tool is Tool => tool !== undefined && featureEnabled(features, tool.feature));
  const markProject = project ?? projects[0] ?? EMPTY_PROJECT;

  const placeTool = (target: Sidebar, where: "before" | "after" = "before", container?: HTMLElement | null) => {
    if (!draggedTool || draggedTool === target) return;
    const rest = toolOrder.filter((id) => id !== draggedTool);
    const at = rest.indexOf(target) + (where === "after" ? 1 : 0);
    if (at < 0) return;
    rest.splice(at, 0, draggedTool);
    if (rest.join("|") !== toolOrder.join("|")) {
      animateReorder(container ?? document.querySelector<HTMLElement>(".ws-nav"), () =>
        updatePrefs({ devToolOrder: rest }),
      );
    }
  };

  const reorderTool = (target: Sidebar, where: "before" | "after" = "before") => {
    placeTool(target, where);
    setDraggedTool(null);
    setOverTool(null);
  };

  const moveTool = (id: Sidebar, delta: -1 | 1) => {
    const from = toolOrder.indexOf(id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= toolOrder.length) return;
    const next = [...toolOrder];
    next.splice(from, 1);
    next.splice(to, 0, id);
    updatePrefs({ devToolOrder: next });
  };

  if (collapsed) {
    return (
      <aside className="ws-rail dev-rail dev-workbench__side" aria-label="Modo dev recolhido">
        <button
          type="button"
          className="ws-rail-logo dev-rail-logo"
          onClick={() => onCollapse(false)}
          aria-label="Expandir barra"
          title="Expandir barra"
        >
          <ProjectMonogram project={markProject} size={30} />
        </button>
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          icon="search"
          aria-label="Buscar"
          title="Buscar"
          onClick={() => {
            onCollapse(false);
            onQuickOpen();
          }}
        />
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          icon="code"
          aria-label="Terminal"
          title="Terminal"
          className={terminalOpen ? "is-active" : ""}
          onClick={onTerminal}
        />
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          icon="sidebar"
          aria-label="Expandir barra"
          title="Expandir barra"
          onClick={() => onCollapse(false)}
        />
        <div className="ws-rail-separator" />
        <nav className="ws-rail-nav" aria-label="Modo dev">
          {visibleTools.map((tool) => (
            <Button
              key={tool.id}
              variant="ghost"
              size="sm"
              iconOnly
              icon={tool.icon}
              aria-label={tool.label}
              title={tool.label}
              className={activeTool === tool.id ? "is-active" : ""}
              onClick={() => onOpenTool(tool.id)}
            />
          ))}
          {featureEnabled(features, "terminal") ? (
            <Button
              variant="ghost"
              size="sm"
              iconOnly
              icon="code"
              aria-label="Terminal"
              title="Terminal"
              className={terminalOpen ? "is-active" : ""}
              onClick={onTerminal}
            />
          ) : null}
        </nav>
        <div className="ws-rail-separator" />
        <div className="ws-rail-channels" aria-label="Repos">
          {openProjects.slice(0, 4).map((item) => (
            <button
              key={item.id}
              type="button"
              className={cx("ws-rail-channel", item.id === activeProjectId && "is-active")}
              title={`${item.name}\n${item.root}`}
              onClick={() => onOpenProject(item.id)}
            >
              <ProjectMonogram project={item} size={22} />
            </button>
          ))}
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            icon="plus"
            aria-label="Abrir repo"
            title="Abrir repo"
            onClick={onOpenRepoPicker}
          />
        </div>
        <div className="ws-rail-spacer" />
        <span className="ws-rail-user" title={userName}>
          <Avatar kind="person" name={userName} size="sm" />
        </span>
        <div className="ws-rail-actions">
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            icon="message"
            aria-label="Ir para o Slack"
            title="Ir para o Slack"
            onClick={onBack}
          />
          <ThemeToggle className="ws-theme-toggle" />
          <NotificationBell />
        </div>
      </aside>
    );
  }

  return (
    <aside className="ws-sidebar dev-sidebar dev-workbench__side">
      <SidebarJeffs />
      <Menu
        align="start"
        label="Menu do projeto"
        trigger={
          <button
            type="button"
            className="ws-workspace"
            aria-haspopup="menu"
            aria-label={`Menu do projeto ${project?.name || "Dev"}`}
          >
            <span className="ws-workspace-mark dev-workspace-mark">
              <ProjectMonogram project={markProject} size={26} />
            </span>
            <span className="ws-workspace-title">
              <strong>{project?.name || "Dev"}</strong>
              <small>modo dev{branch ? ` · ${branch}` : ""}</small>
            </span>
            <Icon name="chevronDown" size={16} />
          </button>
        }
      >
        <MenuItem icon="message" onSelect={onBack}>
          Voltar ao Slack
        </MenuItem>
        <MenuItem icon="repo" onSelect={onOpenRepoPicker}>
          Abrir repo…
        </MenuItem>
        {project ? (
          <MenuItem icon="close" onSelect={() => onCloseProject(project.id)}>
            Fechar {project.name}
          </MenuItem>
        ) : null}
      </Menu>

      <div className="ws-search">
        <div className="ws-search-row">
          <QuickOpen
            project={project}
            focusToken={quickOpenToken}
            onOpenFile={onOpenFile}
            placement="below"
            className="min-w-0 flex-1"
            placeholder="Ir para…"
            shortcut={
              <span className="ws-kbd">
                <Kbd>Ctrl</Kbd>
                <Kbd>K</Kbd>
              </span>
            }
          />
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            icon="sidebar"
            aria-label="Recolher barra"
            title="Recolher barra"
            onClick={() => onCollapse(true)}
          />
        </div>
      </div>

      <nav className="ws-nav" aria-label="Modo dev">
        {visibleTools.map((tool) => (
          <ListRow
            key={tool.id}
            className={[
              activeTool === tool.id ? "is-active" : "",
              draggedTool === tool.id ? "is-dragging" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            data-drop={overTool?.id === tool.id && overTool.where}
            data-sort-id={tool.id}
            lead={<Icon name={tool.icon} size={16} />}
            title={tool.label}
            trailing={
              <span
                className="ws-nav-grip"
                draggable
                role="button"
                tabIndex={-1}
                aria-label={`Mover ${tool.label}`}
                title={`Mover ${tool.label}`}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
                onDragStart={(event) => {
                  setDraggedTool(tool.id);
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/plain", tool.id);
                  const row = event.currentTarget.closest<HTMLElement>(".ac-row");
                  if (row) event.dataTransfer.setDragImage(row, 24, row.clientHeight / 2);
                }}
                onDragEnd={() => {
                  setDraggedTool(null);
                  setOverTool(null);
                }}
              >
                <Icon name="grip" size={14} />
              </span>
            }
            onClick={() => onOpenTool(tool.id)}
            onKeyDown={(event) => {
              if (!event.altKey || !event.shiftKey) return;
              if (event.key === "ArrowUp") {
                event.preventDefault();
                moveTool(tool.id, -1);
              } else if (event.key === "ArrowDown") {
                event.preventDefault();
                moveTool(tool.id, 1);
              }
            }}
            onDragOver={(event) => {
              if (!draggedTool || draggedTool === tool.id) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              const rect = event.currentTarget.getBoundingClientRect();
              const where = event.clientY > rect.top + rect.height / 2 ? "after" : "before";
              placeTool(tool.id, where, event.currentTarget.closest<HTMLElement>(".ws-nav"));
              if (overTool?.id !== tool.id || overTool.where !== where) setOverTool({ id: tool.id, where });
            }}
            onDragLeave={() => setOverTool((current) => (current?.id === tool.id ? null : current))}
            onDrop={(event) => {
              event.preventDefault();
              const rect = event.currentTarget.getBoundingClientRect();
              const where = event.clientY > rect.top + rect.height / 2 ? "after" : "before";
              reorderTool(tool.id, where);
            }}
          />
        ))}
        {featureEnabled(features, "terminal") ? (
          <ListRow
            className={terminalOpen ? "is-active" : ""}
            lead={<Icon name="code" size={16} />}
            title="Terminal"
            onClick={onTerminal}
          />
        ) : null}
      </nav>

      <div className="ws-sidebar-scroll">
        <section className="ws-group" data-open={openRepos}>
          <div className="ws-group-head">
            <button
              type="button"
              className="ws-group-toggle"
              aria-expanded={openRepos}
              onClick={() => setOpenRepos((current) => !current)}
            >
              <span className="ws-group-label">Repos</span>
              <Icon name="chevronDown" size={14} className="ws-group-chevron" />
            </button>
            <Button
              variant="ghost"
              size="sm"
              iconOnly
              icon="plus"
              className="ws-group-add"
              aria-label="Abrir repo"
              title="Abrir repo"
              onClick={onOpenRepoPicker}
            />
          </div>
          {openRepos ? (
            <div className="ws-group-body">
              {openProjects.length === 0 ? (
                <p className="ws-dm-note">Nenhum repo aberto. Abra um para começar.</p>
              ) : null}
              {openProjects.map((item) => {
                const active = item.id === activeProjectId;
                return (
                  <div className="ws-channel-wrap" key={item.id}>
                    <ListRow
                      className={cx("ws-channel-row", active && "is-active")}
                      lead={
                        <span className="dev-repo-face">
                          <ProjectMonogram project={item} size={22} />
                          <ProjectRunningDot projectId={item.id} className="-end-1 -bottom-1" />
                        </span>
                      }
                      title={item.name}
                      onClick={() => onOpenProject(item.id)}
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      iconOnly
                      icon="close"
                      className="ws-row-action"
                      aria-label={`Fechar ${item.name}`}
                      title={`Fechar ${item.name}`}
                      onClick={() => onCloseProject(item.id)}
                    />
                  </div>
                );
              })}
            </div>
          ) : null}
        </section>

        {project && branchControl ? (
          <section className="ws-group">
            <div className="ws-group-head">
              <span className="ws-group-label">Branch</span>
            </div>
            <div className="dev-branch-row" title={`Branch atual: ${branch || "detached"}`}>
              <Icon name="gitPull" size={16} />
              {branchControl}
            </div>
          </section>
        ) : null}
      </div>

      <footer className="ws-user">
        <span className="ws-user-face">
          <Avatar kind="person" name={userName} size="sm" />
          <span className="ws-user-presence" aria-hidden="true" />
        </span>
        <span className="ws-user-copy">
          <strong>{userName}</strong>
          <small>
            <span className="ws-online-dot" aria-hidden="true" />
            Online
          </small>
        </span>
        <div className="ws-user-actions">
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            icon="message"
            aria-label="Ir para o Slack"
            title="Ir para o Slack"
            onClick={onBack}
          />
          <ThemeToggle className="ws-theme-toggle" />
          <NotificationBell />
        </div>
      </footer>
    </aside>
  );
}
