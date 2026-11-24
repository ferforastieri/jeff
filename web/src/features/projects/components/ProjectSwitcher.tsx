import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Bell, FolderGit2, FolderPlus, X } from "@jeff/icons";
import { PixelSpinner } from "@jeff/ui";
import { api, ApiError, type Repository } from "../../../shared/api";
import { useApp } from "../../../app/store";
import ProjectJeffAvatar from "./ProjectJeffAvatar";
import ProjectRunningDot from "./ProjectRunningDot";
import { Button, Checkbox, Input, Select, SelectItem } from "@jeff/ui/app";
import { SearchField } from "@jeff/ui";
import NotificationBadge from "../../notifications/components/NotificationBadge";

interface Props {
  onSelect: (id: string) => void;
  onCloseProject?: (id: string) => void;
  /** Only list projects that are not already open in the workspace. */
  onlyClosed?: boolean;
  /** Only list the projects that are open right now (the mobile rail). */
  onlyOpen?: boolean;
  /** Header label, when the caller wants a different wording. */
  heading?: string;
  /** Extra action rendered on the right side of the header. */
  action?: ReactNode;
}

/** The project switcher: existing projects plus every Git repository found
 * under the configured workspace roots, so the picker can open a repo that
 * has not been added as a project yet. */
export default function ProjectSwitcher({ onSelect, onCloseProject, onlyClosed = false, onlyOpen = false, heading, action }: Props) {
  const projects = useApp((state) => state.projects);
  const openProjectIds = useApp((state) => state.openProjectIds);
  const notifications = useApp((state) => state.notifications);
  const setProjects = useApp((state) => state.setProjects);
  const [query, setQuery] = useState("");
  const [repos, setRepos] = useState<Repository[]>([]);
  const [reposLoading, setReposLoading] = useState(true);
  const [opening, setOpening] = useState("");
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [creatingBusy, setCreatingBusy] = useState(false);
  const [createError, setCreateError] = useState("");
  const [roots, setRoots] = useState<string[]>([]);
  const [parent, setParent] = useState("");
  const [newName, setNewName] = useState("");
  const [initGit, setInitGit] = useState(true);

  useEffect(() => {
    // Only the create form needs the allowed folders, so the list waits for it.
    if (onlyOpen || !creating) return;
    let cancelled = false;
    api.workspaceRoots()
      .then((response) => {
        if (cancelled) return;
        setRoots(response.roots);
        setParent((current) => current || response.roots[0] || "");
      })
      .catch((err) => {
        if (!cancelled) setCreateError(err instanceof Error ? err.message : "Não foi possível listar as pastas permitidas.");
      });
    return () => { cancelled = true; };
  }, [creating, onlyOpen]);

  useEffect(() => {
    // The open-projects rail never adds repositories, so it does not pay for it.
    if (onlyOpen) {
      setReposLoading(false);
      return;
    }
    let cancelled = false;
    api.repos()
      .then((items) => {
        if (cancelled) return;
        setRepos(items);
        setError("");
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Não foi possível buscar os repositórios.");
      })
      .finally(() => {
        if (!cancelled) setReposLoading(false);
      });
    return () => { cancelled = true; };
  }, [onlyOpen]);

  const normalized = query.trim().toLowerCase();
  const visible = projects
    .filter((project) => !onlyClosed || !openProjectIds.includes(project.id))
    .filter((project) => !onlyOpen || openProjectIds.includes(project.id))
    .filter((project) =>
      !normalized
      || project.name.toLowerCase().includes(normalized)
      || project.root.toLowerCase().includes(normalized),
    )
    .sort((a, b) => {
      if (onlyOpen) {
        return openProjectIds.indexOf(a.id) - openProjectIds.indexOf(b.id);
      }
      const aOpen = openProjectIds.includes(a.id) ? 0 : 1;
      const bOpen = openProjectIds.includes(b.id) ? 0 : 1;
      return aOpen - bOpen || a.name.localeCompare(b.name);
    });

  const availableRepos = useMemo(
    () =>
      repos
        .filter((repo) => !projects.some((project) => project.root === repo.path))
        .filter((repo) =>
          !normalized
          || `${repo.name} ${repo.relative} ${repo.path}`.toLowerCase().includes(normalized),
        ),
    [normalized, projects, repos],
  );

  const unreadFor = (projectId: string) =>
    notifications.filter((notification) => !notification.read && notification.projectId === projectId).length;

  async function openRepo(repo: Repository) {
    if (opening) return;
    setOpening(repo.path);
    setError("");
    try {
      let project = projects.find((item) => item.root === repo.path);
      if (!project) {
        try {
          project = await api.createProject(repo.name, repo.path, "#0063D1");
        } catch (err) {
          if (!(err instanceof ApiError) || err.status !== 409) throw err;
          const next = await api.projects();
          setProjects(next);
          project = next.find((item) => item.root === repo.path);
        }
        if (!project) throw new Error("O repositório foi criado, mas não apareceu na lista de repos.");
        const next = await api.projects();
        setProjects(next);
      }
      onSelect(project.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível abrir o repositório.");
      setOpening("");
    }
  }

  /** Creates the folder (and its Git repository) and opens it right away. */
  async function createRepo(event: FormEvent) {
    event.preventDefault();
    const name = newName.trim();
    if (!name || !parent || creatingBusy) return;
    setCreatingBusy(true);
    setCreateError("");
    try {
      const repo = await api.createRepo(parent, name, initGit);
      setNewName("");
      setCreating(false);
      setRepos((current) => [repo, ...current]);
      await openRepo(repo);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Não foi possível criar o repositório.");
    } finally {
      setCreatingBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <SearchField
        size="sm"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onClear={() => setQuery("")}
        clearLabel="Limpar busca"
        placeholder={onlyOpen ? "Pesquisar repo" : "Pesquisar repositório"}
        aria-label={onlyOpen ? "Pesquisar repo" : "Pesquisar repositório"}
      />
      {onlyOpen ? null : creating ? (
        <form
          onSubmit={(event) => void createRepo(event)}
          className="flex flex-col gap-2 rounded-xl border border-border-button-default bg-background-secondary-default/60 p-2.5"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-caption-1-medium text-text-primary">
              <FolderPlus size={13} className="text-accent-500" /> Novo repositório
            </span>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              iconOnly
              leadingIcon={X}
              aria-label="Cancelar novo repositório"
              title="Cancelar"
              onClick={() => { setCreateError(""); setCreating(false); }}
            />
          </div>
          {roots.length > 1 ? (
            <Select
              selectedKey={parent || null}
              onSelectionChange={(key) => setParent(String(key))}
              aria-label="Pasta onde criar"
              className="w-full"
            >
              {roots.map((root) => <SelectItem key={root} id={root}>{root}</SelectItem>)}
            </Select>
          ) : (
            <p className="truncate px-1 text-caption-2-regular text-text-tertiary" title={parent || undefined}>
              {roots.length === 0 ? "Nenhuma pasta permitida em Configurações → Workspace." : parent}
            </p>
          )}
          <Input
            value={newName}
            onChange={setNewName}
            placeholder="nome-da-pasta"
            aria-label="Nome da pasta"
            autoFocus
          />
          <Checkbox isSelected={initGit} onChange={setInitGit} size="sm">Inicializar com Git</Checkbox>
          {createError ? <p role="alert" className="rounded-lg border border-status-rose-border bg-status-rose-bg px-2 py-1.5 text-caption-2-regular text-status-rose-text">{createError}</p> : null}
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-caption-2-regular text-text-tertiary" title={parent && newName.trim() ? `${parent}/${newName.trim()}` : undefined}>
              {parent && newName.trim() ? `${parent}/${newName.trim()}` : ""}
            </span>
            <Button type="submit" size="small" disabled={creatingBusy || !newName.trim() || !parent}>
              {creatingBusy ? "Criando..." : "Criar e abrir"}
            </Button>
          </div>
        </form>
      ) : (
        <Button
          variant="secondary"
          size="small"
          leadingIcon={FolderPlus}
          className="w-full justify-start"
          onClick={() => { setCreateError(""); setCreating(true); }}
        >
          Novo repositório
        </Button>
      )}
      {error ? <p role="alert" className="rounded-lg border border-status-rose-border bg-status-rose-bg px-2 py-1.5 text-caption-2-regular text-status-rose-text">{error}</p> : null}
      <div className="flex items-center justify-between px-1 text-caption-2-regular text-text-tertiary">
        <span>{heading || (onlyOpen ? "Abertos agora" : onlyClosed ? "Outros repos" : "Repos abertos")}</span>
        <span className="flex items-center gap-1.5">{visible.length}{action}</span>
      </div>
      <div className="flex max-h-[min(260px,32vh)] flex-col gap-0.5 overflow-y-auto">
        {visible.length === 0 ? (
          <p className="px-2 py-4 text-center text-caption-2-regular text-text-tertiary">
            {onlyClosed
              ? "Todos os repos já estão abertos."
              : onlyOpen
                ? "Nenhum repo aberto."
                : projects.length === 0
                  ? "Nenhum repo aberto ainda."
                  : "Nenhum repo encontrado."}
          </p>
        ) : null}
        {visible.map((item) => {
          const open = openProjectIds.includes(item.id);
          return (
            <div key={item.id} className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => onSelect(item.id)}
                className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl p-2 text-start text-text-primary transition-colors hover:bg-dropdown-item-hover-background focus-visible:bg-dropdown-item-hover-background"
              >
                <span className="relative inline-flex shrink-0">
                  <ProjectJeffAvatar project={item} size={28} showInitial />
                  <ProjectRunningDot projectId={item.id} className="-end-1 -bottom-1" />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate text-body-2-medium text-text-primary">{item.name}</span>
                    {open && !onlyOpen ? <span className="shrink-0 rounded-full bg-accent-500/10 px-1.5 text-[9px] font-medium uppercase tracking-wide text-accent-600">aberto</span> : null}
                  </span>
                  <span className="truncate text-caption-1-regular text-text-secondary">{item.root}</span>
                </span>
                {onlyOpen && unreadFor(item.id) > 0 ? (
                  <Bell size={13} className="shrink-0 text-accent-500" aria-label={`${unreadFor(item.id)} notificações não lidas`} />
                ) : (
                  <NotificationBadge count={unreadFor(item.id)} className="shrink-0 text-text-tertiary" />
                )}
              </button>
              {open && onCloseProject ? (
                <Button
                  variant="ghost"
                  size="xs"
                  iconOnly
                  leadingIcon={X}
                  aria-label={`Fechar ${item.name}`}
                  title="Fechar repo"
                  onClick={() => onCloseProject(item.id)}
                />
              ) : null}
            </div>
          );
        })}
      </div>

      {onlyOpen ? null : (
        <>
          <div className="flex items-center justify-between border-t border-separator-border pt-2 px-1 text-caption-2-regular text-text-tertiary">
            <span className="flex items-center gap-1.5"><FolderGit2 size={12} /> Repositórios no servidor</span>
            <span>{reposLoading ? <PixelSpinner size={14} /> : availableRepos.length}</span>
          </div>
          <div className="flex max-h-[min(220px,28vh)] flex-col gap-0.5 overflow-y-auto">
            {reposLoading ? (
              <p role="status" className="flex items-center justify-center gap-2 px-2 py-4 text-caption-2-regular text-text-tertiary"><PixelSpinner size={14} /> Procurando repositórios…</p>
            ) : null}
            {!reposLoading && availableRepos.length === 0 ? (
              <p className="px-2 py-4 text-center text-caption-2-regular text-text-tertiary">
                {query.trim() ? "Nenhum repositório encontrado." : "Nenhum repositório Git encontrado nas pastas permitidas."}
              </p>
            ) : null}
            {availableRepos.map((repo) => (
              <button
                key={repo.path}
                type="button"
                onClick={() => void openRepo(repo)}
                disabled={Boolean(opening)}
                title={repo.path}
                className="flex min-w-0 items-center gap-2.5 rounded-xl p-2 text-start text-text-primary transition-colors hover:bg-dropdown-item-hover-background focus-visible:bg-dropdown-item-hover-background disabled:opacity-60"
              >
                <span className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-border-button-default bg-background-secondary-default/60 text-foreground-icon-secondary">
                  {opening === repo.path ? <PixelSpinner size={14} /> : <FolderGit2 size={14} />}
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-body-2-medium text-text-primary">{repo.name}</span>
                  <span className="truncate text-caption-1-regular text-text-secondary">{repo.relative}</span>
                </span>
                <span className="shrink-0 rounded-full border border-border-button-default px-1.5 text-[9px] font-medium text-text-tertiary">abrir</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
