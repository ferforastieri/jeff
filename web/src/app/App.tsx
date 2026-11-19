import { lazy, Suspense, useEffect, useState } from "react";
import { api, ApiError, setApiBase } from "../shared/api";
import { isDesktopClient } from "../features/settings/store";
import { useApp } from "./store";
import Login from "../features/auth/components/Login";
import ServerSetup from "../features/auth/components/ServerSetup";
import UpdateToast from "../features/updates/components/UpdateToast";
const Workbench = lazy(() => import("./components/Workbench"));


const SERVER_KEY = "jeff_server_url";

interface DesktopInternals {
  invoke?: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
}

/** Returns to the desktop launcher, where local mode and server URLs live. */
async function openLauncher(): Promise<void> {
  const internals = (window as unknown as { __TAURI_INTERNALS__?: DesktopInternals })
    .__TAURI_INTERNALS__;
  if (!internals?.invoke) return;
  try {
    await internals.invoke("show_launcher");
  } catch (error) {
    console.error(error);
  }
}

function initialServerUrl(): string | null {
  const queryServer = new URLSearchParams(window.location.search).get("server");
  if (queryServer) {
    localStorage.setItem(SERVER_KEY, queryServer);
    return queryServer;
  }
  return localStorage.getItem(SERVER_KEY);
}

function AppShell() {
  const user = useApp((state) => state.user);
  const authReady = useApp((state) => state.authReady);
  const setUser = useApp((state) => state.setUser);
  const setAuthReady = useApp((state) => state.setAuthReady);
  const [serverUrl, setServerUrl] = useState<string | null>(initialServerUrl);

  // Warm the workbench chunk while the index.html splash is still covering
  // the app, so leaving the splash never reveals a second loading screen.
  useEffect(() => {
    void import("./components/Workbench");
  }, []);

  useEffect(() => {
    if (!authReady) return;
    const boot = document.getElementById("jeff-boot");
    if (!boot) return;
    let revealed = false;
    let revealTimer = 0;
    let removeTimer = 0;
    let fallbackTimer = 0;
    const reveal = () => {
      if (revealed) return;
      revealed = true;
      window.clearTimeout(fallbackTimer);
      revealTimer = window.setTimeout(() => {
        boot.classList.add("jeff-boot--done");
        removeTimer = window.setTimeout(() => boot.remove(), 320);
      }, 120);
    };
    const ready = () => reveal();
    if (!user || (window as Window & { __jeffWorkbenchReady?: boolean }).__jeffWorkbenchReady) {
      reveal();
    } else {
      // The workbench keeps the splash until projects (and the active one)
      // are on screen; the fallback avoids a splash stuck forever on a bad API.
      window.addEventListener("jeff:workbench-ready", ready, { once: true });
      fallbackTimer = window.setTimeout(reveal, 15_000);
    }
    return () => {
      window.removeEventListener("jeff:workbench-ready", ready);
      window.clearTimeout(revealTimer);
      window.clearTimeout(removeTimer);
      window.clearTimeout(fallbackTimer);
    };
  }, [authReady, user]);

  useEffect(() => {
    if (!serverUrl) {
      setAuthReady(true);
      return;
    }
    setApiBase(serverUrl);
    setAuthReady(false);
    let cancelled = false;

    void (async () => {
      // QR pairing: the desktop hands the phone a one-time code. Consuming it
      // sets the normal HttpOnly session cookie, then the URL is cleaned up so
      // the code never survives in history or a copied address.
      const params = new URLSearchParams(window.location.search);
      const pairingCode = params.get("pair");
      if (pairingCode) {
        try {
          await api.pair(pairingCode);
        } catch (error) {
          console.error(error);
        }
        params.delete("pair");
        const query = params.toString();
        window.history.replaceState(
          null,
          "",
          `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`,
        );
      }

      try {
        const current = await api.me();
        if (!cancelled) setUser(current);
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 401) {
          console.error(error);
        }
        if (!cancelled) setUser(null);
      } finally {
        if (!cancelled) setAuthReady(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [serverUrl, setAuthReady, setUser]);

  function connected(url: string) {
    localStorage.setItem(SERVER_KEY, url);
    setServerUrl(url);
  }

  function changeServer() {
    localStorage.removeItem(SERVER_KEY);
    setApiBase("");
    setUser(null);
    setAuthReady(false);
    setServerUrl(null);
  }

  // The index.html splash covers this first frame; no React boot screen here.
  if (!authReady) return null;

  if (!serverUrl) {
    return <ServerSetup defaultUrl={`${window.location.protocol}//${window.location.host}`} onConnected={connected} />;
  }

  if (!user) {
    return (
      <Login
        onChangeServer={changeServer}
        onOpenLauncher={isDesktopClient() ? () => void openLauncher() : undefined}
      />
    );
  }

  return (
    <>
      <Suspense fallback={null}><Workbench /></Suspense>
      <UpdateToast />
    </>
  );
}

export default function App() {
  return <AppShell />;
}
