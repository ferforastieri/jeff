import { useCallback, useEffect, useState } from "react";
import { Check, CircleAlert, Copy, Download, ExternalLink, LoaderCircle, RefreshCw } from "@toph/icons";
import { engineApi, type EngineInfo, type EngineTest } from "../../agents/api";
import { useApp } from "../../../app/store";
import { useSettings } from "../store";
import HarnessIcon from "../../agents/components/HarnessIcon";
import { Button } from "@toph/ui/app";
import { cx } from "@toph/ui";

type Busy = { id: string; action: "test" | "install" | "update" } | null;

interface Props {
  projectRoot?: string;
}

/** One place for the agent harnesses: install, log in and test the CLI. */
export default function HarnessSettings(_props: Props) {
  const notify = useApp((state) => state.notify);
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
    // The harness login is interactive (it prints a URL and waits for a code):
    // run it in the app's own terminal, with the settings dialog out of the way.
    window.dispatchEvent(new Event("toph:close-settings"));
    const settings = useSettings.getState();
    if (!settings.workspaceFeatures.terminal) settings.update({ workspaceFeatures: { terminal: true } });
    window.setTimeout(() => {
      if (!useApp.getState().terminalOpen) window.dispatchEvent(new Event("toph:open-terminal"));
    }, 150);
    // The terminal mounts asynchronously. Wait for xterm before sending the
    // command, otherwise the click looks like it did nothing on mobile.
    // Antigravity runs on the server, so advertise an SSH-like environment to
    // force its manual URL/code OAuth flow instead of opening a browser there.
    const command = engine.id === "antigravity"
      ? "AGY_CLI_DISABLE_AUTO_UPDATE=true SSH_CONNECTION='toph 0 127.0.0.1 0' SSH_CLIENT='127.0.0.1 0 0' PATH=\"$HOME/.local/bin:$PATH\" agy"
      : engine.login;
    let attempts = 0;
    const send = () => {
      if (document.querySelector(".xterm")) {
        window.dispatchEvent(new CustomEvent("toph:terminal-command", {
          detail: { command: "login", text: command },
        }));
      } else if (attempts++ < 20) {
        window.setTimeout(send, 200);
      }
    };
    window.setTimeout(send, 300);
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

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="text-body-medium text-text-primary">Motores de agente</h4>
          <p className="mt-0.5 max-w-2xl text-caption-1-regular text-text-secondary">
            Instale, entre e teste o CLI que executa o Toph. O login abre no terminal do app; skills e conectores chegam ao harness automaticamente.
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
          <LoaderCircle className="size-4 animate-spin" /> Procurando harnesses…
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
                <div className="flex flex-wrap items-center gap-3">
                  <span className={cx("flex size-9 shrink-0 items-center justify-center rounded-xl", engine.installed ? "bg-accent-500/12" : "bg-background-tertiary-default")}>
                    <HarnessIcon id={engine.id} className={cx("size-5", engine.installed ? "text-text-primary" : "text-text-tertiary")} />
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <strong className="truncate text-caption-1-semibold text-text-primary">{engine.label}</strong>
                      <span className={cx("rounded-full px-1.5 py-px text-[10px] font-semibold", engine.installed ? "bg-status-lime-bg text-status-lime-text" : "bg-status-yellow-bg text-status-yellow-text")}>
                        {engine.installed ? "instalado" : "não instalado"}
                      </span>
                      {engine.installed && !engine.supported ? (
                        <span className="rounded-full bg-status-amber-bg px-1.5 py-px text-[10px] font-semibold text-status-amber-text">sem suporte no runtime</span>
                      ) : null}
                    </div>
                    <p className="mt-0.5 truncate font-mono text-[11px] text-text-tertiary" title={engine.path ?? engine.binary}>
                      {engine.installed ? engine.path ?? engine.binary : `binário: ${engine.binary}`}
                    </p>
                  </div>

                  <div className="flex shrink-0 flex-wrap items-center gap-1">
                    {engine.installed ? (
                      <>
                        <Button variant="primary" size="small" disabled={working} onClick={() => login(engine)}>Entrar</Button>
                        <Button variant="secondary" size="small" disabled={working} leadingIcon={working && busy?.action === "test" ? LoaderCircle : Check} onClick={() => void test(engine)}>
                          {working && busy?.action === "test" ? "Testando…" : "Testar"}
                        </Button>
                        <Button
                          variant="ghost"
                          size="small"
                          iconOnly
                          disabled={working}
                          leadingIcon={working && busy?.action === "update" ? LoaderCircle : RefreshCw}
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
                      <Button variant="primary" size="small" disabled={working} leadingIcon={working && busy?.action === "install" ? LoaderCircle : Download} onClick={() => void install(engine)}>
                        {working && busy?.action === "install" ? "Instalando…" : "Instalar"}
                      </Button>
                    )}
                  </div>
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 ps-12 text-caption-2-regular text-text-tertiary">
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
    </div>
  );
}
