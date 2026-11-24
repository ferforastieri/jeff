import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Dialog,
  DialogBody,
  DialogFooter,
  EmptyState,
  Field,
  GroupHeading,
  Icon,
  Input,
  Kbd,
  ListRow,
  SearchField,
  Textarea,
} from "faang-ui";
import { api, type Project } from "../../shared/api";
import { formatDate } from "../../shared/time";
import Markdown, { markdownHeadingId } from "../../shared/Markdown";

function pageTitle(path: string): string {
  const name = (path.split("/").pop() ?? path).replace(/\.(md|mdx)$/i, "");
  const words = name.replace(/[-_]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function folderOf(path: string): string {
  return path.split("/").slice(0, -1).join("/");
}

function words(value: string): string {
  return value.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
}

/** The file's own first heading is the reader's title already. */
function bodyWithoutTitle(body: string, title: string): string {
  const lines = body.split("\n");
  const first = lines[0]?.trim() ?? "";
  if (first.startsWith("# ") && words(first.slice(2)) === words(title)) {
    return lines.slice(1).join("\n").replace(/^\n+/, "");
  }
  return body;
}

function outlineOf(body: string, title: string): { level: number; text: string; id: string }[] {
  const lines = bodyWithoutTitle(body, title).split("\n");
  const items: { level: number; text: string; id: string }[] = [];
  for (const line of lines) {
    const match = /^(#{1,3})\s+(.+)$/.exec(line.trim());
    if (!match) continue;
    items.push({
      level: match[1]?.length ?? 1,
      text: match[2] ?? "",
      id: markdownHeadingId(match[2] ?? ""),
    });
  }
  return items;
}

function slugify(title: string): string {
  return title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function groupsOf(pages: string[], current: string | null) {
  const groups = new Map<string, string[]>();
  for (const page of pages) {
    const folder = folderOf(page);
    const list = groups.get(folder);
    if (list) list.push(page);
    else groups.set(folder, [page]);
  }
  return [...groups.entries()].sort(([a], [b]) => {
    if (a === folderOf(current ?? "")) return -1;
    if (b === folderOf(current ?? "")) return 1;
    return a.localeCompare(b);
  });
}

interface Props {
  project: Project;
}

/** The workspace wiki: a tree of Markdown pages beside the document. */
export default function WikiPanel({ project }: Props) {
  const [pages, setPages] = useState<string[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [hash, setHash] = useState("");
  const [modTime, setModTime] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [pageLoading, setPageLoading] = useState(false);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");

  async function refresh(next?: string | null) {
    if (!project.id) return;
    setLoading(true);
    try {
      const files = await api.files(project.id);
      const list = files.filter((path) => /\.(md|mdx)$/i.test(path)).sort((a, b) => a.localeCompare(b));
      setPages(list);
      const pick = next !== undefined ? next : current && list.includes(current) ? current : (list[0] ?? null);
      setCurrent(pick);
      if (!pick) {
        setContent("");
        setHash("");
        setModTime("");
      }
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível abrir a wiki.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  useEffect(() => {
    if (!current || !project.id) return;
    let alive = true;
    setPageLoading(true);
    setEditing(false);
    void api
      .file(project.id, current)
      .then((file) => {
        if (!alive) return;
        setContent(file.content);
        setHash(file.hash);
        setModTime(file.modTime);
        setDraft(file.content);
        setError("");
      })
      .catch((cause: unknown) => {
        if (alive) setError(cause instanceof Error ? cause.message : "Não foi possível abrir a página.");
      })
      .finally(() => {
        if (alive) setPageLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [current, project.id]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const el = event.target instanceof Element ? event.target : null;
      if (el?.closest("input, textarea, [contenteditable], [role=dialog], [role=menu]")) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key.toLowerCase() === "e" && current && !editing) {
        event.preventDefault();
        setEditing(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, editing]);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return pages;
    return pages.filter((path) => path.toLowerCase().includes(needle) || pageTitle(path).toLowerCase().includes(needle));
  }, [pages, query]);

  const groups = useMemo(() => groupsOf(shown, current), [current, shown]);
  const outline = useMemo(() => (current ? outlineOf(content, pageTitle(current)) : []), [content, current]);

  async function save() {
    if (!current) return;
    setSaving(true);
    setError("");
    try {
      const file = await api.saveFile(project.id, current, draft, hash);
      setContent(file.content);
      setHash(file.hash);
      setModTime(file.modTime);
      setDraft(file.content);
      setEditing(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível salvar a página.");
    } finally {
      setSaving(false);
    }
  }

  async function create() {
    const title = newTitle.trim();
    if (!title || !project.id) return;
    const slug = slugify(title);
    if (!slug) {
      setError("Escolha um nome para a página.");
      return;
    }
    const path = `wiki/${slug}.md`;
    if (pages.includes(path)) {
      setError("Já existe uma página com esse nome.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      try {
        await api.makeDir(project.id, "wiki");
      } catch {
        /* the folder already exists */
      }
      const body = `# ${title}\n\n`;
      await api.saveFile(project.id, path, body, "");
      setCreating(false);
      setNewTitle("");
      await refresh(path);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível criar a página.");
    } finally {
      setSaving(false);
    }
  }

  const title = current ? pageTitle(current) : "Wiki";
  const folder = current ? folderOf(current) : "";

  return (
    <div className="ws-wiki-page">
      {error ? <p className="ws-error">{error}</p> : null}
      <div className="ws-wiki">
        <aside className="ws-wiki__nav" aria-label="Páginas da wiki">
          <header className="ws-wiki__navhead">
            <h1>Wiki</h1>
            <Button
              size="sm"
              variant="ghost"
              iconOnly
              icon="plus"
              aria-label="Nova página"
              title="Nova página"
              onClick={() => setCreating(true)}
            />
          </header>
          <SearchField
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onClear={() => setQuery("")}
            clearLabel="Limpar busca"
            placeholder="Buscar página"
            aria-label="Buscar página"
            size="sm"
          />
          <div className="ws-wiki__tree">
            {groups.map(([group, list]) => (
              <div className="ws-wiki__group" key={group || "root"}>
                <GroupHeading title={group || "Páginas"} count={list.length} />
                {list.map((path) => (
                  <ListRow
                    key={path}
                    className={current === path ? "is-active" : undefined}
                    lead={<Icon name="book" size={16} />}
                    title={pageTitle(path)}
                    onClick={() => setCurrent(path)}
                  />
                ))}
              </div>
            ))}
          </div>
          {!loading && pages.length === 0 ? (
            <p className="ws-muted">Nenhuma página ainda. O projeto tem Markdown? Ele aparece aqui.</p>
          ) : null}
          {current && outline.length > 0 ? (
            <div className="ws-wiki__outline">
              <span>Nesta página</span>
              {outline.map((item) => (
                <button
                  key={`${item.id}:${item.text}`}
                  type="button"
                  data-level={item.level}
                  onClick={() => document.getElementById(item.id)?.scrollIntoView({ block: "start", behavior: "smooth" })}
                >
                  {item.text}
                </button>
              ))}
            </div>
          ) : null}
        </aside>

        <main className="ws-wiki__doc">
          {!current ? (
            <EmptyState
              icon="book"
              title="A wiki do workspace"
              actions={
                <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
                  Criar a primeira página
                </Button>
              }
            >
              Documente como o time trabalha, os processos e o que os agentes precisam saber.
            </EmptyState>
          ) : pageLoading ? (
            <p className="ws-muted">Abrindo página…</p>
          ) : (
            <>
              <div className="ws-wiki__dochead">
                <div className="ws-wiki__crumbs">
                  <span>Wiki</span>
                  {folder ? (
                    <>
                      <Icon name="chevronRight" size={14} />
                      <span>{folder}</span>
                    </>
                  ) : null}
                </div>
                <div className="ws-wiki__acts">
                  {editing ? (
                    <>
                      <Button variant="ghost" onClick={() => setEditing(false)}>
                        Cancelar
                      </Button>
                      <Button variant="primary" loading={saving} onClick={() => void save()}>
                        Salvar
                      </Button>
                    </>
                  ) : (
                    <Button variant="default" size="sm" icon="edit" onClick={() => setEditing(true)}>
                      Editar
                      <Kbd>E</Kbd>
                    </Button>
                  )}
                </div>
              </div>
              <h1 className="ws-wiki__title">{title}</h1>
              <p className="ws-wiki__meta">
                {current}
                {modTime ? ` · atualizado em ${formatDate(modTime)}` : ""}
              </p>
              {editing ? (
                <div className="ws-wiki__editor">
                  <Textarea
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    rows={22}
                    aria-label={`Editar ${title}`}
                  />
                </div>
              ) : (
                <article className="ws-wiki__reader">
                  <Markdown source={bodyWithoutTitle(content, title)} />
                </article>
              )}
            </>
          )}
        </main>
      </div>

      <Dialog
        open={creating}
        onOpenChange={setCreating}
        title="Nova página"
        description="Uma página em Markdown na pasta wiki/ do projeto."
        closeLabel="Fechar"
        width={480}
      >
        <DialogBody className="ws-form">
          <Field label="Título">
            <Input value={newTitle} onChange={(event) => setNewTitle(event.target.value)} placeholder="Ex.: Como trabalhamos" autoFocus />
          </Field>
          {error ? <p className="ws-error">{error}</p> : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="default" onClick={() => setCreating(false)}>
            Cancelar
          </Button>
          <Button variant="primary" loading={saving} onClick={() => void create()}>
            Criar página
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}
