import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  CircleAlert,
  KeyRound,
  LoaderCircle,
  PlugZap,
  Plus,
  RefreshCw,
  Server,
  Trash2,
  Wrench,
} from "@jeff/icons";
import { agentApi, type McpServer } from "../../agents/api";
import { useApp } from "../../../app/store";
import { cx } from "@jeff/ui";
import { Button, Input, Select, SelectItem } from "@jeff/ui/app";
import ProviderIcon from "../../providers/components/ProviderIcon";

interface EnvField {
  key: string;
  label: string;
  placeholder?: string;
  secret?: boolean;
}

interface ConnectorPreset {
  id: string;
  name: string;
  description: string;
  /** How the user proves access: an API token by default, or a generic MCP. */
  mode: "api" | "mcp";
  transport: "http" | "stdio";
  url?: string;
  command?: string[];
  tokenLabel?: string;
  envFields?: EnvField[];
  timeoutSeconds?: number;
}

const PRESETS: ConnectorPreset[] = [
  {
    id: "github",
    name: "GitHub",
    description: "Repositórios, issues e pull requests via API token.",
    mode: "api",
    transport: "http",
    url: "https://api.githubcopilot.com/mcp/",
    tokenLabel: "Personal access token",
  },
  {
    id: "jira",
    name: "Jira / Atlassian",
    description: "Issues e projetos do Jira com API token.",
    mode: "api",
    transport: "stdio",
    command: ["uvx", "mcp-atlassian"],
    envFields: [
      { key: "JIRA_URL", label: "URL do site", placeholder: "https://empresa.atlassian.net" },
      { key: "JIRA_USERNAME", label: "E-mail da conta" },
      { key: "JIRA_API_TOKEN", label: "API token", secret: true },
    ],
  },
  {
    id: "bitbucket",
    name: "Bitbucket",
    description: "Workspaces, repositórios e pull requests via API token.",
    mode: "api",
    transport: "stdio",
    command: ["npx", "-y", "bitbucket-cloud-mcp-server"],
    envFields: [
      { key: "BITBUCKET_WORKSPACE", label: "Workspace", placeholder: "minha-empresa" },
      { key: "BITBUCKET_EMAIL", label: "E-mail da conta" },
      { key: "BITBUCKET_TOKEN", label: "API token", secret: true },
    ],
  },
  {
    id: "custom",
    name: "Outro MCP",
    description: "Qualquer servidor MCP por URL ou comando local.",
    mode: "mcp",
    transport: "http",
  },
];

const emptyForm = {
  id: "",
  preset: "custom" as string,
  name: "",
  transport: "http" as "http" | "stdio",
  url: "",
  command: '["npx", "-y", "seu-servidor-mcp"]',
  token: "",
  env: "{}",
};

function presetFor(server: McpServer): ConnectorPreset {
  if (/githubcopilot\.com/i.test(server.url)) return PRESETS[0];
  const command = server.command.join(" ");
  if (/mcp-atlassian/i.test(command)) return PRESETS[1];
  if (/bitbucket/i.test(command)) return PRESETS[2];
  return PRESETS[3];
}

function ConnectorLogo({ id, className }: { id: string; className?: string }) {
  if (id === "github") return <ProviderIcon provider="github" className={className} />;
  if (id === "jira") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden className={cx("shrink-0", className)}>
        <rect width="24" height="24" rx="6" fill="#2684FF" />
        <path d="M12 4.5 19 11.5l-3.2 3.2L12 10.9l-3.8 3.8L5 11.5 12 4.5Z" fill="#fff" />
        <path d="m12 13.4 3.8 3.8L12 21l-3.8-3.8 3.8-3.8Z" fill="#fff" opacity=".7" />
      </svg>
    );
  }
  if (id === "bitbucket") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden className={cx("shrink-0", className)}>
        <rect width="24" height="24" rx="6" fill="#0052CC" />
        <path d="M6 6h12l-1.8 12H7.8L6 6Zm3.2 3.4.5 4.2h4.6l.5-4.2H9.2Z" fill="#fff" />
      </svg>
    );
  }
  return <PlugZap className={className} />;
}

/** Global connectors: the harness receives every server configured here. */
export default function ConnectorsSettings() {
  const notify = useApp((state) => state.notify);
  const [servers, setServers] = useState<McpServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ ...emptyForm });
  const [chosen, setChosen] = useState(false);
  const [envValues, setEnvValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState("");
  const [results, setResults] = useState<Record<string, { ok: boolean; text: string }>>({});

  const preset = useMemo(() => PRESETS.find((item) => item.id === form.preset) ?? PRESETS[3], [form.preset]);
  const editing = Boolean(form.id);

  const load = useCallback(async () => {
    try {
      setServers(await agentApi.mcpServers());
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível carregar os conectores.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function openPreset(next: ConnectorPreset) {
    setForm({
      ...emptyForm,
      preset: next.id,
      name: next.name,
      transport: next.transport,
      url: next.url ?? "",
      command: next.command ? JSON.stringify(next.command) : emptyForm.command,
    });
    setEnvValues(Object.fromEntries((next.envFields ?? []).map((field) => [field.key, ""])));
    setChosen(true);
    setError("");
  }

  function edit(server: McpServer) {
    const found = presetFor(server);
    setForm({
      id: server.id,
      preset: found.id,
      name: server.name,
      transport: server.transport,
      url: server.url,
      command: JSON.stringify(server.command),
      token: "",
      env: "{}",
    });
    setEnvValues(Object.fromEntries((found.envFields ?? []).map((field) => [field.key, ""])));
    setChosen(true);
    setError("");
  }

  function close() {
    setForm({ ...emptyForm });
    setEnvValues({});
    setChosen(false);
    setError("");
  }

  async function save() {
    setBusy(true);
    setError("");
    try {
      let command: string[] = [];
      let env: Record<string, string> = {};
      if (preset.id === "jira") {
        const missing = (preset.envFields ?? []).filter((field) => !(envValues[field.key] ?? "").trim());
        if (!editing && missing.length) throw new Error(`Preencha: ${missing.map((field) => field.label).join(", ")}.`);
      }
      if (preset.id === "github" && !editing && !form.token.trim()) {
        throw new Error("Informe o personal access token do GitHub.");
      }
      if (form.transport === "stdio") {
        const parsed = JSON.parse(form.command);
        if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) {
          throw new Error("O comando deve ser uma lista JSON de strings.");
        }
        command = parsed;
        if (preset.envFields?.length) {
          for (const field of preset.envFields) {
            const value = (envValues[field.key] ?? "").trim();
            if (value) env[field.key] = value;
          }
        } else {
          const parsedEnv = JSON.parse(form.env || "{}");
          if (!parsedEnv || Array.isArray(parsedEnv) || typeof parsedEnv !== "object") {
            throw new Error("As variáveis de ambiente devem ser um objeto JSON.");
          }
          env = parsedEnv as Record<string, string>;
        }
      }
      const saved = await agentApi.saveMcp({
        id: form.id || undefined,
        name: form.name.trim() || preset.name,
        transport: form.transport,
        url: form.url.trim(),
        command,
        token: form.token,
        env,
        timeoutSeconds: preset.timeoutSeconds,
      });
      await load();
      close();
      if (saved.id) await test(saved.id);
      notify("success", form.id ? "Conector atualizado." : "Conector salvo e testado.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível salvar o conector.");
    } finally {
      setBusy(false);
    }
  }

  async function test(id: string) {
    setTesting(id);
    try {
      const result = await agentApi.testMcp(id);
      setResults((current) => ({
        ...current,
        [id]: { ok: true, text: `Conectado · ${result.tools} ferramenta${result.tools === 1 ? "" : "s"}` },
      }));
    } catch (caught) {
      setResults((current) => ({
        ...current,
        [id]: { ok: false, text: caught instanceof Error ? caught.message : "O teste falhou." },
      }));
    } finally {
      setTesting("");
    }
  }

  async function remove(server: McpServer) {
    try {
      await agentApi.deleteMcp(server.id);
      setResults((current) => {
        const next = { ...current };
        delete next[server.id];
        return next;
      });
      if (form.id === server.id) close();
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível remover o conector.");
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="text-body-medium text-text-primary">Serviços</h4>
          <p className="mt-0.5 max-w-2xl text-caption-1-regular text-text-secondary">
            Conecte serviços uma vez. Todos os conectores ficam disponíveis para o Jeff em qualquer projeto e são passados ao harness como ferramentas MCP.
          </p>
        </div>
        <Button variant="ghost" size="small" leadingIcon={RefreshCw} onClick={() => void load()} disabled={loading}>
          Recarregar
        </Button>
      </header>

      <section className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {PRESETS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => openPreset(item)}
            className={cx(
              "flex items-start gap-2.5 rounded-xl border p-3 text-start transition-colors",
              chosen && preset.id === item.id && !editing
                ? "border-accent-500 bg-accent-500/10"
                : "border-border-button-default bg-background-primary-default hover:bg-background-primary-hover",
            )}
          >
            <ConnectorLogo id={item.id} className="mt-0.5 size-5" />
            <span className="min-w-0">
              <span className="flex items-center gap-1.5">
                <strong className="truncate text-caption-1-semibold text-text-primary">{item.name}</strong>
                <span className="rounded-full bg-background-tertiary-default px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-text-tertiary">
                  {item.mode}
                </span>
              </span>
              <span className="mt-0.5 block text-caption-2-regular text-text-tertiary">{item.description}</span>
            </span>
          </button>
        ))}
      </section>

      {chosen ? (
        <section className="rounded-2xl border border-border-button-default bg-background-secondary-default/45 p-4">
          <div className="mb-3 flex items-center gap-2">
            <ConnectorLogo id={preset.id} className="size-5" />
            <div className="min-w-0 flex-1">
              <p className="text-body-2-medium text-text-primary">{editing ? `Editar ${form.name}` : `Conectar ${preset.name}`}</p>
              <p className="text-caption-2-regular text-text-tertiary">
                {preset.mode === "api" ? "Conexão por API token" : "Conexão por servidor MCP"}
              </p>
            </div>
            <Button variant="ghost" size="xs" onClick={close}>Fechar</Button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Nome do conector" value={form.name} onChange={(name) => setForm((current) => ({ ...current, name }))} placeholder={preset.name} />
            {preset.id === "custom" ? (
              <Select
                aria-label="Tipo de conexão"
                selectedKey={form.transport}
                onSelectionChange={(key) => setForm((current) => ({ ...current, transport: key as "http" | "stdio" }))}
              >
                <SelectItem id="http">MCP por URL (HTTP)</SelectItem>
                <SelectItem id="stdio">MCP por comando (stdio)</SelectItem>
              </Select>
            ) : (
              <div className="flex items-end pb-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-background-tertiary-default px-2 py-1 text-caption-2-regular text-text-secondary">
                  {preset.mode === "api" ? <KeyRound size={11} /> : <Server size={11} />}
                  {form.transport === "http" ? "MCP remoto · token" : "MCP local · API token"}
                </span>
              </div>
            )}
            {form.transport === "http" ? (
              <>
                <Input label="URL do MCP" value={form.url} onChange={(url) => setForm((current) => ({ ...current, url }))} placeholder="https://mcp.exemplo.com/mcp" />
                <Input
                  label={preset.tokenLabel || "Token de acesso"}
                  type="password"
                  value={form.token}
                  onChange={(token) => setForm((current) => ({ ...current, token }))}
                  placeholder={editing ? "Deixe em branco para manter" : "Cole o token"}
                  autoComplete="off"
                />
              </>
            ) : (
              <>
                <Input label="Comando e argumentos (JSON)" value={form.command} onChange={(command) => setForm((current) => ({ ...current, command }))} />
                {preset.envFields ? preset.envFields.map((field) => (
                  <Input
                    key={field.key}
                    label={field.label}
                    type={field.secret ? "password" : "text"}
                    value={envValues[field.key] ?? ""}
                    onChange={(value) => setEnvValues((current) => ({ ...current, [field.key]: value }))}
                    placeholder={field.placeholder ?? (editing ? "Deixe em branco para manter" : undefined)}
                    autoComplete="off"
                  />
                )) : (
                  <Input label="Variáveis de ambiente (JSON)" value={form.env} onChange={(env) => setForm((current) => ({ ...current, env }))} placeholder='{"TOKEN":"..."}' />
                )}
              </>
            )}
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
            {editing ? <Button variant="ghost" size="small" onClick={close}>Cancelar</Button> : null}
            <Button
              variant="primary"
              size="small"
              disabled={busy || (form.transport === "http" && !form.url.trim())}
              leadingIcon={busy ? LoaderCircle : Plus}
              onClick={() => void save()}
            >
              {busy ? "Salvando…" : editing ? "Salvar" : "Salvar e testar"}
            </Button>
          </div>
        </section>
      ) : null}

      {error ? (
        <p role="alert" className="flex items-center gap-2 rounded-xl border border-status-rose-border bg-status-rose-bg px-3 py-2 text-caption-1-regular text-status-rose-text">
          <CircleAlert size={13} /> {error}
        </p>
      ) : null}

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <h5 className="text-caption-1-semibold text-text-primary">Conectados</h5>
          <span className="text-caption-2-regular text-text-tertiary">{servers.length} de 16</span>
        </div>
        {loading ? (
          <p className="flex items-center gap-2 text-caption-1-regular text-text-tertiary"><LoaderCircle className="size-4 animate-spin" /> Carregando conectores…</p>
        ) : servers.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border-button-default px-4 py-6 text-center">
            <PlugZap className="mx-auto size-5 text-text-tertiary" />
            <p className="mt-2 text-caption-1-medium text-text-primary">Nenhum conector ainda.</p>
            <p className="mt-0.5 text-caption-2-regular text-text-tertiary">Escolha um serviço acima. O Jeff usa os conectores em todos os projetos.</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-border-button-default bg-background-primary-default">
            {servers.map((server, index) => {
              const found = presetFor(server);
              const result = results[server.id];
              return (
                <div key={server.id} className={cx("px-3 py-2.5", index > 0 && "border-t border-separator-border")}>
                  <div className="flex flex-wrap items-center gap-2">
                    <ConnectorLogo id={found.id} className="size-4" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-caption-1-semibold text-text-primary">{server.name}</p>
                      <p className="truncate font-mono text-[11px] text-text-tertiary" title={server.transport === "http" ? server.url : server.command.join(" ")}>
                        {server.transport === "http" ? server.url : server.command.join(" ")}
                      </p>
                    </div>
                    {server.hasToken || server.envKeys?.length ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-background-tertiary-default px-1.5 py-px text-[10px] text-text-tertiary">
                        <KeyRound size={9} /> credencial
                      </span>
                    ) : null}
                    <Button variant="ghost" size="xs" disabled={testing === server.id} onClick={() => void test(server.id)}>
                      {testing === server.id ? "Testando…" : "Testar"}
                    </Button>
                    <Button variant="ghost" size="xs" onClick={() => edit(server)}>Editar</Button>
                    <Button
                      variant="ghost"
                      size="xs"
                      iconOnly
                      leadingIcon={Trash2}
                      aria-label={`Remover ${server.name}`}
                      title="Remover"
                      onClick={() => void remove(server)}
                    />
                  </div>
                  {result ? (
                    <p className={cx("mt-1.5 flex items-center gap-1.5 text-caption-2-regular", result.ok ? "text-status-lime-text" : "text-status-rose-text")}>
                      {result.ok ? <Check size={11} /> : <CircleAlert size={11} />} {result.text}
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <p className="flex items-start gap-1.5 text-caption-2-regular text-text-tertiary">
        <Wrench size={12} className="mt-0.5 shrink-0" />
        O harness recebe os conectores como ferramentas MCP; nenhum token vai para o prompt. Se o teste falhar, confira o token e as permissões do serviço.
      </p>
    </div>
  );
}
