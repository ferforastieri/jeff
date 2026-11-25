import { useEffect, useState, type FormEvent, type ReactNode, type RefObject } from "react";
import { MenuOverlay, MenuOverlayGroup, MenuOverlayItem } from "@jeff/ui";
import { JeffSky } from "@jeff/ui/kit";
import { Button, Input, type IconName } from "faang-ui";
import { api, getApiBase, probeServer, setApiBase, type User } from "../../shared/api";
import { useApp } from "../../app/store";
import type { Section } from "../settings/components/JeffSettings";

export const WORKSPACE_MENU_ITEMS: { section: Section; label: string; icon: IconName }[] = [
  { section: "connectors", label: "Conectores e MCP", icon: "link" },
  { section: "skills", label: "Skills", icon: "routines" },
  { section: "harness", label: "Harness", icon: "plug" },
  { section: "workspace", label: "Configurações do workspace", icon: "drive" },
];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  anchor: RefObject<HTMLButtonElement | null>;
  teamName: string;
  workspaceLogo: string;
  memberCount: number;
  botFaces: Array<{ id: string; face: ReactNode }>;
  userName: string;
  user: User | null;
  isAdmin: boolean;
  onInvite: () => void;
  onSettings: (section: Section) => void;
}

/** The same full-screen workspace menu used by the Slack shell. */
export default function WorkspaceMenu({
  open,
  onOpenChange,
  anchor,
  teamName,
  workspaceLogo,
  memberCount,
  botFaces,
  userName,
  user,
  isAdmin,
  onInvite,
  onSettings,
}: Props) {
  const membersWord = memberCount === 1 ? "membro" : "membros";
  const agentsWord = botFaces.length === 1 ? "agente" : "agentes";
  const summary = `${memberCount} ${membersWord} · ${botFaces.length} ${agentsWord}`;

  return (
    <MenuOverlay
      open={open}
      onOpenChange={onOpenChange}
      anchor={anchor}
      closeLabel="Fechar menu"
      mark={<img className="ws-menu-mark" src={workspaceLogo} alt="" draggable={false} />}
      title={teamName}
      meta={
        <>
          <span>{summary}</span>
          {botFaces.length > 0 ? (
            <span className="ws-menu-crew">
              {botFaces.slice(0, 4).map((bot) => (
                <span className="ws-menu-face" key={bot.id}>{bot.face}</span>
              ))}
            </span>
          ) : null}
        </>
      }
      backdrop={<WorkspaceMenuSky />}
      action={isAdmin ? (
        <Button variant="primary" icon="personAdd" onClick={onInvite}>
          Convidar pessoas
        </Button>
      ) : null}
    >
      <MenuOverlayGroup label={`Menu do workspace ${teamName}`}>
        {WORKSPACE_MENU_ITEMS.map((item) => (
          <MenuOverlayItem key={item.section} icon={item.icon} onSelect={() => onSettings(item.section)}>
            {item.label}
          </MenuOverlayItem>
        ))}
      </MenuOverlayGroup>
      <WorkspaceAccount user={user} name={userName} onClose={() => onOpenChange(false)} />
    </MenuOverlay>
  );
}

export function WorkspaceMenuSky() {
  return <JeffSky srcFor={(name) => `${import.meta.env.BASE_URL}jeffs/${name}.png`} />;
}

/** The account's whole General screen, compact and under the menu's options. */
function WorkspaceAccount({ user, name, onClose }: { user: User | null; name: string; onClose: () => void }) {
  const setUser = useApp((state) => state.setUser);
  const notify = useApp((state) => state.notify);
  const [busy, setBusy] = useState(false);
  const [serverBusy, setServerBusy] = useState(false);
  const [serverDraft, setServerDraft] = useState(() => getApiBase() || window.location.origin);
  const [version, setVersion] = useState("");
  const [buildId, setBuildId] = useState("");

  useEffect(() => {
    let cancelled = false;
    void api.version().then((info) => {
      if (cancelled) return;
      setVersion(info.version);
      setBuildId(info.buildId);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  async function changeServer(event: FormEvent) {
    event.preventDefault();
    setServerBusy(true);
    try {
      const base = await probeServer(serverDraft);
      localStorage.setItem("jeff_server_url", base);
      setApiBase(base);
      window.location.reload();
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "Não foi possível conectar ao servidor.");
    } finally {
      setServerBusy(false);
    }
  }

  async function logout() {
    setBusy(true);
    try {
      await api.logout();
      onClose();
      setUser(null);
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "Não foi possível sair.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="ac-menu ac-mo__group ws-menu-account" aria-label="Sua conta">
      <span className="ac-menu__heading">Sua conta</span>
      <div className="ws-account-row">
        <span className="ws-account-row__label">Usuário</span>
        <span className="ws-account-row__value">{user?.username || name}</span>
      </div>
      <form className="ws-account-server" onSubmit={(event) => void changeServer(event)}>
        <span className="ws-account-row__label">Servidor</span>
        <span className="ws-account-server__row">
          <Input value={serverDraft} onChange={(event) => setServerDraft(event.target.value)} aria-label="URL do servidor" placeholder="https://seu-servidor" />
          <Button type="submit" size="sm" disabled={serverBusy || !serverDraft.trim()}>
            {serverBusy ? "Verificando…" : "Aplicar"}
          </Button>
        </span>
      </form>
      <div className="ws-account-row"><span className="ws-account-row__label">Versão</span><span className="ws-account-row__value">{version ? `v${version}` : "—"}</span></div>
      <div className="ws-account-row"><span className="ws-account-row__label">Build</span><span className="ws-account-row__value">{buildId || "—"}</span></div>
      <div className="ws-account-row ws-account-row--end">
        <span className="ws-account-row__label">Sair da conta</span>
        <Button variant="danger" size="sm" icon="power" disabled={busy} onClick={() => void logout()}>
          {busy ? "Saindo…" : "Sair"}
        </Button>
      </div>
    </section>
  );
}
