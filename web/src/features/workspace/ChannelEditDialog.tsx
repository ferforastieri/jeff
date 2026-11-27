import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Checkbox,
  Dialog,
  DialogBody,
  DialogFooter,
  Field,
  Icon,
  Input,
  SearchField,
  Select,
} from "faang-ui";
import type { Repository } from "../../shared/api";
import type { ChannelCategory, Principal, Room } from "../rooms/api";
import { channelsApi } from "../rooms/api";
import { ImageCropDialog } from "../onboarding/ImageCropDialog";
import { faceOf } from "./face";

interface Props {
  room: Room | null;
  categories: ChannelCategory[];
  humans: Principal[];
  bots: Principal[];
  repos: Repository[];
  reposLoading?: boolean;
  onClose: () => void;
  onSaved: (room: Room) => void;
}

/**
 * The channel's whole configuration in one place: name, topic, category,
 * visibility, people, agents and repositories. The row menu only offers
 * Edit and Delete.
 */
export default function ChannelEditDialog({
  room,
  categories,
  humans,
  bots,
  repos,
  reposLoading = false,
  onClose,
  onSaved,
}: Props) {
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("");
  const [iconOpen, setIconOpen] = useState(false);
  const [topic, setTopic] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [visibility, setVisibility] = useState<"public" | "private">("public");
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [agentIds, setAgentIds] = useState<string[]>([]);
  const [repoPaths, setRepoPaths] = useState<string[]>([]);
  const [repoQuery, setRepoQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!room) return;
    setName(room.name);
    setIcon(room.icon ?? "");
    setTopic(room.title);
    setCategoryId(room.categoryId ?? "");
    setVisibility(room.visibility === "private" ? "private" : "public");
    setMemberIds(room.members.filter((member) => member.kind === "human").map((member) => member.id));
    setAgentIds(room.members.filter((member) => member.kind === "bot").map((member) => member.id));
    setRepoPaths(room.repos);
    setRepoQuery("");
    setError("");
  }, [room]);

  const visibleRepos = useMemo(() => {
    const needle = repoQuery.trim().toLowerCase();
    if (!needle) return repos;
    return repos.filter((repo) => `${repo.name} ${repo.path}`.toLowerCase().includes(needle));
  }, [repoQuery, repos]);

  if (!room) return null;

  function toggle(list: string[], id: string): string[] {
    return list.includes(id) ? list.filter((value) => value !== id) : [...list, id];
  }

  async function save() {
    if (!room || busy) return;
    if (!name.trim()) {
      setError("Dê um nome ao canal.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const updated = await channelsApi.update(room.id, {
        name: name.trim(),
        icon,
        title: topic.trim(),
        instructions: room.instructions,
        visibility,
        categoryId: categoryId || null,
        memberIds,
        agentIds,
        repos: repoPaths,
      });
      onSaved(updated);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível salvar o canal.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Editar canal"
      description="Tudo do canal num só lugar: nome, tópico, categoria, acesso, pessoas, agentes e repos."
      closeLabel="Fechar"
      width={620}
    >
      <DialogBody className="ws-form">
        <Field label="Nome do canal">
          <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex.: marketing" autoFocus />
        </Field>
        <Field label="Ícone do canal">
          <div className="ws-icon-field">
            <span className="ws-icon-preview">
              {icon ? <img src={icon} alt="" draggable={false} /> : <Icon name="channel" size={20} />}
            </span>
            <div className="ws-icon-actions">
              <Button variant="default" size="sm" onClick={() => setIconOpen(true)}>
                {icon ? "Trocar imagem" : "Enviar imagem"}
              </Button>
              {icon ? (
                <Button variant="ghost" size="sm" onClick={() => setIcon("")}>
                  Remover
                </Button>
              ) : null}
            </div>
          </div>
        </Field>
        <Field label="Tópico">
          <Input value={topic} onChange={(event) => setTopic(event.target.value)} placeholder="Do que o canal trata?" />
        </Field>
        <Field label="Categoria">
          <Select
            value={categoryId}
            onValueChange={setCategoryId}
            placeholder="Sem categoria"
            options={[
              { value: "", label: "Sem categoria" },
              ...categories.map((category) => ({ value: category.id, label: category.name })),
            ]}
          />
        </Field>
        <Field label="Quem pode entrar">
          <Select
            value={visibility}
            onValueChange={(value) => setVisibility(value === "private" ? "private" : "public")}
            options={[
              { value: "public", label: "Todos no workspace" },
              { value: "private", label: "Só quem for adicionado" },
            ]}
          />
        </Field>
        <Field label="Pessoas">
          <div className="ws-member-picker">
            {humans.map((person) => (
              <label className="ws-picker-row" key={person.id}>
                <Checkbox
                  checked={memberIds.includes(person.id)}
                  onCheckedChange={() => setMemberIds((current) => toggle(current, person.id))}
                />
                {faceOf(person, 28)}
                <span className="ws-picker-copy">
                  <strong>{person.name}</strong>
                  <small>@{person.handle}</small>
                </span>
              </label>
            ))}
            {humans.length === 0 ? <p className="ws-muted">Só você por aqui.</p> : null}
          </div>
        </Field>
        <Field label="Agentes">
          <div className="ws-member-picker">
            {bots.map((bot) => (
              <label className="ws-picker-row" key={bot.id}>
                <Checkbox
                  checked={agentIds.includes(bot.id)}
                  onCheckedChange={() => setAgentIds((current) => toggle(current, bot.id))}
                />
                {faceOf(bot, 28)}
                <span className="ws-picker-copy">
                  <strong>{bot.name}</strong>
                  <small>{bot.bot?.title || "agente"}</small>
                </span>
              </label>
            ))}
            {bots.length === 0 ? <p className="ws-muted">Nenhum agente no workspace.</p> : null}
          </div>
        </Field>
        <Field label="Repositórios">
          <SearchField
            value={repoQuery}
            onChange={(event) => setRepoQuery(event.target.value)}
            placeholder="Buscar repo…"
            size="sm"
            onClear={() => setRepoQuery("")}
            clearLabel="Limpar busca"
          />
          <div className="ws-repo-list">
            {reposLoading ? <p className="ws-muted">Carregando repos…</p> : null}
            {!reposLoading && visibleRepos.map((repo) => (
              <label className="ws-repo-option" key={repo.path}>
                <Checkbox
                  checked={repoPaths.includes(repo.path)}
                  onCheckedChange={() => setRepoPaths((current) => toggle(current, repo.path))}
                />
                <span>
                  <strong>{repo.name}</strong>
                  <small>{repo.path}</small>
                </span>
              </label>
            ))}
            {!reposLoading && visibleRepos.length === 0 ? (
              <p className="ws-muted">Nenhum repositório encontrado.</p>
            ) : null}
          </div>
        </Field>
        {error ? <p className="ws-error">{error}</p> : null}
      </DialogBody>
      <DialogFooter>
        <Button variant="default" onClick={onClose}>Cancelar</Button>
        <Button variant="primary" loading={busy} onClick={() => void save()}>Salvar canal</Button>
      </DialogFooter>
    </Dialog>
    <ImageCropDialog
      open={iconOpen}
      title="Ícone do canal"
      description="Arraste para enquadrar. O quadrado é o que aparece na sidebar e no topo do canal."
      placeholder={
        icon ? <img src={icon} alt="" draggable={false} /> : <Icon name="channel" size={20} />
      }
      onClose={() => setIconOpen(false)}
      onSave={setIcon}
    />
    </>
  );
}
