import {
  BookOpen,
  Boxes,
  Braces,
  ChevronRight,
  HardDrive,
  MenuBars,
  Rows3,
  Search,
  TerminalSquare,
  Timer,
} from "@jeff/icons";
import { useEffect, type ComponentType } from "react";
import { useApp } from "../../../app/store";
import { api } from "../../../shared/api";
import ProjectMonogram from "../../projects/components/ProjectMonogram";
import MobileScreenHeader from "../../../app/layouts/mobile/components/MobileScreenHeader";
import MobileIconButton from "../../../app/layouts/mobile/components/MobileIconButton";

type WorkView = "tasks" | "calendar" | "drive" | "wiki";

interface Props {
  workspaceName: string;
  onOpenView: (view: WorkView) => void;
  onOpenWorkbench: (projectId?: string) => void;
  onOpenSearch: () => void;
  onOpenProjects: () => void;
  devMode: boolean;
  onMenu: () => void;
}

const TOOLS: Array<{ id: WorkView; label: string; hint: string; icon: ComponentType<{ className?: string }> }> = [
  { id: "tasks", label: "Tarefas", hint: "O quadro do workspace", icon: Rows3 },
  { id: "calendar", label: "Calendário", hint: "Rotinas e eventos", icon: Timer },
  { id: "drive", label: "Drive", hint: "Arquivos do servidor", icon: HardDrive },
  { id: "wiki", label: "Wiki", hint: "Documentação do time", icon: BookOpen },
];

/** Trabalho: the workspace tools and the repos that open the dev workbench. */
export default function WorkHub({ workspaceName, onOpenView, onOpenWorkbench, onOpenSearch, onOpenProjects, devMode, onMenu }: Props) {
  const projects = useApp((state) => state.projects);
  const activeProjectId = useApp((state) => state.activeProjectId);
  const setProjects = useApp((state) => state.setProjects);
  const openTabs = useApp((state) => state.tabs.length);

  useEffect(() => {
    if (projects.length > 0) return;
    let cancelled = false;
    void api
      .projects()
      .then((items) => {
        if (!cancelled) setProjects(items);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [projects.length, setProjects]);
  const activeProject = projects.find((project) => project.id === activeProjectId) ?? null;
  const otherProjects = projects.filter((project) => project.id !== activeProjectId);

  return (
    <div className="m-screen">
      <MobileScreenHeader
        variant="title"
        title="Trabalho"
        subtitle={workspaceName}
        lead={<MobileIconButton icon={MenuBars} label="Abrir navegação" onClick={onMenu} />}
        actions={<MobileIconButton icon={Search} label="Buscar" onClick={onOpenSearch} />}
      />
      <div className="m-scroll">
        <div className="m-toolgrid m-toolgrid--workspace">
          {TOOLS.map((tool) => {
            const Icon = tool.icon;
            return (
              <button key={tool.id} type="button" className="m-tool" onClick={() => onOpenView(tool.id)}>
                <span className="m-tool__icon"><Icon className="m-tool__glyph" /></span>
                <span className="m-tool__copy">
                  <strong>{tool.label}</strong>
                  <small>{tool.hint}</small>
                </span>
                <ChevronRight className="m-tool__chevron" />
              </button>
            );
          })}
        </div>

        <header className="m-blockhead">
          <div>
            <h2>Workbench</h2>
            <p>O editor, o terminal e as abas de cada repo.</p>
          </div>
          <button type="button" className="m-blockhead__action" onClick={onOpenProjects}>
            <TerminalSquare className="m-blockhead__icon" />
            Abrir
          </button>
        </header>

        {activeProject ? (
          <button type="button" className="m-devcard" onClick={() => onOpenWorkbench(activeProject.id)}>
            <ProjectMonogram project={activeProject} size={44} />
            <span className="m-devcard__copy">
              <strong>{activeProject.name}</strong>
              <small>{activeProject.root}</small>
            </span>
            <span className="m-devcard__meta">
              <Braces className="m-devcard__icon" />
              {openTabs} {openTabs === 1 ? "aba" : "abas"}
            </span>
          </button>
        ) : null}

        <div className="m-repolist">
          {otherProjects.map((project) => (
            <button
              key={project.id}
              type="button"
              className="m-reporow"
              data-active={project.id === activeProjectId || undefined}
              onClick={() => onOpenWorkbench(project.id)}
            >
              <ProjectMonogram project={project} size={36} />
              <span className="m-reporow__copy">
                <strong>{project.name}</strong>
                <small>{project.root}</small>
              </span>
              <TerminalSquare className="m-reporow__icon" />
            </button>
          ))}
          {projects.length === 0 ? (
            <p className="m-muted m-muted--pad">Nenhum repo aberto ainda.</p>
          ) : null}
        </div>

        <button type="button" className="m-wideaction" onClick={() => onOpenWorkbench(activeProjectId ?? undefined)}>
          <Boxes className="m-wideaction__icon" />
          Abrir workbench
          {devMode ? <span className="m-wideaction__tag">dev</span> : null}
        </button>
        <div className="m-scroll__end" />
      </div>
    </div>
  );
}
