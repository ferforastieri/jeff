import { useEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  Dialog,
  DialogBody,
  DialogFooter,
  EmptyState,
  Field,
  FilterChip,
  Icon,
  Input,
  PageHeader,
  SearchField,
  Segmented,
  Toolbar,
  type IconName,
} from "faang-ui";
import { api, type FileEntry, type Project } from "../../shared/api";
import { formatDate } from "../../shared/time";
import Markdown from "../../shared/Markdown";
import { usePrefs } from "../../shared/prefs";

type FileKind = "image" | "document" | "code" | "other";

const KIND_DEFS: Record<FileKind, { label: string; icon: IconName }> = {
  image: { label: "Imagem", icon: "image" },
  document: { label: "Documento", icon: "document" },
  code: { label: "Código", icon: "code" },
  other: { label: "Arquivo", icon: "file" },
};

const IMAGE = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "ico", "bmp"]);
const DOCUMENT = new Set(["md", "mdx", "txt", "pdf", "doc", "docx", "csv", "xls", "xlsx", "ppt", "pptx", "json", "yaml", "yml", "toml"]);
const CODE = new Set(["ts", "tsx", "js", "jsx", "css", "scss", "html", "rs", "go", "py", "java", "c", "h", "cpp", "sh", "sql", "astro", "vue", "svelte"]);

function isText(name: string): boolean {
  const ext = extension(name);
  return (
    CODE.has(ext) ||
    DOCUMENT.has(ext) ||
    ["md", "mdx", "txt", "csv", "json", "yaml", "yml", "toml", "xml", "env", "gitignore"].includes(ext)
  );
}

function extension(name: string): string {
  return name.includes(".") ? (name.split(".").pop() ?? "").toLowerCase() : "";
}

function kindOf(name: string): FileKind {
  const ext = extension(name);
  if (IMAGE.has(ext)) return "image";
  if (DOCUMENT.has(ext)) return "document";
  if (CODE.has(ext)) return "code";
  return "other";
}

function sizeText(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function words(value: string): string {
  return value.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
}

/** A file's own first heading is the dialog's title already. */
function withoutTitle(content: string, name: string): string {
  const lines = content.split("\n");
  const first = lines[0]?.trim() ?? "";
  const title = name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ");
  if (first.startsWith("# ") && words(first.slice(2)) === words(title)) {
    return lines.slice(1).join("\n").replace(/^\n+/, "");
  }
  return content;
}

interface Props {
  project: Project;
}

/**
 * Drive: the project's folders and files in the reference's grid (or list),
 * with search, kind filters, breadcrumbs and the file's own reader. A text
 * file opens where it lives; an image keeps its kind's cover.
 */
export default function DrivePanel({ project }: Props) {
  const [path, setPath] = useState("");
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [query, setQuery] = useState("");
  const [kinds, setKinds] = useState<string[]>([]);
  const prefs = usePrefs((state) => state.prefs);
  const updatePrefs = usePrefs((state) => state.update);
  const view = prefs.driveView === "list" ? "list" : "grid";
  const setView = (next: "grid" | "list") => updatePrefs({ driveView: next });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [folderOpen, setFolderOpen] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [preview, setPreview] = useState<{ entry: FileEntry; content: string } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const uploadRef = useRef<HTMLInputElement>(null);

  async function refresh(target = path) {
    if (!project.id) return;
    setLoading(true);
    try {
      const list = await api.tree(project.id, target);
      setEntries(
        [...list].sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1)),
      );
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível abrir a pasta.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh(path);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, path]);

  const trail = path.split("/").filter(Boolean);
  const folders = entries.filter((entry) => entry.dir);
  const files = entries.filter((entry) => !entry.dir);
  const searched = query.trim().toLowerCase();
  const shownFolders = folders.filter((entry) => !searched || entry.name.toLowerCase().includes(searched));
  const shownFiles = files.filter((entry) => {
    if (searched && !entry.name.toLowerCase().includes(searched)) return false;
    if (kinds.length > 0 && !kinds.includes(kindOf(entry.name))) return false;
    return true;
  });

  const kindOptions = useMemo(
    () =>
      (Object.keys(KIND_DEFS) as FileKind[])
        .map((kind) => ({
          value: kind,
          label: KIND_DEFS[kind].label,
          leading: <Icon name={KIND_DEFS[kind].icon} size={14} />,
          count: files.filter((entry) => kindOf(entry.name) === kind).length,
        }))
        .filter((option) => option.count > 0 || kinds.includes(option.value)),
    [files, kinds],
  );

  function openFolder(name: string) {
    setPath(path ? `${path}/${name}` : name);
    setQuery("");
    setKinds([]);
  }

  function goTo(index: number) {
    setPath(trail.slice(0, index + 1).join("/"));
    setQuery("");
    setKinds([]);
  }

  async function openFile(entry: FileEntry) {
    if (entry.dir) {
      openFolder(entry.name);
      return;
    }
    if (!isText(entry.name)) {
      setPreview({ entry, content: "" });
      return;
    }
    setPreviewLoading(true);
    setPreview(null);
    try {
      const result = await api.file(project.id, entry.path);
      setPreview({ entry, content: result.content });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível abrir o arquivo.");
    } finally {
      setPreviewLoading(false);
    }
  }

  async function createFolder() {
    if (!folderName.trim()) return;
    setBusy(true);
    setError("");
    try {
      const next = path ? `${path}/${folderName.trim()}` : folderName.trim();
      await api.makeDir(project.id, next);
      setFolderOpen(false);
      setFolderName("");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível criar a pasta.");
    } finally {
      setBusy(false);
    }
  }

  async function uploadFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    setError("");
    try {
      for (const file of Array.from(files)) {
        const data = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const value = String(reader.result ?? "");
            resolve(value.slice(value.indexOf(",") + 1));
          };
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(file);
        });
        await api.uploadFile(project.id, path ? `${path}/${file.name}` : file.name, data);
      }
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível enviar o arquivo.");
    } finally {
      setBusy(false);
      if (uploadRef.current) uploadRef.current.value = "";
    }
  }

  const title = trail.at(-1) ?? "Drive";
  const showing = shownFolders.length + shownFiles.length;
  const folderCount = entries.filter((entry) => entry.dir).length;
  const fileCount = files.length;

  return (
    <div className="ws-drive-page">
      <PageHeader
        title={title}
        meta={`${project.name} · ${folderCount} ${folderCount === 1 ? "pasta" : "pastas"} · ${fileCount} ${fileCount === 1 ? "arquivo" : "arquivos"}`}
        lead={
          trail.length > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              iconOnly
              icon="chevronLeft"
              aria-label="Subir uma pasta"
              title="Subir uma pasta"
              onClick={() => setPath(trail.slice(0, -1).join("/"))}
            />
          ) : undefined
        }
        actions={
          <>
            <Button variant="default" icon="plus" onClick={() => setFolderOpen(true)}>
              Nova pasta
            </Button>
            <Button variant="primary" icon="upload" loading={busy} onClick={() => uploadRef.current?.click()}>
              Enviar
            </Button>
            <input
              ref={uploadRef}
              type="file"
              multiple
              hidden
              onChange={(event) => void uploadFiles(event.target.files)}
            />
          </>
        }
      />

      {trail.length > 0 ? (
        <nav className="ws-drive-crumbs" aria-label="Caminho">
          <button type="button" onClick={() => setPath("")}>
            <Icon name="drive" size={14} />
            Drive
          </button>
          {trail.map((part, index) => (
            <span key={`${part}:${index}`}>
              <Icon name="chevronRight" size={14} />
              <button type="button" onClick={() => goTo(index)}>
                {part}
              </button>
            </span>
          ))}
        </nav>
      ) : null}

      <Toolbar
        label="Filtros do Drive"
        search={
          <SearchField
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onClear={() => setQuery("")}
            clearLabel="Limpar busca"
            placeholder="Buscar nesta pasta"
            aria-label="Buscar nesta pasta"
          />
        }
        actions={
          <Segmented<"grid" | "list">
            size="sm"
            label="Visão do Drive"
            value={view}
            onValueChange={setView}
            options={[
              {
                value: "grid",
                label: (
                  <>
                    <Icon name="grid" size={16} />
                    <span className="ac-visually-hidden">Grade</span>
                  </>
                ),
              },
              {
                value: "list",
                label: (
                  <>
                    <Icon name="list" size={16} />
                    <span className="ac-visually-hidden">Lista</span>
                  </>
                ),
              },
            ]}
          />
        }
      >
        {kindOptions.length > 0 ? (
          <FilterChip
            label="Tipo"
            icon="file"
            multiple
            options={kindOptions}
            value={kinds}
            onChange={setKinds}
            clearLabel="Limpar tipo"
            countText={(count) => `${count} tipos`}
          />
        ) : null}
        {query || kinds.length > 0 ? (
          <Button
            size="sm"
            variant="ghost"
            icon="close"
            onClick={() => {
              setQuery("");
              setKinds([]);
            }}
          >
            Limpar
          </Button>
        ) : null}
      </Toolbar>

      {error ? <p className="ws-error">{error}</p> : null}

      {loading ? (
        <p className="ws-muted">Carregando arquivos…</p>
      ) : showing === 0 ? (
        <EmptyState
          icon="drive"
          title={searched || kinds.length > 0 ? "Nada encontrado" : "Esta pasta está vazia"}
          actions={
            searched || kinds.length > 0 ? (
              <Button
                onClick={() => {
                  setQuery("");
                  setKinds([]);
                }}
              >
                Limpar filtros
              </Button>
            ) : (
              <>
                <Button variant="primary" icon="upload" onClick={() => uploadRef.current?.click()}>
                  Enviar arquivo
                </Button>
                <Button icon="plus" onClick={() => setFolderOpen(true)}>
                  Nova pasta
                </Button>
              </>
            )
          }
        >
          {searched || kinds.length > 0
            ? "Tente outro nome ou outro tipo de arquivo."
            : "Coloque os arquivos do projeto aqui, ou crie uma pasta."}
        </EmptyState>
      ) : view === "grid" ? (
        <div className="ws-drive-grid">
          {shownFolders.map((entry) => (
            <button
              key={entry.path}
              type="button"
              className="ws-file-card ws-file-card--folder"
              onClick={() => openFolder(entry.name)}
            >
              <span className="ws-file-card__cover" data-kind="folder">
                <Icon name="drive" size={20} />
              </span>
              <span className="ws-file-card__body">
                <span className="ws-file-card__title">{entry.name}</span>
                <span className="ws-file-card__meta">
                  <span>Pasta</span>
                  <time>{formatDate(entry.modTime)}</time>
                </span>
              </span>
            </button>
          ))}
          {shownFiles.map((entry) => {
            const kind = kindOf(entry.name);
            const def = KIND_DEFS[kind];
            return (
              <button
                key={entry.path}
                type="button"
                className="ws-file-card"
                onClick={() => void openFile(entry)}
              >
                <span className="ws-file-card__cover" data-kind={kind}>
                  <Icon name={def.icon} size={20} />
                  <span className="ws-file-card__ext">{extension(entry.name) || "arquivo"}</span>
                </span>
                <span className="ws-file-card__kind">
                  <Icon name={def.icon} size={14} />
                  {def.label}
                </span>
                <span className="ws-file-card__body">
                  <span className="ws-file-card__title">{entry.name}</span>
                  <span className="ws-file-card__meta">
                    <span>{sizeText(entry.size)}</span>
                    <time>{formatDate(entry.modTime)}</time>
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="ws-drive-table">
          <div className="ws-drive-table__head">
            <span>Nome</span>
            <span>Tipo</span>
            <span>Tamanho</span>
            <span>Modificado</span>
          </div>
          {[...shownFolders, ...shownFiles].map((entry) => {
            const kind = kindOf(entry.name);
            const def = KIND_DEFS[kind];
            return (
              <button
                key={entry.path}
                type="button"
                className="ws-drive-row"
                onClick={() => void openFile(entry)}
              >
                <span className="ws-drive-row__name">
                  <Icon name={entry.dir ? "drive" : def.icon} size={16} />
                  <span>
                    <b>{entry.name}</b>
                    <small>{entry.path}</small>
                  </span>
                </span>
                <span>{entry.dir ? "Pasta" : def.label}</span>
                <span className="tabular">{entry.dir ? "—" : sizeText(entry.size)}</span>
                <span>{formatDate(entry.modTime)}</span>
              </button>
            );
          })}
        </div>
      )}

      <Dialog
        open={folderOpen}
        onOpenChange={setFolderOpen}
        title="Nova pasta"
        description={path ? `Dentro de ${path}.` : "Na raiz do Drive."}
        closeLabel="Fechar"
        width={440}
      >
        <DialogBody className="ws-form">
          <Field label="Nome da pasta">
            <Input
              value={folderName}
              onChange={(event) => setFolderName(event.target.value)}
              placeholder="Ex.: referências"
              autoFocus
            />
          </Field>
          {error ? <p className="ws-error">{error}</p> : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="default" onClick={() => setFolderOpen(false)}>
            Cancelar
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void createFolder()}>
            Criar pasta
          </Button>
        </DialogFooter>
      </Dialog>

      <Dialog
        open={preview !== null || previewLoading}
        onOpenChange={(open) => {
          if (!open) {
            setPreview(null);
            setPreviewLoading(false);
          }
        }}
        title={preview?.entry.name ?? "Abrindo arquivo"}
        description={preview?.entry.path}
        closeLabel="Fechar"
        width={860}
      >
        <DialogBody className="ws-drive-preview">
          {previewLoading ? (
            <p className="ws-muted">Abrindo arquivo…</p>
          ) : preview ? (
            !isText(preview.entry.name) ? (
              <div className="ws-drive-preview__binary">
                <Icon name={KIND_DEFS[kindOf(preview.entry.name)].icon} size={20} />
                <p>Este arquivo não é texto. Abra-o no editor para ver o conteúdo.</p>
              </div>
            ) : /\.(md|mdx)$/i.test(preview.entry.name) ? (
              <Markdown source={withoutTitle(preview.content, preview.entry.name)} />
            ) : (
              <pre>{preview.content}</pre>
            )
          ) : null}
        </DialogBody>
        <DialogFooter
          note={
            preview ? (
              <Button
                variant="ghost"
                size="sm"
                icon="copy"
                onClick={() => void navigator.clipboard?.writeText(preview.entry.path)}
              >
                Copiar caminho
              </Button>
            ) : undefined
          }
        >
          <Button variant="default" onClick={() => setPreview(null)}>
            Fechar
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}
