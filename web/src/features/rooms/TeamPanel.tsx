import { Button as KitButton } from "@jeff/ui/kit";
import { Input as KitInput, NativeSelect as KitSelect } from "@jeff/ui/kit";
import { useEffect, useState } from "react";
import { Copy, Plus, Trash2 } from "@jeff/icons";
import { useApp } from "../../app/store";
import { api, type Invite, type Project, type User } from "../../shared/api";
import { formatDate } from "../../shared/time";

const quietButton =
  "inline-flex items-center gap-1 rounded-lg px-2 py-1 text-caption-1-medium text-text-secondary hover:bg-background-tertiary-default hover:text-text-primary";
const primaryButton =
  "inline-flex items-center gap-1 rounded-lg bg-accent-500 px-3 py-1.5 text-caption-1-medium text-white disabled:opacity-40";

interface Props {
  project: Project;
}

export default function TeamPanel({ project }: Props) {
  const me = useApp((state) => state.user);
  const [users, setUsers] = useState<User[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [members, setMembers] = useState<number[]>([]);
  const [error, setError] = useState("");
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [environment, setEnvironment] = useState<
    Array<{ id: string; label: string; installed: boolean }>
  >([]);
  const [installing, setInstalling] = useState("");
  const [installOutput, setInstallOutput] = useState("");

  async function refresh() {
    try {
      const [team, list, projectMembers, env] = await Promise.all([
        api.team(),
        api.invites(),
        api.projectMembers(project.id),
        api.environment(),
      ]);
      setUsers(team.users);
      setInvites(list.invites);
      setMembers(projectMembers.members.map((member) => member.id));
      setEnvironment(env.components);
      setError("");
    } catch (cause) {
      setError(
        cause instanceof Error && "status" in cause && (cause as { status: number }).status === 403
          ? "Só o admin do time vê esta área."
          : "Não foi possível carregar o time.",
      );
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  async function createInvite() {
    setBusy(true);
    try {
      const invite = await api.createInvite("member", 30);
      setLink(`${window.location.origin}/app/?invite=${encodeURIComponent(invite.token)}`);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível criar o convite.");
    } finally {
      setBusy(false);
    }
  }

  async function setRole(user: User, role: string) {
    try {
      await api.setRole(user.id, role);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível mudar o papel.");
    }
  }

  async function removeUser(user: User) {
    if (!window.confirm(`Remover ${user.displayName || user.username} do time?`)) return;
    try {
      await api.removeUser(user.id);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível remover.");
    }
  }

  async function revoke(invite: Invite) {
    try {
      await api.revokeInvite(invite.id);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível revogar.");
    }
  }

  async function toggleMember(user: User) {
    try {
      if (members.includes(user.id)) await api.removeProjectMember(project.id, user.id);
      else await api.addProjectMember(project.id, user.id);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível alterar o acesso.");
    }
  }

  async function install(component: string) {
    setInstalling(component);
    setInstallOutput("");
    try {
      const result = await api.installEnvironment(component);
      setInstallOutput(result.output || "Instalado.");
      await refresh();
    } catch (cause) {
      setInstallOutput(cause instanceof Error ? cause.message : "Falhou.");
    } finally {
      setInstalling("");
    }
  }

  const openInvites = invites.filter((invite) => !invite.usedAt);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-separator-border px-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-body-1-medium">Time</h2>
          <p className="truncate text-caption-1-regular text-text-tertiary">
            {users.length} pessoa{users.length === 1 ? "" : "s"} · quem vê {project.name}
          </p>
        </div>
        <KitButton variant="raw" className={primaryButton} onClick={() => void createInvite()} disabled={busy}>
          <Plus size={14} /> Convite
        </KitButton>
      </header>

      {error ? (
        <p className="border-b border-separator-border px-4 py-2 text-caption-2-regular text-red-500">
          {error}
        </p>
      ) : null}

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {link ? (
          <div className="rounded-xl border border-accent-500/40 bg-accent-500/10 p-3">
            <p className="text-caption-1-regular text-text-secondary">
              Link de convite (30 dias). Quem abrir cria a própria conta:
            </p>
            <div className="mt-1 flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate text-caption-2-regular text-text-tertiary">
                {link}
              </code>
              <KitButton variant="raw" className={quietButton} onClick={() => void navigator.clipboard?.writeText(link)}>
                <Copy size={14} /> copiar
              </KitButton>
            </div>
          </div>
        ) : null}

        <section>
          <h3 className="mb-2 text-caption-1-semibold text-text-secondary">Pessoas</h3>
          <div className="space-y-1">
            {users.map((user) => (
              <div
                key={user.id}
                className="flex flex-wrap items-center gap-2 rounded-xl border border-separator-border bg-background-secondary-default px-3 py-2"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body-2-medium">
                    {user.displayName || user.username}
                    {me?.id === user.id ? " (você)" : ""}
                  </span>
                  <span className="block truncate text-caption-2-regular text-text-tertiary">
                    @{user.username} · {user.activity || "sem atividade"}
                  </span>
                </span>
                <KitSelect raw
                  className="rounded-lg border border-border-button-default bg-background-primary-default px-2 py-1 text-caption-1-regular"
                  value={user.role ?? "member"}
                  onChange={(event) => void setRole(user, event.target.value)}
                  disabled={me?.id === user.id}
                >
                  <option value="admin">admin</option>
                  <option value="member">membro</option>
                </KitSelect>
                {me?.id !== user.id ? (
                  <KitButton variant="raw" className={quietButton} onClick={() => void removeUser(user)}>
                    <Trash2 size={12} />
                  </KitButton>
                ) : null}
              </div>
            ))}
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-caption-1-semibold text-text-secondary">
            Quem vê {project.name}
          </h3>
          <p className="mb-2 text-caption-2-regular text-text-tertiary">
            Admin vê todos os canais. Marque os membros que podem abrir este.
          </p>
          <div className="space-y-1">
            {users
              .filter((user) => user.role !== "admin")
              .map((user) => (
                <label
                  key={user.id}
                  className="flex items-center gap-2 rounded-xl border border-separator-border bg-background-secondary-default px-3 py-2 text-caption-1-regular"
                >
                  <KitInput raw
                    type="checkbox"
                    checked={members.includes(user.id)}
                    onChange={() => void toggleMember(user)}
                  />
                  {user.displayName || user.username}
                </label>
              ))}
            {users.every((user) => user.role === "admin") ? (
              <p className="text-caption-2-regular text-text-tertiary">Só admins no time.</p>
            ) : null}
          </div>
        </section>

        {environment.length > 0 ? (
          <section>
            <h3 className="mb-2 text-caption-1-semibold text-text-secondary">
              Ferramentas do servidor
            </h3>
            <p className="mb-2 text-caption-2-regular text-text-tertiary">
              Instala com apt-get. Só admin; nada fora desta lista.
            </p>
            <div className="space-y-1">
              {environment.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center gap-2 rounded-xl border border-separator-border px-3 py-2 text-caption-1-regular"
                >
                  <span className="min-w-0 flex-1">{item.label}</span>
                  <span
                    className={
                      item.installed ? "text-status-lime-text" : "text-text-tertiary"
                    }
                  >
                    {item.installed ? "instalado" : "ausente"}
                  </span>
                  {item.installed ? null : (
                    <KitButton variant="raw"
                      className={quietButton}
                      onClick={() => void install(item.id)}
                      disabled={Boolean(installing)}
                    >
                      {installing === item.id ? "instalando…" : "instalar"}
                    </KitButton>
                  )}
                </div>
              ))}
            </div>
            {installOutput ? (
              <pre className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap rounded-lg bg-background-tertiary-default p-2 text-caption-2-regular text-text-secondary">
                {installOutput}
              </pre>
            ) : null}
          </section>
        ) : null}

        {openInvites.length > 0 ? (
          <section>
            <h3 className="mb-2 text-caption-1-semibold text-text-secondary">Convites abertos</h3>
            <div className="space-y-1">
              {openInvites.map((invite) => (
                <div
                  key={invite.id}
                  className="flex items-center gap-2 rounded-xl border border-separator-border px-3 py-2 text-caption-2-regular text-text-secondary"
                >
                  <span className="min-w-0 flex-1 truncate">
                    {invite.role} · expira em {formatDate(invite.expiresAt)}
                  </span>
                  <KitButton variant="raw" className={quietButton} onClick={() => void revoke(invite)}>
                    revogar
                  </KitButton>
                </div>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
