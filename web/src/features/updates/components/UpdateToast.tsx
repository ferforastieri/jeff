import { useEffect, useRef, useState } from "react";
import { api, ApiError, type UpdateInstaller, type UpdateStatus } from "../../../shared/api";
import { Icon } from "@jeff/ui";
import { ProgressBar } from "@jeff/ui/app";
import { isMobileViewport } from "../../../shared/ui/useIsMobile";
import { useApp } from "../../../app/store";
import { isDesktopClient } from "../../settings/store";

type Phase = "idle" | "updating" | "error";

interface TauriInternals {
  invoke?: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
}

async function clearClientCaches() {
  if ("caches" in window) {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => caches.delete(key)));
  }
  if ("serviceWorker" in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.update()));
  }
}

function wait(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

async function downloadApk(url: string, version: string) {
  // Android WebView ignores anchor downloads. The native opener hands the APK
  // to the system browser/download manager; an older client without the plugin
  // gets the anchor as a last resort.
  const internals = (window as unknown as {
    __TAURI_INTERNALS__?: { invoke?: (command: string, args?: Record<string, unknown>) => Promise<unknown> };
  }).__TAURI_INTERNALS__;
  if (internals?.invoke) {
    try {
      // The opener may not settle while Android sends the app to the browser:
      // the race lets the toast finish its processing instead of hanging.
      await Promise.race([
        internals.invoke("plugin:opener|open_url", { url }),
        new Promise((resolve) => window.setTimeout(resolve, 2500)),
      ]);
      return;
    } catch {
      // The capability is missing or the opener refused: try the browser below.
    }
  }
  const link = document.createElement("a");
  link.href = url;
  link.download = `jeff-v${version}.apk`;
  link.rel = "noopener";
  link.target = "_blank";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function versions(left: string, right: string): number {
  const a = left.replace(/^v/i, "").split(".").map(Number);
  const b = right.replace(/^v/i, "").split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    const x = Number.isFinite(a[index]) ? a[index] : 0;
    const y = Number.isFinite(b[index]) ? b[index] : 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

function apkVersion(url: string): string {
  return /jeff-v?(\d+\.\d+\.\d+)\.apk/i.exec(url)?.[1] ?? "";
}

async function installedAppVersion(): Promise<string> {
  const internals = (window as unknown as { __TAURI_INTERNALS__?: TauriInternals }).__TAURI_INTERNALS__;
  if (!internals?.invoke) return "";
  try {
    return String(await internals.invoke("plugin:app|version"));
  } catch {
    return "";
  }
}

function isMobile(): boolean {
  return isMobileViewport();
}

function platform(): "windows" | "linux" | "mac" | "other" {
  const value = `${navigator.userAgent} ${navigator.platform}`;
  if (/windows|win32|win64/i.test(value)) return "windows";
  if (/linux|x11/i.test(value)) return "linux";
  if (/macintosh|mac os|darwin/i.test(value)) return "mac";
  return "other";
}

function findInstaller(
  installers: UpdateInstaller[] | undefined,
  kind: UpdateInstaller["kind"],
): UpdateInstaller | undefined {
  return installers?.find((installer) => installer.kind === kind);
}

function preferredInstaller(status: UpdateStatus): UpdateInstaller | undefined {
  const installers = status.installers;
  switch (platform()) {
    case "windows":
      return (
        findInstaller(installers, "windows-nsis") ??
        findInstaller(installers, "windows-msi")
      );
    case "linux":
      return (
        findInstaller(installers, "linux-appimage") ??
        findInstaller(installers, "linux-deb") ??
        findInstaller(installers, "linux-rpm")
      );
    default:
      return undefined;
  }
}

function browserDownload(installer: UpdateInstaller) {
  const link = document.createElement("a");
  link.href = installer.url;
  link.download = installer.name;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

async function downloadInstaller(installer: UpdateInstaller): Promise<string> {
  const internals = (window as unknown as { __TAURI_INTERNALS__?: TauriInternals }).__TAURI_INTERNALS__;
  if (internals?.invoke) {
    const path = await internals.invoke("download_update", {
      url: installer.url,
      filename: installer.name,
      sha256: installer.sha256 ?? "",
    });
    if (typeof path === "string" && path.trim()) return path;
    throw new Error("O download nativo não retornou o caminho do instalador.");
  }
  browserDownload(installer);
  return "";
}

export default function UpdateToast() {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [detail, setDetail] = useState("");
  const [error, setError] = useState("");
  const dismissed = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function check() {
      // A hidden tab has nothing to show; the visibility handler checks again.
      if (document.visibilityState !== "visible") return;
      try {
        const next = await api.updateStatus();
        if (!cancelled) setStatus(next);
      } catch {
        // Older servers do not expose the update endpoint yet.
      }
    }

    void check();
    const timer = window.setInterval(check, 60_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);


  async function update() {
    if (!status || phase === "updating") return;
    const target = status.latestVersion;
    // Only the installed clients download a file: the browser updates the
    // server it is served from, never the desktop installer.
    const native = Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);
    const mobileClient = native && isMobile();
    const desktopClient = !mobileClient && (isDesktopClient() || native);
    const installer = desktopClient ? preferredInstaller(status) : undefined;

    setPhase("updating");
    setError("");
    setDetail(mobileClient || !installer ? "Atualizando o servidor…" : "Baixando o instalador…");
    try {
      if (mobileClient) {
        // The server always updates, even when this release carries no APK:
        // the APK is only the native shell's next version.
        let serverError = "";
        try {
          await api.startUpdate();
        } catch (err) {
          if (!(err instanceof ApiError && err.status === 409)) {
            serverError = err instanceof Error ? err.message : "O servidor não pôde ser atualizado.";
          }
        }
        const apkUrl = status.apkUrl ?? "";
        const installed = await installedAppVersion();
        const available = apkVersion(apkUrl);
        const download = Boolean(apkUrl) && (!installed || !available || versions(available, installed) > 0);
        if (download) {
          await downloadApk(apkUrl, available || target);
          useApp.getState().notify(
            "info",
            serverError
              ? `Download do APK aberto. O servidor não pôde ser atualizado: ${serverError}`
              : "Download do APK aberto e servidor atualizando. Autorize a instalação de apps desconhecidos, se pedido.",
          );
        } else if (apkUrl) {
          useApp.getState().notify(
            serverError ? "error" : "info",
            serverError
              ? `O servidor não pôde ser atualizado: ${serverError}`
              : "Servidor atualizando. O app já está na versão mais recente disponível.",
          );
        } else {
          useApp.getState().notify(
            serverError ? "error" : "info",
            serverError
              ? `O servidor não pôde ser atualizado: ${serverError}`
              : "Servidor atualizando. Esta release não trouxe APK; o app continua na versão instalada.",
          );
        }
        setPhase("idle");
        setDetail("");
        setStatus(null);
        return;
      }
      if (installer) {
        await downloadInstaller(installer);
      }
    } catch (err) {
      setPhase("error");
      setError(
        err instanceof Error
          ? err.message
          : typeof err === "string"
            ? err
            : "Não foi possível baixar o instalador.",
      );
      return;
    }

    const startedAt = Date.now();
    try {
      setDetail("Instalando a atualização…");
      const start = await api.startUpdate();
      if (start.status === "current") {
        setStatus((current) => current ? {
          ...current,
          available: false,
          currentVersion: start.version,
          latestVersion: start.version,
        } : current);
        setPhase("idle");
        setDetail("");
        return;
      }
    } catch (err) {
      // 409 means another update request is already in flight. Keep polling
      // it instead of showing a dead-end error.
      if (!(err instanceof ApiError && err.status === 409)) {
        setPhase("error");
        setError(err instanceof Error ? err.message : "Não foi possível iniciar a atualização.");
        return;
      }
      setDetail("Outra atualização já está em andamento; acompanhando…");
    }

    const deadline = startedAt + 180_000;
    while (Date.now() < deadline) {
      await wait(2_000);
      try {
        const update = await api.updateStatus();
        const elapsed = Date.now() - startedAt;
        if (update.busy) setDetail("O servidor está aplicando a atualização…");
        if (!update.busy && update.error && elapsed > 5_000) {
          setPhase("error");
          setError(update.error);
          return;
        }
        if (!update.busy && elapsed > 20_000 && update.currentVersion !== target) {
          // The updater may be waiting for its path unit. Say so instead of
          // spinning silently until the deadline.
          setDetail("Aguardando o serviço de atualização…");
        }
        if (!update.busy && elapsed > 45_000 && update.currentVersion !== target) {
          setPhase("error");
          setError("O serviço de atualização não iniciou. Confira `systemctl status jeff-update.path` no servidor e tente de novo.");
          return;
        }
        const health = await api.health();
        if (health.version === target || update.currentVersion === target) {
          setDetail("Reiniciando com a nova versão…");
          await clearClientCaches();
          window.location.replace(window.location.href);
          return;
        }
      } catch {
        // The server is restarting; keep polling.
      }
    }
    setPhase("error");
    setError("A atualização não terminou a tempo. Recarregue a página para ver a versão atual; se continuar na antiga, reinicie o serviço.");
  }

  const visible = status?.supported && status.available && dismissed.current !== status.latestVersion;
  const updating = phase === "updating";
  const failed = phase === "error";
  // An update is a call to action: the toast stays until it is closed or the
  // update starts, unlike the short-lived notices.
  if (!visible && !updating && !failed) return null;
  return (
    <div className="ac-toasts" aria-live="polite">
      <div
        className={`ac-toast ac-toast--${failed ? "error" : updating ? "info" : "success"} ac-toast--update cursor-pointer`}
        role={failed ? "alert" : "status"}
        onClick={() => { if (!updating) void update(); }}
        aria-label={failed ? `Falha na atualização: ${error}` : "Clique para atualizar o Jeff"}
      >
        <Icon name={failed ? "alert" : "download"} />
        <span className="ac-toast__text flex min-w-0 flex-col gap-1">
          <b className="ac-toast__title">
            {updating ? (
              <span className="flex items-center gap-1.5">
                <Icon name="spinner" size={14} />
                Atualizando Jeff
              </span>
            ) : failed ? "Falha na atualização" : `Jeff v${status?.latestVersion ?? ""} disponível`}
          </b>
          {updating ? (
            <>
              <small className="ac-toast__detail">{detail || "Preparando a atualização…"}</small>
              <ProgressBar size="sm" isIndeterminate aria-label="Atualizando Jeff" />
            </>
          ) : failed && error ? (
            <small className="ac-toast__detail">{error}</small>
          ) : null}
        </span>
        <button
          type="button"
          className="ac-btn ac-btn--ghost ac-btn--sm ac-btn--icon ac-toast__close"
          aria-label="Fechar"
          onClick={(event) => {
            event.stopPropagation();
            if (status) dismissed.current = status.latestVersion;
            setPhase("idle");
            setDetail("");
            setStatus(null);
          }}
        >
          <Icon name="close" size={16} />
        </button>
      </div>
    </div>
  );
}
