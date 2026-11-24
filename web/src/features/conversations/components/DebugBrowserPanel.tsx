import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, ExternalLink, Globe2, RefreshCw } from "@jeff/icons";
import { PixelSpinner } from "@jeff/ui";
import { api } from "../../../shared/api";
import { IconButton } from "@jeff/ui/app";
import { Input } from "@jeff/ui/app";

interface Props {
  projectId: string;
  /** The bot's own persistent browser instead of the project debug one. */
  agentId?: string;
}

interface Frame {
  data: string;
  width: number;
  height: number;
  url: string;
}

/** The live Chromium a debug-mode agent drives, streamed over CDP. */
export default function DebugBrowserPanel({ projectId, agentId }: Props) {
  const [frame, setFrame] = useState<Frame | null>(null);
  const [pageUrl, setPageUrl] = useState("");
  const [draftUrl, setDraftUrl] = useState("");
  const [error, setError] = useState("");
  const [connected, setConnected] = useState(false);
  const imageRef = useRef<HTMLImageElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const disposed = useRef(false);

  useEffect(() => {
    disposed.current = false;
    let retry = 0;
    let reconnectTimer = 0;
    let heartbeat = 0;

    async function connect() {
      try {
        if (agentId) await api.botBrowser(projectId, agentId);
        else await api.debugBrowser(projectId);
      } catch (err) {
        if (!disposed.current) setError(err instanceof Error ? err.message : "Não foi possível abrir o navegador de debug.");
        return;
      }
      if (disposed.current) return;
      const socket = new WebSocket(
        agentId
          ? api.botBrowserSocketUrl(projectId, agentId)
          : api.debugBrowserSocketUrl(projectId),
      );
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
          // Ignore a malformed frame; the next one arrives.
        }
      };
      socket.onclose = () => {
        window.clearInterval(heartbeat);
        setConnected(false);
        if (disposed.current) return;
        retry += 1;
        reconnectTimer = window.setTimeout(() => void connect(), Math.min(5_000, 500 * retry));
      };
      socket.onerror = () => socket.close();
    }

    void connect();
    return () => {
      disposed.current = true;
      window.clearTimeout(reconnectTimer);
      window.clearInterval(heartbeat);
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [projectId, agentId]);

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

  const blank = !frame || !frame.url || frame.url === "about:blank";
  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden bg-background-full" aria-label="Navegador do agente">
      <header className="flex h-8 shrink-0 items-center gap-1 border-b border-separator-border px-1.5">
        <span className={connected ? "size-1.5 shrink-0 rounded-full bg-status-lime-text" : "size-1.5 shrink-0 rounded-full bg-text-tertiary"} title={connected ? "Ao vivo" : "Reconectando"} />
        <IconButton icon={ArrowLeft} size="xs" aria-label="Voltar" title="Voltar" onClick={() => send({ type: "back" })} className="border-transparent bg-transparent shadow-none" />
        <IconButton icon={ArrowRight} size="xs" aria-label="Avançar" title="Avançar" onClick={() => send({ type: "forward" })} className="border-transparent bg-transparent shadow-none" />
        <IconButton icon={RefreshCw} size="xs" aria-label="Recarregar" title="Recarregar" onClick={() => send({ type: "reload" })} className="border-transparent bg-transparent shadow-none" />
        <Input
          ref={inputRef}
          value={draftUrl}
          onChange={setDraftUrl}
          onKeyDown={(event) => {
            if (event.key === "Enter") navigate(draftUrl);
            else if (event.key === "Escape") setDraftUrl(pageUrl);
          }}
          aria-label="URL do navegador"
          placeholder="about:blank"
          spellCheck="false"
          size="small"
          className="min-w-0 flex-1"
        />
        <IconButton icon={ExternalLink} size="xs" aria-label="Abrir no navegador" title="Abrir no navegador" onClick={() => pageUrl && window.open(pageUrl, "_blank", "noopener,noreferrer")} className="border-transparent bg-transparent shadow-none" />
      </header>
      {error ? (
        <p role="alert" className="shrink-0 border-b border-status-rose-text/20 bg-status-rose-text/10 px-2 py-1.5 text-caption-1-regular text-status-rose-text">
          {error}
        </p>
      ) : null}
      <div className="relative min-h-0 flex-1 bg-[#111]">
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
            className="h-full w-full cursor-crosshair select-none object-contain outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-border-focus-ring"
          />
        ) : !frame ? (
          <div className="flex h-full items-center justify-center gap-2 text-caption-1-regular text-text-tertiary">
            <PixelSpinner size={16} /> Abrindo o navegador do agente…
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-caption-1-regular text-text-tertiary">
            <Globe2 size={22} className="opacity-60" />
            <span>O navegador ainda não abriu uma página.</span>
            <span className="text-[10px] opacity-80">O agente vai abrir e operar o app aqui, ao vivo.</span>
          </div>
        )}
      </div>
    </section>
  );
}
