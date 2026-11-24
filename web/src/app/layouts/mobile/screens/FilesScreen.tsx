import { useRef, useState } from "react";
import { FilePlus2, FolderPlus, Upload } from "@jeff/icons";
import { api, type Project } from "../../../../shared/api";
import { useApp } from "../../../store";
import FileTree from "../../../../features/explorer/components/FileTree";
import { Button } from "@jeff/ui/app";
import { Input } from "@jeff/ui/app";
import { Modal } from "@jeff/ui/app";

interface Props {
  project: Project;
  onOpenFile: (path: string, line?: number) => void;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",", 2)[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/** Mobile file browser: create, upload and open the project tree. */
export default function FilesScreen({ project, onOpenFile }: Props) {
  const notify = useApp((state) => state.notify);
  const [createKind, setCreateKind] = useState<"file" | "folder" | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [treeKey, setTreeKey] = useState(0);
  const uploadRef = useRef<HTMLInputElement>(null);

  function refresh() {
    setTreeKey((value) => value + 1);
  }

  async function create() {
    const value = name.trim();
    if (!value || !createKind) return;
    setBusy(true);
    try {
      if (createKind === "file") await api.saveFile(project.id, value, "", "");
      else await api.makeDir(project.id, value);
      setCreateKind(null);
      setName("");
      refresh();
      notify("success", `${createKind === "file" ? "Arquivo" : "Pasta"} ${value} criado${createKind === "file" ? "" : "a"}.`);
    } catch (err) {
      notify("error", err instanceof Error ? err.message : "Não foi possível criar.");
    } finally {
      setBusy(false);
    }
  }

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    try {
      for (const file of Array.from(files)) {
        await api.uploadFile(project.id, file.name, await fileToBase64(file));
      }
      refresh();
      notify("success", `${files.length} arquivo${files.length === 1 ? "" : "s"} enviado${files.length === 1 ? "" : "s"}.`);
    } catch (err) {
      notify("error", err instanceof Error ? err.message : "Falha no upload.");
    } finally {
      setBusy(false);
    }
  }

  function openCreate(kind: "file" | "folder") {
    setName("");
    setCreateKind(kind);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background-primary-default">
      <input
        ref={uploadRef}
        type="file"
        multiple
        hidden
        onChange={(event) => { void upload(event.target.files); event.target.value = ""; }}
      />
      <div className="relative z-20 flex shrink-0 items-center gap-2 bg-background-primary-default p-3 pb-2">
        <Button variant="secondary" size="small" leadingIcon={FilePlus2} onClick={() => openCreate("file")} className="h-10 min-w-0 flex-1 justify-center">
          <span className="truncate">Arquivo</span>
        </Button>
        <Button variant="secondary" size="small" leadingIcon={FolderPlus} onClick={() => openCreate("folder")} className="h-10 min-w-0 flex-1 justify-center">
          <span className="truncate">Pasta</span>
        </Button>
        <Button
          variant="secondary"
          size="small"
          leadingIcon={Upload}
          disabled={busy}
          onClick={() => uploadRef.current?.click()}
          className="h-10 min-w-0 flex-1 justify-center"
        >
          <span className="truncate">Enviar</span>
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col px-3 pb-3">
        <div className="px-1 pb-2 pt-1 text-caption-2-semibold uppercase tracking-[0.14em] text-text-tertiary">
          Repositório
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto rounded-3xl border border-border-button-white bg-background-primary-default p-1 shadow-xs [&_[role=treeitem]]:h-11 [&_[role=treeitem]]:rounded-2xl [&_[role=treeitem]]:px-2">
          <FileTree key={`${project.id}:${treeKey}`} project={project} onOpenFile={onOpenFile} embedded />
        </div>
      </div>

      <Modal isOpen={Boolean(createKind)} onClose={() => setCreateKind(null)} title={createKind === "folder" ? "Nova pasta" : "Novo arquivo"} description="Informe o caminho relativo ao repo." size="sm" bodyClassName="p-3">
        <div className="flex flex-col gap-3">
          <Input value={name} onChange={setName} placeholder={createKind === "folder" ? "nova-pasta" : "novo-arquivo.ts"} aria-label={createKind === "folder" ? "Nome da pasta" : "Nome do arquivo"} fieldClassName="h-10" />
          <Button className="h-11 w-full justify-center" disabled={busy || !name.trim()} onClick={() => void create()}>
            {busy ? "Criando..." : createKind === "folder" ? "Criar pasta" : "Criar arquivo"}
          </Button>
        </div>
      </Modal>

    </div>
  );
}
