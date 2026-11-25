import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Check, ChevronRight, CircleAlert, ExternalLink, Plus, Trash2 } from "@jeff/icons";
import { api, type GitConnection } from "../../../shared/api";
import { agentApi, type McpServer } from "../../agents/api";
import { useApp } from "../../../app/store";
import { Button, Input } from "@jeff/ui/app";
import { Dialog, DialogBody, DialogFooter, SearchField } from "faang-ui";
import ProviderIcon from "../../providers/components/ProviderIcon";

type Category = "dev" | "productivity" | "automation";
type How = "oauth" | "token" | "address";

interface Entry {
  key: string;
  name: string;
  description: string;
  category: Category;
  connected: boolean;
  icon: ReactNode;
  color: string;
  how: How;
  server?: McpServer;
  provider?: string;
}

const CATEGORY_LABEL: Record<Category, string> = {
  dev: "Desenvolvimento",
  productivity: "Produtividade",
  automation: "Automação",
};

const ATLASSIAN_NAME = "Atlassian (Jira, Confluence, Bitbucket)";

function BitbucketIcon({ size = 22 }: { size?: number }) {
  return <img src={`${import.meta.env.BASE_URL}material-icons/bitbucket.svg`} alt="" width={size} height={size} />;
}

function AtlassianIcon({ size = 22 }: { size?: number }) {
  return (
    <span className="inline-flex items-center justify-center rounded-lg bg-[#0052CC] text-white" style={{ width: size, height: size, fontSize: size * 0.55, fontWeight: 700 }}>
      A
    </span>
  );
}

/** The connector store, ported from the Agentes Chat reference. */
export default function ConnectorsStore() {
  const notify = useApp((state) => state.notify);
  const [git, setGit] = useState<GitConnection[]>([]);
  const [servers, setServers] = useState<McpServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<"featured" | Category>("featured");
  const [selected, setSelected] = useState<Entry | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [gitForm, setGitForm] = useState<{ provider: string; username: string; token: string }>({ provider: "", username: "", token: "" });
  const [mcpForm, setMcpForm] = useState({ name: "", url: "", token: "" });

  async function load() {
    try {
      const [connections, mcp] = await Promise.all([api.gitConnections(), agentApi.mcpServers()]);
      setGit(connections.connections);
      setServers(mcp);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível carregar as conexões.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const atlassian = servers.find((server) => server.name === ATLASSIAN_NAME);
  const entries = useMemo<Entry[]>(() => {
    const github = git.find((item) => item.provider === "github");
    const bitbucket = git.find((item) => item.provider === "bitbucket");
    return [
      {
        key: "atlassian",
        name: "Atlassian",
        description: "Jira, Confluence, Bitbucket e JSM para os agentes, com login OAuth e sem API key.",
        category: "productivity",
        connected: Boolean(atlassian),
        icon: <AtlassianIcon />,
        color: "#0052CC",
        how: "oauth",
        server: atlassian,
      },
      {
        key: "bitbucket-git",
        name: "Bitbucket (Git)",
        description: "Pull, push e branches no terminal com a sua conta do Bitbucket.",
        category: "dev",
        connected: Boolean(bitbucket?.connected),
        icon: <BitbucketIcon />,
        color: "#0052CC",
        how: "token",
        provider: "bitbucket",
      },
      {
        key: "github-git",
        name: "GitHub (Git)",
        description: "Pull, push e branches no terminal com a sua conta do GitHub.",
        category: "dev",
        connected: Boolean(github?.connected),
        icon: <ProviderIcon provider="github" className="size-5" />,
        color: "#24292f",
        how: "token",
        provider: "github",
      },
      {
        key: "mcp-custom",
        name: "Outro MCP",
        description: "Qualquer servidor MCP por URL, com token ou sem autenticação.",
        category: "automation",
        connected: false,
        icon: <Plus size={18} />,
        color: "#64748b",
        how: "address",
      },
      ...servers
        .filter((server) => server.name !== ATLASSIAN_NAME)
        .map((server) => ({
          key: `mcp:${server.id}`,
          name: server.name,
          description: server.url || server.command.join(" "),
          category: "automation" as const,
          connected: true,
          icon: <span className="text-body-2-semibold">MCP</span>,
          color: "#0EA5E9",
          how: "address" as const,
          server,
        })),
    ];
  }, [atlassian, git, servers]);

  const needle = query.trim().toLowerCase();
  const visible = entries.filter((entry) =>
    (!needle || `${entry.name} ${entry.description}`.toLowerCase().includes(needle))
    && (tab === "featured" || entry.category === tab),
  );
  const featured = entries.filter((entry) => !entry.connected && (entry.key === "atlassian" || entry.key === "bitbucket-git")).slice(0, 2);
  const hero = featured[0];
  const side = featured.slice(1);

  function open(entry: Entry) {
    setSelected(entry);
    setError("");
    if (entry.how === "token" && entry.provider) {
      const current = git.find((item) => item.provider === entry.provider);
      setGitForm({ provider: entry.provider, username: current?.username ?? "", token: "" });
    }
    if (entry.how === "address") {
      setMcpForm(entry.server
        ? { name: entry.server.name, url: entry.server.url, token: "" }
        : { name: "", url: "", token: "" });
    }
  }

  async function connectAtlassian() {
    setBusy("atlassian");
    setError("");
    try {
      const { url } = await api.startAtlassianOAuth();
      window.location.assign(url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível iniciar o OAuth do Atlassian.");
      setBusy("");
    }
  }

  async function saveGit() {
    if (!gitForm.provider) return;
    setBusy("git");
    setError("");
    try {
      await api.saveGitConnection(gitForm.provider, { username: gitForm.username.trim(), token: gitForm.token.trim() });
      notify("success", `${gitForm.provider === "github" ? "GitHub" : "Bitbucket"} conectado.`);
      await load();
      setSelected(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível salvar a conexão Git.");
    } finally {
      setBusy("");
    }
  }

  async function removeGit(provider: string) {
    setBusy("git-remove");
    try {
      await api.deleteGitConnection(provider);
      await load();
      setSelected(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível remover a conexão.");
    } finally {
      setBusy("");
    }
  }

  async function saveMcp(event: FormEvent) {
    event.preventDefault();
    setBusy("mcp");
    setError("");
    try {
      await agentApi.saveMcp({
        id: selected?.server?.id,
        name: mcpForm.name.trim(),
        transport: "http",
        url: mcpForm.url.trim(),
        token: mcpForm.token.trim(),
      });
      notify("success", "Servidor MCP salvo.");
      await load();
      setSelected(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível salvar o MCP.");
    } finally {
      setBusy("");
    }
  }

  async function removeMcp(id: string) {
    setBusy("mcp-remove");
    try {
      await agentApi.deleteMcp(id);
      await load();
      setSelected(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível remover o MCP.");
    } finally {
      setBusy("");
    }
  }

  const currentGit = selected?.provider ? git.find((item) => item.provider === selected.provider) : undefined;

  return (
    <div className="store">
      <div className="store-top">
        <h1 className="store-title">Conectores e MCP</h1>
        <SearchField
          size="sm"
          className="store-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onClear={() => setQuery("")}
          placeholder="Buscar conector ou MCP"
          aria-label="Buscar conector ou MCP"
          clearLabel="Limpar busca"
        />
      </div>

      <nav className="store-cats" aria-label="Categorias">
        {(["featured", "dev", "productivity", "automation"] as const).map((item) => (
          <button key={item} type="button" aria-pressed={tab === item} onClick={() => setTab(item)}>
            {item === "featured" ? "Destaques" : CATEGORY_LABEL[item]}
          </button>
        ))}
      </nav>

      {error && !selected ? (
        <p role="alert" className="flex items-center gap-2 text-caption-1-regular text-status-rose-text"><CircleAlert size={14} /> {error}</p>
      ) : null}

      {tab === "featured" && !needle && hero ? (
        <div className="store-feats">
          <div className="store-feat" data-side={side.length || undefined}>
            <article className="store-hero" style={{ ["--store-color" as string]: hero.color }}>
              <span className="store-hero__mark">{hero.icon}</span>
              <span className="store-kicker">Sugerido</span>
              <h3 className="store-hero__name">
                <button type="button" className="store-open" onClick={() => open(hero)}>{hero.name}</button>
              </h3>
              <p className="store-hero__text">{hero.description}</p>
              <Button variant="primary" className="store-hero__more" onClick={() => open(hero)}>
                Conectar <ChevronRight size={16} />
              </Button>
            </article>
            {side.length > 0 ? (
              <div className="store-side">
                {side.map((entry) => (
                  <article className="store-role" key={entry.key}>
                    <span className="store-role__mark">{entry.icon}</span>
                    <span className="store-role__text">
                      <span className="store-kicker">Sugerido</span>
                      <button type="button" className="store-open store-role__name" onClick={() => open(entry)}>{entry.name}</button>
                      <span className="store-role__sub">{entry.description}</span>
                    </span>
                  </article>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      <section className="store-sec">
        <div className="store-sec__head">
          <h3>{loading ? "Carregando…" : tab === "featured" ? "Todos os conectores" : CATEGORY_LABEL[tab]}</h3>
        </div>
        <ul className="store-rows">
          {visible.map((entry) => (
            <li key={entry.key} className="store-item store-item--link">
              <button type="button" className="store-item__open" onClick={() => open(entry)}>
                <span className="store-item__icon" style={{ color: entry.color }}>{entry.icon}</span>
                <span className="store-item__text">
                  <b>{entry.name}</b>
                  <small>{entry.description}</small>
                </span>
              </button>
              {entry.connected ? <span className="store-state" data-s="ok"><Check size={13} /> Conectado</span> : null}
            </li>
          ))}
        </ul>
        {visible.length === 0 ? <p className="store-empty">Nenhum conector encontrado.</p> : null}
      </section>

      <p className="store-foot">
        Não achou? <Button variant="ghost" onClick={() => open(entries.find((entry) => entry.key === "mcp-custom")!)}>Conectar outro MCP</Button>
      </p>

      <Dialog open={Boolean(selected)} onOpenChange={(open: boolean) => { if (!open) setSelected(null); }} title={selected?.name ?? "Conector"} description={selected?.description} closeLabel="Fechar" width={520}>
        <DialogBody className="flex flex-col gap-3">
          {error ? <p role="alert" className="flex items-center gap-2 text-caption-1-regular text-status-rose-text"><CircleAlert size={14} /> {error}</p> : null}

          {selected?.how === "oauth" ? (
            <div className="flex flex-col gap-3">
              <p className="text-caption-1-regular text-text-secondary">
                Conecta Jira, Confluence, Bitbucket e JSM com OAuth. O usuário autoriza no Atlassian e não precisa criar API key.
              </p>
              <Button variant="primary" disabled={busy === "atlassian"} onClick={() => void connectAtlassian()}>
                {busy === "atlassian" ? "Abrindo Atlassian…" : selected.connected ? "Reconectar" : "Conectar com Atlassian"}
              </Button>
              {selected.connected ? <p className="text-caption-2-regular text-status-lime-text">Conectado como MCP do Atlassian.</p> : null}
            </div>
          ) : null}

          {selected?.how === "token" ? (
            <div className="flex flex-col gap-3">
              <Input label="Usuário" value={gitForm.username} onChange={(value) => setGitForm((current) => ({ ...current, username: value }))} placeholder={selected.provider === "github" ? "x-access-token" : "usuário do Bitbucket"} />
              <Input label="Token" type="password" value={gitForm.token} onChange={(value) => setGitForm((current) => ({ ...current, token: value }))} autoComplete="off" placeholder="••••••••" />
              <div className="flex justify-end gap-2">
                {currentGit?.connected ? (
                  <Button variant="ghost" leadingIcon={Trash2} disabled={busy !== ""} onClick={() => void removeGit(selected.provider!)}>Remover</Button>
                ) : null}
                <Button variant="primary" leadingIcon={Check} disabled={busy !== "" || !gitForm.token.trim()} onClick={() => void saveGit()}>
                  {busy === "git" ? "Salvando…" : "Conectar"}
                </Button>
              </div>
            </div>
          ) : null}

          {selected?.how === "address" ? (
            <form className="flex flex-col gap-3" onSubmit={(event) => void saveMcp(event)}>
              <Input label="Nome" value={mcpForm.name} onChange={(value) => setMcpForm((current) => ({ ...current, name: value }))} placeholder="Ex.: Meu MCP" />
              <Input label="URL do MCP" value={mcpForm.url} onChange={(value) => setMcpForm((current) => ({ ...current, url: value }))} placeholder="https://mcp.exemplo.com/mcp" />
              <Input label="Token (opcional)" type="password" value={mcpForm.token} onChange={(value) => setMcpForm((current) => ({ ...current, token: value }))} autoComplete="off" />
              <div className="flex justify-end gap-2">
                {selected.server ? (
                  <Button type="button" variant="ghost" leadingIcon={Trash2} disabled={busy !== ""} onClick={() => void removeMcp(selected.server!.id)}>Remover</Button>
                ) : null}
                <Button type="submit" variant="primary" disabled={busy !== "" || !mcpForm.name.trim() || !mcpForm.url.trim()}>
                  {busy === "mcp" ? "Salvando…" : "Salvar MCP"}
                </Button>
              </div>
            </form>
          ) : null}
        </DialogBody>
        <DialogFooter note={<a href="https://support.atlassian.com/atlassian-ai-gateway/docs/get-started-with-the-atlassian-remote-mcp-server/" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-caption-2-regular text-text-tertiary hover:text-text-primary">Sobre conectores <ExternalLink size={11} /></a>}>
          <Button variant="secondary" onClick={() => setSelected(null)}>Fechar</Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}
