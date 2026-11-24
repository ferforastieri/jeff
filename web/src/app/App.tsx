import { lazy, Suspense, useEffect, useState } from "react";
import { api, ApiError, setApiBase, type OnboardingStatus } from "../shared/api";
import { isDesktopClient } from "../features/settings/store";
import { useApp } from "./store";
import { usePrefs } from "../shared/prefs";
import EmailLogin from "../features/auth/components/EmailLogin";
import ServerSetup from "../features/auth/components/ServerSetup";
import UpdateToast from "../features/updates/components/UpdateToast";
import { Button, Card } from "faang-ui";
const Workbench = lazy(() => import("./components/Workbench"));
const Workspace = lazy(() => import("../features/workspace/Workspace"));
const Onboarding = lazy(() => import("../features/onboarding/Onboarding"));
const AcceptInvite = lazy(() => import("../features/onboarding/AcceptInvite"));


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
  // The web build is served by the server it talks to; never ask for a URL first.
  if (!isDesktopClient()) return window.location.origin;
  return localStorage.getItem(SERVER_KEY);
}

function AppShell() {
  const user = useApp((state) => state.user);
  const authReady = useApp((state) => state.authReady);
  const setUser = useApp((state) => state.setUser);
  const setAuthReady = useApp((state) => state.setAuthReady);
  const setWorkspaceTimezone = useApp((state) => state.setWorkspaceTimezone);
  const [serverUrl, setServerUrl] = useState<string | null>(initialServerUrl);
  const [onboarding, setOnboarding] = useState<OnboardingStatus | null>(null);
  const [onboardingReady, setOnboardingReady] = useState(false);

  // Workspace/profile data is server-side now. Drop the old per-browser copies
  // so a device never opens with a stale logo, avatar, timezone or room.
  useEffect(() => {
    for (const key of [
      "jeff_workspace_logo",
      "jeff_profile_kind",
      "jeff_profile_avatar",
      "jeff_profile_photo",
      "jeff_timezone",
      "jeff_open_room",
    ]) {
      try {
        localStorage.removeItem(key);
      } catch {
        /* private mode */
      }
    }
  }, []);

  useEffect(() => {
    if (!authReady || !user) return;
    void usePrefs.getState().load();
  }, [authReady, user]);

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

  useEffect(() => {
    if (!user) {
      setOnboarding(null);
      setOnboardingReady(true);
      return;
    }
    let cancelled = false;
    setOnboardingReady(false);
    void api
      .onboarding()
      .then((value) => {
        if (cancelled) return;
        if (value.timezone) setWorkspaceTimezone(value.timezone);
        setOnboarding(value);
        setOnboardingReady(true);
        (window as Window & { __jeffWorkbenchReady?: boolean }).__jeffWorkbenchReady = true;
        window.dispatchEvent(new Event("jeff:workbench-ready"));
      })
      .catch(() => {
        if (cancelled) return;
        setOnboarding(null);
        setOnboardingReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  function connected(url: string) {
    localStorage.setItem(SERVER_KEY, url);
    setServerUrl(url);
  }

  // The index.html splash covers this first frame; no React boot screen here.
  if (!authReady) return null;

  if (!serverUrl) {
    return <ServerSetup defaultUrl={`${window.location.protocol}//${window.location.host}`} onConnected={connected} />;
  }

  if (!user) {
    const invite = new URLSearchParams(window.location.search).get("invite");
    if (invite) {
      return (
        <Suspense fallback={null}>
          <AcceptInvite token={invite} />
        </Suspense>
      );
    }
    return (
      <EmailLogin
        onConnected={connected}
        onOpenLauncher={isDesktopClient() ? () => void openLauncher() : undefined}
      />
    );
  }

  if (!onboardingReady) return null;

  if (onboarding && !onboarding.done) {
    return (
      <Suspense fallback={null}>
        <Onboarding
          status={onboarding}
          onDone={() => {
            window.location.reload();
          }}
        />
      </Suspense>
    );
  }

  const wantsDev = new URLSearchParams(window.location.search).get("dev") === "1";
  if (onboarding?.devMode && wantsDev) {
    localStorage.removeItem("jeff_open_rooms");
    return (
      <>
        <Suspense fallback={null}><Workbench /></Suspense>
        <UpdateToast />
      </>
    );
  }

  if (onboarding) {
    return (
      <>
        <Suspense fallback={null}>
          <Workspace status={onboarding} />
        </Suspense>
        <UpdateToast />
      </>
    );
  }

  return (
    <main className="jeff-welcome">
      <section className="jeff-welcome__main">
        <Card className="jeff-step__card">
          <h1 className="jeff-welcome__question">Não foi possível abrir o workspace</h1>
          <p className="jeff-welcome__hint">Tente recarregar. O modo dev não é aberto por padrão.</p>
          <Button variant="primary" size="sm" block onClick={() => window.location.reload()}>
            Tentar de novo
          </Button>
        </Card>
      </section>
    </main>
  );
}

export default function App() {
  return <AppShell />;
}
