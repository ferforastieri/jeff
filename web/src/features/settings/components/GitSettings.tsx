import { useEffect, useState } from "react";
import { Check, CircleAlert, GitBranch, Save, Trash2 } from "@jeff/icons";
import { api, type GitConnection } from "../../../shared/api";
import { useApp } from "../../../app/store";
import { Button, Input } from "@jeff/ui/app";
import { cx } from "@jeff/ui";

const PROVIDERS = [
  {
    id: "github",
    label: "GitHub",
    hint: "Personal access token com acesso de leitura e escrita aos repositórios.",
    username: "x-access-token",
    site: "https://github.com/settings/tokens",
  },
  {
    id: "bitbucket",
    label: "Bitbucket",
    hint: "App password ou access token com permissão de repositório.",
    username: "x-token-auth",
    site: "https://bitbucket.org/account/settings/app-passwords/",
  },
] as const;

export default function GitSettings() {
  const notify = useApp((state) => state.notify);
  const [connections, setConnections] = useState<GitConnection[]>([]);
  const [forms, setForms] = useState<Record<string, { username: string; token: string }>>({});
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  async function load() {
    try {
      const result = await api.gitConnections();
      setConnections(result.connections);
      setForms((current) => {
        const next = { ...current };
        for (const connection of result.connections) {
          next[connection.provider] = next[connection.provider] ?? {
            username: connection.username || "",
            token: "",
          };
        }
        return next;
      });
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível ler as conexões Git.");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function patch(provider: string, field: "username" | "token", value: string) {
    setForms((current) => {
      const previous = current[provider] ?? { username: "", token: "" };
      return { ...current, [provider]: { ...previous, [field]: value } };
    });
  }

  async function save(provider: string) {
    const form = forms[provider];
    if (!form?.token.trim()) {
      setError("Informe o token do provedor.");
      return;
    }
    setBusy(provider);
    setError("");
    try {
      await api.saveGitConnection(provider, {
        username: form.username.trim(),
        token: form.token.trim(),
      });
      notify("success", `${PROVIDERS.find((item) => item.id === provider)?.label ?? provider} conectado.`);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível salvar a conexão Git.");
    } finally {
      setBusy("");
    }
  }

  async function remove(provider: string) {
    setBusy(provider);
    setError("");
    try {
      await api.deleteGitConnection(provider);
      notify("success", "Conexão Git removida.");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível remover a conexão Git.");
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h3 className="flex items-center gap-2 text-body-medium text-text-primary"><GitBranch size={16} /> Git</h3>
        <p className="mt-1 text-caption-1-regular text-text-secondary">
          Cada pessoa conecta a própria conta. O terminal e os agentes usam esse token apenas quando você está operando.
        </p>
      </div>

      {error ? (
        <p role="alert" className="flex items-center gap-2 rounded-xl border border-status-rose-border bg-status-rose-bg px-3 py-2 text-caption-1-regular text-status-rose-text">
          <CircleAlert size={13} /> {error}
        </p>
      ) : null}

      {PROVIDERS.map((provider) => {
        const connection = connections.find((item) => item.provider === provider.id);
        const form = forms[provider.id] ?? { username: connection?.username ?? "", token: "" };
        return (
          <section key={provider.id} className="flex flex-col gap-3 rounded-2xl border border-border-button-default p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <strong className="text-body-2-medium text-text-primary">{provider.label}</strong>
                  <span className={cx("rounded-full px-1.5 py-px text-[10px] font-semibold", connection?.connected ? "bg-status-lime-bg text-status-lime-text" : "bg-status-yellow-bg text-status-yellow-text")}>
                    {connection?.connected ? "conectado" : "não conectado"}
                  </span>
                </div>
                <p className="mt-1 text-caption-2-regular text-text-secondary">{provider.hint}</p>
              </div>
              <a href={provider.site} target="_blank" rel="noreferrer" className="text-caption-2-regular text-accent-600 hover:text-accent-500">
                Criar token
              </a>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <Input
                label="Usuário"
                value={form.username}
                onChange={(value) => patch(provider.id, "username", value)}
                placeholder={provider.username}
              />
              <Input
                label={connection?.connected ? "Novo token (vazio mantém)" : "Token"}
                type="password"
                value={form.token}
                onChange={(value) => patch(provider.id, "token", value)}
                autoComplete="off"
                placeholder="••••••••"
              />
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2">
              {connection?.connected ? (
                <Button type="button" variant="ghost" size="small" leadingIcon={Trash2} disabled={busy === provider.id} onClick={() => void remove(provider.id)}>
                  Remover
                </Button>
              ) : null}
              <Button type="button" variant="primary" size="small" leadingIcon={connection?.connected ? Check : Save} disabled={busy === provider.id} onClick={() => void save(provider.id)}>
                {busy === provider.id ? "Salvando…" : connection?.connected ? "Atualizar" : "Conectar"}
              </Button>
            </div>
          </section>
        );
      })}
    </div>
  );
}
