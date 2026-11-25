import { useEffect, useState } from "react";
import {
  Button,
  Checkbox,
  Dialog,
  DialogBody,
  DialogFooter,
  Field,
  Icon,
  Input,
  Segmented,
  Select,
  Switch,
  Textarea,
} from "faang-ui";
import { api, type AIModel, type User } from "../../shared/api";
import { channelsApi, roomsApi, type Principal, type Room } from "../rooms/api";
import { formatDate } from "../../shared/time";
import { modelSelectOptions } from "../providers/store";

/** The invite that makes a person's account, with the cargo and how long it works. */
export function InviteUserDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const [role, setRole] = useState<"member" | "admin">("member");
  const [days, setDays] = useState("30");
  const [link, setLink] = useState("");
  const [expires, setExpires] = useState("");
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setRole("member");
    setDays("30");
    setLink("");
    setExpires("");
    setCopied(false);
    setError("");
  }, [open]);

  async function create() {
    setBusy(true);
    setError("");
    setCopied(false);
    try {
      const invite = await api.createInvite(role, Number(days));
      setLink(`${window.location.origin}/app/?invite=${encodeURIComponent(invite.token)}`);
      setExpires(invite.expiresAt);
      onCreated();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível criar o convite.");
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard?.writeText(link);
      setCopied(true);
    } catch {
      setError("Não foi possível copiar. Selecione o link e copie à mão.");
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Novo usuário"
      description="O convite cria a conta da pessoa já com o cargo escolhido."
      closeLabel="Fechar"
      width={520}
    >
      <DialogBody className="ws-form">
        <Field label="Cargo">
          <Segmented
            block
            label="Cargo"
            value={role}
            onValueChange={(value) => {
              setRole(value);
              setLink("");
              setCopied(false);
            }}
            options={[
              { value: "member", label: "Membro" },
              { value: "admin", label: "Admin" },
            ]}
          />
        </Field>
        <p className="ws-invite-hint">
          {role === "admin"
            ? "Admin vê tudo: pessoas, canais, modo dev e configurações."
            : "Membro fica nas conversas e nos canais liberados para a pessoa."}
        </p>
        <Field label="O link vale por">
          <Select
            value={days}
            onValueChange={(value) => {
              setDays(value);
              setLink("");
              setCopied(false);
            }}
            options={[
              { value: "7", label: "7 dias" },
              { value: "30", label: "30 dias" },
              { value: "90", label: "90 dias" },
            ]}
          />
        </Field>
        {link ? (
          <div className="ws-invite-made">
            <div className="ws-invite-made__row">
              <Input readOnly value={link} aria-label="Link do convite" onFocus={(event) => event.currentTarget.select()} />
              <Button variant="primary" icon={copied ? "check" : "copy"} onClick={() => void copy()}>
                {copied ? "Copiado" : "Copiar"}
              </Button>
            </div>
            <p className="ws-invite-made__note">
              <Icon name="clock" size={14} />
              Vale até {formatDate(expires)}. Quem abrir cria a própria conta.
            </p>
          </div>
        ) : null}
        {error ? <p className="ws-error">{error}</p> : null}
      </DialogBody>
      <DialogFooter note={link ? "Um convite por pessoa." : undefined}>
        <Button variant="default" onClick={() => onOpenChange(false)}>
          Fechar
        </Button>
        {link ? null : (
          <Button variant="primary" loading={busy} onClick={() => void create()}>
            Criar convite
          </Button>
        )}
      </DialogFooter>
    </Dialog>
  );
}

/** A person's cargo, dev access and the channels they may see. Changes apply at once. */
export function EditPersonDialog({
  user,
  channels,
  currentUserId,
  onClose,
  onChanged,
}: {
  user: User | null;
  channels: Room[];
  currentUserId: number | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [role, setRole] = useState<"admin" | "member">("member");
  const [dev, setDev] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user) return;
    setRole(user.role === "admin" ? "admin" : "member");
    setDev(Boolean(user.devAccess));
    setError("");
  }, [user]);

  if (!user) return null;
  const self = currentUserId === user.id;

  async function setRoleValue(value: "admin" | "member") {
    if (!user || value === role) return;
    setBusy("role");
    setError("");
    try {
      await api.setRole(user.id, value);
      setRole(value);
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível mudar o cargo.");
    } finally {
      setBusy("");
    }
  }

  async function setDevValue(value: boolean) {
    if (!user) return;
    setBusy("dev");
    setError("");
    try {
      await api.setDevAccess(user.id, value);
      setDev(value);
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível mudar o acesso ao Dev.");
    } finally {
      setBusy("");
    }
  }

  async function setChannel(room: Room, allowed: boolean) {
    if (!user) return;
    setBusy(`channel:${room.id}`);
    setError("");
    try {
      await channelsApi.setAccess(room.id, user.id, allowed);
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível mudar o canal.");
    } finally {
      setBusy("");
    }
  }

  async function remove() {
    if (!user) return;
    if (!window.confirm(`Remover ${user.displayName || user.username} do workspace?`)) return;
    setBusy("remove");
    setError("");
    try {
      await api.removeUser(user.id);
      onChanged();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível remover.");
    } finally {
      setBusy("");
    }
  }

  const allowed = (room: Room) =>
    role === "admin" || room.members.some((member) => member.kind === "human" && member.userId === user.id);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={user.displayName || user.username}
      description={`@${user.username}${user.activity ? ` · ${user.activity}` : ""}`}
      closeLabel="Fechar"
      width={520}
    >
      <DialogBody className="ws-form">
        <Field label="Cargo">
          <Segmented
            block
            label="Cargo"
            value={role}
            disabled={Boolean(busy) || self}
            onValueChange={(value) => void setRoleValue(value)}
            options={[
              { value: "member", label: "Membro" },
              { value: "admin", label: "Admin" },
            ]}
          />
        </Field>
        <p className="ws-invite-hint">
          {role === "admin"
            ? "Admin vê tudo: pessoas, canais, modo dev e configurações."
            : "Membro fica nas conversas e nos canais liberados para a pessoa."}
        </p>
        <label className="ws-team-dev">
          <Switch checked={dev} onCheckedChange={(value) => void setDevValue(value)} disabled={Boolean(busy)} />
          Acesso ao modo dev
        </label>
        <Field label="Canais que pode ver">
          <div className="ws-member-picker">
            {channels.map((room) => (
              <label className="ws-picker-row" key={room.id}>
                <Checkbox
                  checked={allowed(room)}
                  disabled={role === "admin" || busy === `channel:${room.id}`}
                  onCheckedChange={(value) => void setChannel(room, value === true)}
                />
                <Icon name="channel" size={16} />
                <span className="ws-picker-copy">
                  <strong>{room.name}</strong>
                </span>
              </label>
            ))}
            {channels.length === 0 ? <p className="ws-muted">Nenhum canal ainda.</p> : null}
          </div>
        </Field>
        {error ? <p className="ws-error">{error}</p> : null}
      </DialogBody>
      <DialogFooter
        note={
          self ? (
            <span className="ws-muted">Você não pode remover a própria conta.</span>
          ) : (
            <Button variant="ghost" size="sm" icon="trash" loading={busy === "remove"} onClick={() => void remove()}>
              Remover do workspace
            </Button>
          )
        }
      >
        <Button variant="default" onClick={onClose}>
          Fechar
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

/** An agent's name, face words, how it thinks and the channels it works in. */
export function EditAgentDialog({
  agent,
  channels,
  models,
  onConnect,
  onClose,
  onSaved,
}: {
  agent: Principal | null;
  channels: Room[];
  models: AIModel[];
  onConnect: () => void;
  onClose: () => void;
  onSaved: (bot: Principal) => void;
}) {
  const [name, setName] = useState("");
  const [handle, setHandle] = useState("");
  const [title, setTitle] = useState("");
  const [persona, setPersona] = useState("");
  const [engine, setEngine] = useState("opencode");
  const [model, setModel] = useState("");
  const [effort, setEffort] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!agent) return;
    setName(agent.name);
    setHandle(agent.handle);
    setTitle(agent.bot?.title ?? "");
    setPersona(agent.bot?.persona ?? "");
    setEngine(agent.bot?.engine || "opencode");
    setModel(agent.bot?.model ?? "");
    setEffort(agent.bot?.effort ?? "");
    setPicked(
      channels
        .filter((room) => room.members.some((member) => member.id === agent.id))
        .map((room) => room.id),
    );
    setError("");
    // The dialog opens with the agent's current channels; a background refresh must not reset the form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent?.id]);

  if (!agent) return null;

  const modelOptions = modelSelectOptions(models);
  if (model && !modelOptions.some((option) => option.value === model)) {
    modelOptions.unshift({ value: model, label: model });
  }

  async function save() {
    if (!agent) return;
    if (!name.trim()) {
      setError("Dê um nome ao agente.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const updated = await roomsApi.updateBot(agent.id, {
        name: name.trim(),
        handle: handle.trim(),
        title: title.trim(),
        persona: persona.trim(),
        engine,
        model: model.trim(),
        effort,
      });
      for (const room of channels) {
        const was = room.members.some((member) => member.id === agent.id);
        const now = picked.includes(room.id);
        if (was === now) continue;
        const bots = room.members.filter((member) => member.kind === "bot").map((member) => member.id);
        const next = now ? [...new Set([...bots, agent.id])] : bots.filter((id) => id !== agent.id);
        await channelsApi.setAgents(room.id, next);
      }
      onSaved(updated);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível salvar o agente.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Editar agente"
      description="Nome, papel, instruções e onde ele trabalha."
      closeLabel="Fechar"
      width={560}
    >
      <DialogBody className="ws-form">
        <div className="ws-form-grid">
          <Field label="Nome">
            <Input value={name} onChange={(event) => setName(event.target.value)} autoFocus />
          </Field>
          <Field label="Handle">
            <Input value={handle} onChange={(event) => setHandle(event.target.value)} />
          </Field>
        </div>
        <Field label="O que ele faz">
          <Input value={title} onChange={(event) => setTitle(event.target.value)} />
        </Field>
        <Field label="Instruções">
          <Textarea value={persona} onChange={(event) => setPersona(event.target.value)} rows={4} />
        </Field>
        <div className="ws-form-grid">
          <Field label="Engine">
            <Select
              value={engine}
              onValueChange={setEngine}
              options={[
                { value: "opencode", label: "OpenCode" },
                { value: "claude", label: "Claude Code" },
                { value: "codex", label: "Codex" },
              ]}
            />
          </Field>
          <Field label="Esforço">
            <Select
              value={effort}
              onValueChange={setEffort}
              placeholder="Padrão"
              options={[
                { value: "", label: "Padrão" },
                { value: "low", label: "Baixo" },
                { value: "medium", label: "Médio" },
                { value: "high", label: "Alto" },
              ]}
            />
          </Field>
        </div>
        <Field label="Modelo">
          {models.length > 0 ? (
            <Select
              value={model}
              onValueChange={(value) => {
                setModel(value);
                const found = models.find((item) => item.id === value);
                if (found?.engine) setEngine(found.engine);
              }}
              placeholder="Escolha um modelo"
              options={modelOptions}
            />
          ) : (
            <Button type="button" variant="default" size="sm" onClick={onConnect}>
              Conectar IA
            </Button>
          )}
        </Field>
        <Field label="Canais">
          <div className="ws-member-picker">
            {channels.map((room) => (
              <label className="ws-picker-row" key={room.id}>
                <Checkbox
                  checked={picked.includes(room.id)}
                  onCheckedChange={() =>
                    setPicked((current) =>
                      current.includes(room.id)
                        ? current.filter((id) => id !== room.id)
                        : [...current, room.id],
                    )
                  }
                />
                <Icon name="channel" size={16} />
                <span className="ws-picker-copy">
                  <strong>{room.name}</strong>
                </span>
              </label>
            ))}
            {channels.length === 0 ? <p className="ws-muted">Nenhum canal ainda.</p> : null}
          </div>
        </Field>
        {error ? <p className="ws-error">{error}</p> : null}
      </DialogBody>
      <DialogFooter>
        <Button variant="default" onClick={onClose}>
          Cancelar
        </Button>
        <Button variant="primary" loading={busy} onClick={() => void save()}>
          Salvar agente
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
