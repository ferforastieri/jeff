import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { Check, CircleAlert, Copy, Download, ExternalLink, RefreshCw } from "@jeff/icons";
import type { Project } from "../../../shared/api";
import { engineApi, type EngineInfo, type EngineTest } from "../../agents/api";
import { useApp } from "../../../app/store";
import HarnessIcon from "../../agents/components/HarnessIcon";
import { Button } from "@jeff/ui/app";
import { cx } from "@jeff/ui";
import "./HoppingToph.css";

const LoginTerminal = lazy(() => import("../../terminal/components/TerminalPanel"));

type Busy = { id: string; action: "test" | "install" | "update" } | null;

interface Props {
  projectRoot?: string;
  projectId?: string;
}

/** One place for the agent harnesses: install, log in and test the CLI. */
/** The pixel Jeff as a Button's leading icon while a harness works. */
/** The Toph mascot hopping while a harness action runs. */
function HoppingToph({ className, "aria-hidden": ariaHidden }: { className?: string; "aria-hidden"?: boolean | "true" | "false" }) {
  return (
    <img
      src={`${import.meta.env.BASE_URL}brand/jeff-mark.png`}
      alt=""
      aria-hidden={ariaHidden ?? true}
      className={cx("toph-hop", className)}
    />
  );
}

export default function HarnessSettings({ projectRoot, projectId }: Props) {
  const notify = useApp((state) => state.notify);
  const [loginView, setLogin] = useState<{ engine: EngineInfo; command: string; nonce: number } | null>(null);
  const [engines, setEngines] = useState<EngineInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<Busy>(null);
  const [tests, setTests] = useState<Record<string, EngineTest>>({});
  const [installs, setInstalls] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");

  const refresh = useCallback(async () => {
    try {
      setEngines(await engineApi.list());
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível ler os harnesses.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function test(engine: EngineInfo) {
    setBusy({ id: engine.id, action: "test" });
    setError("");
    try {
      const result = await engineApi.test(engine.id);
      setTests((current) => ({ ...current, [engine.id]: result }));
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : `O teste de ${engine.label} falhou.`);
    } finally {
      setBusy(null);
    }
  }

  async function install(engine: EngineInfo) {
    setBusy({ id: engine.id, action: "install" });
    setError("");
    try {
      const result = await engineApi.install(engine.id);
      setInstalls((current) => ({ ...current, [engine.id]: result.output || result.message }));
      setTests((current) => ({
        ...current,
        [engine.id]: { ok: result.ok, installed: result.installed, path: result.path, message: result.message },
      }));
      notify(result.ok ? "success" : "error", result.message);
      await refresh();
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : `A instalação de ${engine.label} falhou.`;
      setError(message);
      notify("error", message);
    } finally {
      setBusy(null);
    }
  }

  async function update(engine: EngineInfo) {
    setBusy({ id: engine.id, action: "update" });
    setError("");
    try {
      const result = await engineApi.update(engine.id);
      setInstalls((current) => ({ ...current, [engine.id]: result.output || result.message }));
      setTests((current) => ({
        ...current,
        [engine.id]: {
          ok: result.ok,
          installed: result.installed,
          path: result.path ?? undefined,
          version: result.version ?? undefined,
          message: result.message,
        },
      }));
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : `A atualização de ${engine.label} falhou.`);
    } finally {
      setBusy(null);
    }
  }

  function login(engine: EngineInfo) {
    // The login is interactive (it prints a URL and waits for a code). It runs
    // in a terminal inside Settings, so it never depends on the Workbench's
    // terminal tab or the event that opens it.
    // Antigravity runs on the server, so advertise an SSH-like environment to
    // force its manual URL/code OAuth flow instead of opening a browser there.
    const path = 'PATH="$HOME/.opencode/bin:$HOME/.local/bin:$HOME/.claude/local:$PATH"';
    const command = engine.id === "antigravity"
      ? `AGY_CLI_DISABLE_AUTO_UPDATE=true SSH_CONNECTION='jeff 0 127.0.0.1 0' SSH_CLIENT='127.0.0.1 0 0' ${path} agy`
      : `${path} ${engine.login}`;
    setLogin({ engine, command, nonce: Date.now() });
  }

  async function copy(engine: EngineInfo) {
    try {
      await navigator.clipboard.writeText(engine.login);
      setCopied(engine.id);
      notify("success", `Comando de conexão de ${engine.label} copiado.`);
      window.setTimeout(() => setCopied(""), 1500);
    } catch {
      notify("error", "Não foi possível copiar o comando.");
    }
  }

  const loginProject: Project = {
    id: projectId ?? "workspaces",
    name: "workspaces",
    root: projectRoot ?? "/workspaces",
    color: "",
    createdAt: "",
    updatedAt: "",
  };

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="text-body-medium text-text-primary">Motores de agente</h4>
          <p className="mt-0.5 max-w-2xl text-caption-1-regular text-text-secondary">
            Instale, entre e teste o CLI que executa o Jeff. O login abre no terminal do app; skills e conectores chegam ao harness automaticamente.
          </p>
        </div>
        <Button variant="ghost" size="small" leadingIcon={RefreshCw} onClick={() => void refresh()} disabled={loading || busy !== null}>
          Recarregar
        </Button>
      </header>

      {error ? (
        <p role="alert" className="flex items-center gap-2 rounded-xl border border-status-rose-border bg-status-rose-bg px-3 py-2 text-caption-1-regular text-status-rose-text">
          <CircleAlert size={13} /> {error}
        </p>
      ) : null}
      {loading ? (
        <p role="status" className="flex items-center gap-2 text-caption-1-regular text-text-secondary">
          <HoppingToph /> Procurando harnesses…
        </p>
      ) : null}

      {!loading && engines.length > 0 ? (
        <div className="overflow-hidden rounded-2xl border border-border-button-default bg-background-primary-default">
          {engines.map((engine, index) => {
            const working = busy?.id === engine.id;
            const result = tests[engine.id];
            const output = installs[engine.id];
            return (
              <div key={engine.id} className={cx("px-3 py-3", index > 0 && "border-t border-separator-border")}>
                <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                  <span className={cx("flex size-9 shrink-0 items-center justify-center rounded-xl", engine.installed ? "bg-accent-500/12" : "bg-background-tertiary-default")}>
                    <HarnessIcon id={engine.id} className={cx("size-5", engine.installed ? "text-text-primary" : "text-text-tertiary")} />
                  </span>

                  <div className="min-w-0 flex-1 max-[640px]:basis-full">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <strong className="truncate text-caption-1-semibold text-text-primary">{engine.label}</strong>
                      <span className={cx("rounded-full px-1.5 py-px text-[10px] font-semibold", engine.installed ? "bg-status-lime-bg text-status-lime-text" : "bg-status-yellow-bg text-status-yellow-text")}>
                        {engine.installed ? "instalado" : "não instalado"}
                      </span>
                      {engine.installed && !engine.supported ? (
                        <span className="rounded-full bg-status-yellow-bg px-1.5 py-px text-[10px] font-semibold text-status-yellow-text">sem suporte no runtime</span>
                      ) : null}
                    </div>
                    <p className="mt-0.5 truncate font-mono text-[11px] text-text-tertiary" title={engine.path ?? engine.binary}>
                      {engine.installed ? engine.path ?? engine.binary : `binário: ${engine.binary}`}
                    </p>
                  </div>

                  <div className="flex shrink-0 flex-wrap items-center gap-1 max-[640px]:w-full">
                    {engine.installed ? (
                      <>
                        <Button variant="primary" size="small" onClick={() => login(engine)}>Entrar</Button>
                        <Button variant="secondary" size="small" disabled={working} leadingIcon={working && busy?.action === "test" ? HoppingToph : Check} onClick={() => void test(engine)}>
                          {working && busy?.action === "test" ? "Testando…" : "Testar"}
                        </Button>
                        <Button
                          variant="ghost"
                          size="small"
                          iconOnly
                          disabled={working}
                          leadingIcon={working && busy?.action === "update" ? HoppingToph : RefreshCw}
                          aria-label={`Atualizar ${engine.label}`}
                          title={`Atualizar ${engine.label}`}
                          onClick={() => void update(engine)}
                        />
                        <Button
                          variant="ghost"
                          size="small"
                          iconOnly
                          leadingIcon={copied === engine.id ? Check : Copy}
                          aria-label={`Copiar login de ${engine.label}`}
                          title={`Copiar: ${engine.login}`}
                          onClick={() => void copy(engine)}
                        />
                      </>
                    ) : (
                      <Button variant="primary" size="small" disabled={working} leadingIcon={working && busy?.action === "install" ? HoppingToph : Download} onClick={() => void install(engine)}>
                        {working && busy?.action === "install" ? "Instalando…" : "Instalar"}
                      </Button>
                    )}
                  </div>
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 ps-12 text-caption-2-regular text-text-tertiary max-[640px]:ps-0">
                  <span className="inline-flex min-w-0 items-center gap-1">
                    <span className="text-text-secondary">Login:</span>
                    <code className="truncate rounded bg-background-tertiary-default px-1 py-0.5 font-mono text-[10.5px] text-text-primary">{engine.login}</code>
                  </span>
                  {!engine.installed ? (
                    <span className="inline-flex min-w-0 items-center gap-1">
                      <span className="text-text-secondary">Instalar:</span>
                      <code className="truncate rounded bg-background-tertiary-default px-1 py-0.5 font-mono text-[10.5px] text-text-primary">{engine.install}</code>
                    </span>
                  ) : null}
                  <a href={engine.site} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-text-primary">
                    Site <ExternalLink size={10} />
                  </a>
                </div>

                {result ? (
                  <p className={cx("mt-2 flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-caption-2-regular", result.ok ? "bg-status-lime-bg text-status-lime-text" : "bg-status-rose-bg text-status-rose-text")}>
                    {result.ok ? <Check size={11} /> : <CircleAlert size={11} />}
                    {result.message}
                    {result.modelCount ? ` · ${result.modelCount} modelos` : ""}
                  </p>
                ) : null}
                {output ? (
                  <pre className="mt-2 max-h-32 overflow-auto rounded-lg bg-background-tertiary-default p-2 font-mono text-[10px] leading-relaxed text-text-secondary">{output}</pre>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}

      {!loading && engines.length === 0 && !error ? (
        <p className="rounded-2xl border border-dashed border-border-button-default px-4 py-6 text-center text-caption-1-regular text-text-tertiary">
          Nenhum harness detectado.
        </p>
      ) : null}

      {loginView ? (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 9999 }}
          className="flex flex-col bg-background-primary-default p-3"
        >
          <div className="flex items-center justify-between gap-2 pb-2">
            <strong className="text-caption-1-semibold text-text-primary">Login — {loginView.engine.label}</strong>
            <Button variant="ghost" size="small" onClick={() => setLogin(null)}>Fechar</Button>
          </div>
          <div className="min-h-0 flex-1">
            <Suspense
              fallback={(
                <div className="flex h-full items-center justify-center gap-2 text-caption-1-regular text-text-secondary">
                  <HoppingToph /> Abrindo terminal…
                </div>
              )}
            >
              <LoginTerminal
                project={loginProject}
                sheet
                onClose={() => setLogin(null)}
                onOpenFile={() => undefined}
                initialCommand={{ text: loginView.command, nonce: loginView.nonce }}
                commandTarget="login"
              />
            </Suspense>
          </div>
        </div>
      ) : null}
    </div>
  );
}
