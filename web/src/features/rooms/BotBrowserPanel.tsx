import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  Globe2,
  RefreshCw,
  UserRound,
} from "@jeff/icons";
import { Input, Select } from "faang-ui";
import { Button, IconButton } from "@jeff/ui/app";
import { PixelSpinner } from "@jeff/ui";
import { api } from "../../shared/api";
import type { Project } from "../../shared/api";

interface BrowserAgent {
  id: string;
  name: string;
}

interface Props {
  project: Project;
  bots: BrowserAgent[];
  initialAgentId?: string;
}

interface Frame {
  data: string;
  width: number;
  height: number;
  url: string;
}

/** The agent's visible Chromium, watched and controlled from the app. */
export default function BotBrowserPanel({ project, bots, initialAgentId }: Props) {
  const [agentId, setAgentId] = useState(initialAgentId ?? bots[0]?.id ?? "");
  const [takeover, setTakeover] = useState(false);
  const [frame, setFrame] = useState<Frame | null>(null);
  const [pageUrl, setPageUrl] = useState("");
  const [draftUrl, setDraftUrl] = useState("");
  const [error, setError] = useState("");
  const [connected, setConnected] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const imageRef = useRef<HTMLImageElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!bots.some((bot) => bot.id === agentId)) setAgentId(bots[0]?.id ?? "");
  }, [bots, agentId]);

  useEffect(() => {
    if (!agentId) return;
    let cancelled = false;
    void api
      .botBrowser(project.id, agentId)
      .then((info) => {
        if (!cancelled) setTakeover(Boolean(info.takeover));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [project.id, agentId]);

  useEffect(() => {
    if (!agentId) return;
    let disposed = false;
    let retry = 0;
    let reconnectTimer = 0;
    let heartbeat = 0;
    setFrame(null);
    setPageUrl("");
    setDraftUrl("");
    setConnected(false);

    function connect() {
      void api
        .botBrowser(project.id, agentId)
        .then((info) => {
          if (disposed) return;
          setTakeover(Boolean(info.takeover));
          let socket: WebSocket;
          try {
            socket = new WebSocket(api.botBrowserSocketUrl(project.id, agentId));
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : "Não foi possível conectar ao navegador.");
            return;
          }
          socketRef.current = socket;
          socket.onopen = () => {
            retry = 0;
            setConnected(true);
            setError("");
            window.clearInterval(heartbeat);
            heartbeat = window.setInterval(() => {
              if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "ping" }));
            }, 20_000);
          };
          socket.onmessage = (event) => {
            try {
              const value = JSON.parse(String(event.data)) as
                | { type: "frame"; data: string; width: number; height: number; url?: string }
                | { type: "error"; message?: string };
              if (value.type === "frame") {
                setFrame({ data: value.data, width: value.width, height: value.height, url: value.url ?? "" });
                if (value.url && value.url !== "about:blank") {
                  setPageUrl(value.url);
                  if (document.activeElement !== inputRef.current) setDraftUrl(value.url);
                }
              } else if (value.type === "error" && value.message) {
                setError(value.message);
              }
            } catch {
              // A malformed frame is ignored; the next one arrives.
            }
          };
          socket.onclose = () => {
            window.clearInterval(heartbeat);
            setConnected(false);
            if (disposed) return;
            retry += 1;
            reconnectTimer = window.setTimeout(connect, Math.min(5_000, 500 * retry));
          };
          socket.onerror = () => socket.close();
        })
        .catch((cause) => {
          if (!disposed) {
            setError(cause instanceof Error ? cause.message : "Não foi possível abrir o navegador do agente.");
          }
        });
    }

    connect();
    return () => {
      disposed = true;
      window.clearTimeout(reconnectTimer);
      window.clearInterval(heartbeat);
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [project.id, agentId, retryKey]);

  async function toggleTakeover() {
    const next = !takeover;
    try {
      await api.botBrowserTakeover(project.id, agentId, next);
      setTakeover(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível alterar o controle do navegador.");
    }
  }

  function send(value: unknown) {
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value));
  }

  function navigate(raw: string) {
    const value = raw.trim();
    if (!value) return;
    const url = /^https?:\/\//i.test(value) ? value : `http://${value}`;
    setDraftUrl(url);
    send({ type: "navigate", url });
  }

  function point(event: React.MouseEvent<HTMLImageElement>) {
    const image = imageRef.current;
    if (!image || !frame) return null;
    const rect = image.getBoundingClientRect();
    const scale = Math.min(rect.width / frame.width, rect.height / frame.height);
    if (!Number.isFinite(scale) || scale <= 0) return null;
    const width = frame.width * scale;
    const height = frame.height * scale;
    const left = rect.left + (rect.width - width) / 2;
    const top = rect.top + (rect.height - height) / 2;
    return {
      x: Math.min(1, Math.max(0, (event.clientX - left) / width)),
      y: Math.min(1, Math.max(0, (event.clientY - top) / height)),
    };
  }

  function click(event: React.MouseEvent<HTMLImageElement>) {
    const at = point(event);
    if (!at) return;
    event.currentTarget.focus();
    send({ type: "mouse", event: "click", x: at.x, y: at.y });
  }

  function wheel(event: React.WheelEvent<HTMLImageElement>) {
    const at = point(event);
    if (!at) return;
    event.preventDefault();
    send({ type: "mouse", event: "wheel", x: at.x, y: at.y, deltaY: event.deltaY });
  }

  function key(event: React.KeyboardEvent<HTMLImageElement>) {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const special = ["Enter", "Tab", "Escape", "Backspace", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"];
    if (special.includes(event.key)) {
      event.preventDefault();
      send({ type: "key", key: event.key });
      return;
    }
    if (event.key.length === 1) {
      event.preventDefault();
      send({ type: "text", text: event.key });
    }
  }

  if (!agentId) {
    return (
      <div className="agent-browser__empty">
        <Globe2 size={22} />
        <span>Nenhum agente disponível para abrir o navegador.</span>
      </div>
    );
  }

  const blank = !frame || !frame.url || frame.url === "about:blank";
  return (
    <section className="agent-browser" aria-label="Navegador do agente">
      <header className="agent-browser__bar">
        <Select
          value={agentId}
          onValueChange={setAgentId}
          options={bots.map((bot) => ({ value: bot.id, label: bot.name }))}
          className="agent-browser__agent"
          aria-label="Agente do navegador"
        />
        <span className={`agent-browser__live${connected ? " is-live" : ""}`} title={connected ? "Ao vivo" : "Reconectando"}>
          <i aria-hidden="true" />
          {connected ? "Ao vivo" : "Reconectando"}
        </span>
        <span className="agent-browser__nav">
          <IconButton icon={ArrowLeft} size="xs" aria-label="Voltar" title="Voltar" onClick={() => send({ type: "back" })} />
          <IconButton icon={ArrowRight} size="xs" aria-label="Avançar" title="Avançar" onClick={() => send({ type: "forward" })} />
          <IconButton icon={RefreshCw} size="xs" aria-label="Recarregar" title="Recarregar" onClick={() => send({ type: "reload" })} />
        </span>
        <Input
          ref={inputRef}
          value={draftUrl}
          onChange={(event) => setDraftUrl(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") navigate(draftUrl);
            else if (event.key === "Escape") setDraftUrl(pageUrl);
          }}
          aria-label="URL do navegador"
          placeholder="about:blank"
          spellCheck="false"
          className="agent-browser__url"
        />
        <IconButton
          icon={ExternalLink}
          size="xs"
          aria-label="Abrir no navegador"
          title="Abrir no navegador"
          onClick={() => pageUrl && window.open(pageUrl, "_blank", "noopener,noreferrer")}
        />
        <Button
          variant={takeover ? "primary" : "secondary"}
          size="small"
          leadingIcon={UserRound}
          onClick={() => void toggleTakeover()}
          title="Quando você assume, as ferramentas do agente param de agir"
        >
          {takeover ? "Devolver" : "Assumir"}
        </Button>
      </header>
      {error ? (
        <div className="agent-browser__error" role="alert">
          <span>{error}</span>
          <Button variant="ghost" size="small" onClick={() => setRetryKey((value) => value + 1)}>
            Tentar novamente
          </Button>
        </div>
      ) : null}
      <div className="agent-browser__viewport">
        {!blank && frame ? (
          <img
            ref={imageRef}
            src={`data:image/jpeg;base64,${frame.data}`}
            alt="Tela do navegador do agente"
            tabIndex={0}
            draggable={false}
            onClick={click}
            onWheel={wheel}
            onKeyDown={key}
            className="agent-browser__frame"
          />
        ) : !connected ? (
          <div className="agent-browser__empty">
            <PixelSpinner size={16} />
            <span>Abrindo o navegador do agente…</span>
          </div>
        ) : (
          <div className="agent-browser__empty">
            <Globe2 size={22} />
            <strong>O navegador ainda não abriu uma página.</strong>
            <span>O agente abre e opera o app aqui, ao vivo. Você pode assumir o controle.</span>
          </div>
        )}
      </div>
    </section>
  );
}
