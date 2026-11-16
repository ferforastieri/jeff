import { useEffect, useRef, useState } from "react";
import { ArrowRight, CircleAlert, ExternalLink, RefreshCw } from "@toph/icons";
import { webPreviewUrl } from "../../../shared/api";
import { normalizeHttpUrl } from "../../../shared/lib";
import type { Tab } from "../../../app/store";
import { Button } from "@toph/ui/app";
import { IconLinkButton } from "@toph/ui/app";
import { Input } from "@toph/ui/app";

export default function WebPanelTab({ tab }: { tab: Tab }) {
  const [reloadKey, setReloadKey] = useState(0);
  const [draftUrl, setDraftUrl] = useState(tab.url ?? "");
  const [activeUrl, setActiveUrl] = useState(tab.url ?? "");
  const [previewError, setPreviewError] = useState("");
  const [blankPreview, setBlankPreview] = useState(false);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const blankTimer = useRef(0);

  useEffect(() => {
    setDraftUrl(tab.url ?? "");
    setActiveUrl(tab.url ?? "");
    setReloadKey(0);
  }, [tab.url]);

  useEffect(() => {
    if (!activeUrl) {
      setPreviewError("");
      return;
    }
    const controller = new AbortController();
    let cancelled = false;
    setPreviewError("");
    setBlankPreview(false);
    void fetch(webPreviewUrl(activeUrl), { credentials: "include", signal: controller.signal })
      .then(async (response) => {
        if (cancelled || response.ok) return;
        const text = await response.text();
        const document = new DOMParser().parseFromString(text, "text/html");
        const message = document.querySelector("main p")?.textContent?.trim();
        setPreviewError(message || `O servidor respondeu HTTP ${response.status}.`);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [activeUrl, reloadKey]);

  function loadUrl(raw: string) {
    const next = normalizeHttpUrl(raw);
    if (!next) return;
    setDraftUrl(next);
    setActiveUrl(next);
    setPreviewError("");
    setBlankPreview(false);
    setReloadKey((value) => value + 1);
  }

  function inspectFrame() {
    window.clearTimeout(blankTimer.current);
    blankTimer.current = window.setTimeout(() => {
      const document = frameRef.current?.contentDocument;
      if (!document) return;
      const text = document.body?.innerText?.trim() ?? "";
      const painted = document.querySelector("canvas, svg, video, img, iframe");
      setBlankPreview(!text && !painted);
    }, 2500);
  }

  useEffect(() => () => window.clearTimeout(blankTimer.current), []);

  if (!activeUrl) return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Nenhuma URL configurada.</div>;
  const serverLocal = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::|\/|$)/i.test(activeUrl);
  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col">
      <div className="flex shrink-0 flex-col gap-2 border-b bg-muted/20 px-2 py-2 min-[901px]:h-8 min-[901px]:flex-row min-[901px]:items-center min-[901px]:gap-1 min-[901px]:py-0">
        <Input
          value={draftUrl}
          onChange={setDraftUrl}
          onKeyDown={(event) => {
            if (event.key === "Enter") loadUrl(draftUrl);
            else if (event.key === "Escape") setDraftUrl(activeUrl);
          }}
          aria-label="URL do preview"
          spellCheck="false"
          size="small"
          className="min-w-0 flex-1"
        />
        <div className="flex w-full items-center gap-1 min-[901px]:w-auto">
          <Button variant="ghost" size="xs" iconOnly leadingIcon={ArrowRight} aria-label="Abrir link no preview" title="Abrir link no preview" className="max-[900px]:flex-1" onClick={() => loadUrl(draftUrl)} />
          <Button variant="ghost" size="xs" iconOnly leadingIcon={RefreshCw} aria-label="Recarregar preview" title="Recarregar preview" className="max-[900px]:flex-1" onClick={() => setReloadKey((value) => value + 1)} />
          <IconLinkButton icon={ExternalLink} size="small" aria-label="Abrir endereço original" title="Abrir endereço original" href={activeUrl} target="_blank" rel="noreferrer" className="max-[900px]:flex-1 border-transparent bg-transparent shadow-none" />
        </div>
      </div>
      {previewError ? (
        <div className="flex shrink-0 items-start gap-2 border-b border-status-rose-text/20 bg-status-rose-text/10 px-2 py-1.5 text-caption-1-regular text-status-rose-text">
          <CircleAlert size={14} className="mt-0.5 shrink-0" />
          <span className="min-w-0 flex-1">{previewError}</span>
        </div>
      ) : serverLocal ? (
        <p className="shrink-0 border-b border-separator-border px-2 py-1 text-[10px] leading-relaxed text-text-tertiary">
          O preview abre pelo servidor Toph: <code>localhost</code> aqui é o servidor, não o seu computador. Se o dev server roda na sua máquina, use o endereço original ou exponha-o na rede/túnel.
        </p>
      ) : null}
      {blankPreview && !previewError ? (
        <div className="flex shrink-0 items-start gap-2 border-b border-separator-border bg-background-secondary-default px-2 py-1.5 text-caption-1-regular text-status-yellow-text">
          <CircleAlert size={14} className="mt-0.5 shrink-0" />
          <span className="min-w-0 flex-1">A página carregou, mas o app não desenhou nada. Ele pode depender de WebSocket (HMR/socket) ou de rotas na raiz; use “Abrir endereço original” para conferir.</span>
        </div>
      ) : null}
      <iframe
        ref={frameRef}
        key={`${activeUrl}:${reloadKey}`}
        className="min-h-0 w-full flex-1 border-0 bg-background"
        src={webPreviewUrl(activeUrl)}
        title={tab.title}
        onLoad={inspectFrame}
        sandbox="allow-scripts allow-forms allow-popups allow-modals allow-downloads allow-same-origin"
        referrerPolicy="no-referrer"
      />
    </div>
  );
}
