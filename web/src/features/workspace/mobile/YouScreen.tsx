import { useEffect, useState, type ReactNode } from "react";
import {
  ChevronRight,
  Globe2,
  HardDrive,
  LogOut,
  MenuBars,
  Moon,
  PlugZap,
  Settings2,
  Sparkles,
  Sun,
  UserRound,
} from "@jeff/icons";
import { Menu, MenuRadioGroup } from "faang-ui";
import { api, getApiBase, type User } from "../../../shared/api";
import { useApp } from "../../../app/store";
import { useSettings } from "../../../features/settings/store";
import { usePrefs } from "../../../shared/prefs";
import { MEMBER_STATUS_LABEL, type MemberStatus } from "../../../shared/ui/presence";
import { runThemeTransition } from "../../../shared/ui/theme-transition";
import { cx } from "@jeff/ui";
import MobileScreenHeader from "../../../app/layouts/mobile/components/MobileScreenHeader";
import MobileIconButton from "../../../app/layouts/mobile/components/MobileIconButton";
import { type Section } from "../../settings/components/JeffSettings";

interface Props {
  user: User | null;
  userName: string;
  userFace: ReactNode;
  userStatus: MemberStatus;
  workspaceName: string;
  workspaceLogo: string;
  memberCount: number;
  agentCount: number;
  projectRoot: string;
  onOpenSettings: (section: Section) => void;
  onMenu: () => void;
}

const SETTINGS: Array<{ section: Section; label: string; hint: string; icon: ReactNode }> = [
  { section: "general", label: "Geral", hint: "Conta, servidor e modelos", icon: <Settings2 className="m-settingrow__glyph" /> },
  { section: "skills", label: "Skills", hint: "Receitas que o Jeff lê sob demanda", icon: <Sparkles className="m-settingrow__glyph" /> },
  { section: "connectors", label: "Conectores e MCP", hint: "Contas, OAuth e servidores MCP", icon: <Globe2 className="m-settingrow__glyph" /> },
  { section: "harness", label: "Harness", hint: "Os CLIs que conduzem o agente", icon: <PlugZap className="m-settingrow__glyph" /> },
  { section: "workspace", label: "Workspace", hint: "Pastas acessíveis pelo Jeff", icon: <HardDrive className="m-settingrow__glyph" /> },
];

/** Você: the phone's profile, presence, appearance and the way into Settings. */
export default function YouScreen({
  user,
  userName,
  userFace,
  userStatus,
  workspaceName,
  workspaceLogo,
  memberCount,
  agentCount,
  projectRoot,
  onOpenSettings,
  onMenu,
}: Props) {
  const theme = useSettings((state) => state.theme);
  const setTheme = useSettings((state) => state.setTheme);
  const setUserStatus = usePrefs((state) => state.update);
  const logout = useApp((state) => state.setUser);
  const notify = useApp((state) => state.notify);
  const [version, setVersion] = useState("");
  const [busy, setBusy] = useState(false);
  const server = getApiBase() || window.location.origin;
  const light = theme === "light";

  useEffect(() => {
    void api
      .version()
      .then((info) => setVersion(info.version))
      .catch(() => undefined);
  }, []);

  function changeTheme(next: "light" | "dark", event: React.MouseEvent<HTMLButtonElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    void runThemeTransition(
      { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
      () => setTheme(next),
    );
  }

  async function signOut() {
    setBusy(true);
    try {
      await api.logout();
      logout(null);
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "Não foi possível sair.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="m-screen">
      <MobileScreenHeader title="Você" subtitle={workspaceName} lead={<MobileIconButton icon={MenuBars} label="Abrir navegação" onClick={onMenu} />} />
      <div className="m-scroll">
        <section className="m-profilecard">
          <span className="m-profilecard__face">
            {userFace}
            <span className="m-presence" data-status={userStatus} aria-hidden="true" />
          </span>
          <div className="m-profilecard__copy">
            <strong>{userName}</strong>
            <small>{user?.username?.includes("@") ? user.username : `@${user?.username ?? "você"}`}</small>
            <Menu
              align="start"
              label="Seu status"
              trigger={
                <button type="button" className="m-profilecard__status">
                  <span className="m-presence-dot" data-status={userStatus} aria-hidden="true" />
                  {MEMBER_STATUS_LABEL[userStatus]}
                  <ChevronRight className="m-profilecard__chevron" />
                </button>
              }
            >
              <MenuRadioGroup
                label="Seu status"
                value={userStatus}
                onValueChange={(value) => setUserStatus({ userStatus: value as MemberStatus })}
                options={(["online", "away", "busy", "offline"] as MemberStatus[]).map((value) => ({
                  value,
                  label: MEMBER_STATUS_LABEL[value],
                  leading: <span className="m-status-mark" data-status={value} />,
                }))}
              />
            </Menu>
          </div>
        </section>

        <section className="m-wscard">
          <img src={workspaceLogo} alt="" className="m-wscard__logo" draggable={false} />
          <div className="m-wscard__copy">
            <strong>{workspaceName}</strong>
            <small>{memberCount} {memberCount === 1 ? "membro" : "membros"} · {agentCount} {agentCount === 1 ? "agente" : "agentes"}</small>
          </div>
        </section>

        <section className="m-block">
          <h2 className="m-block__title">Aparência</h2>
          <div className="m-themecard">
            <span className="m-themecard__copy">
              {light ? <Sun className="m-themecard__glyph" /> : <Moon className="m-themecard__glyph" />}
              <span>
                <strong>{light ? "Modo claro" : "Modo escuro"}</strong>
                <small>Vale para todas as telas</small>
              </span>
            </span>
            <div className="m-themecard__toggle">
              <button type="button" aria-pressed={light} className={cx(light && "is-active")} onClick={(event) => changeTheme("light", event)} aria-label="Ativar modo claro">
                <Sun className="m-themecard__icon" />
              </button>
              <button type="button" aria-pressed={!light} className={cx(!light && "is-active")} onClick={(event) => changeTheme("dark", event)} aria-label="Ativar modo escuro">
                <Moon className="m-themecard__icon" />
              </button>
            </div>
          </div>
        </section>

        <section className="m-block">
          <h2 className="m-block__title">Configurações</h2>
          <div className="m-settinglist">
            {SETTINGS.map((item) => (
              <button key={item.section} type="button" className="m-settingrow" onClick={() => onOpenSettings(item.section)}>
                <span className="m-settingrow__icon">{item.icon}</span>
                <span className="m-settingrow__copy">
                  <strong>{item.label}</strong>
                  <small>{item.hint}</small>
                </span>
                <ChevronRight className="m-settingrow__chevron" />
              </button>
            ))}
          </div>
        </section>

        <section className="m-block">
          <h2 className="m-block__title">Conta</h2>
          <div className="m-accountcard">
            <div className="m-accountrow">
              <span>Servidor</span>
              <strong title={server}>{server.replace(/^https?:\/\//, "")}</strong>
            </div>
            <div className="m-accountrow">
              <span>Versão</span>
              <strong>{version ? `v${version}` : "—"}</strong>
            </div>
            <div className="m-accountrow">
              <span>Pasta do workspace</span>
              <strong title={projectRoot}>{projectRoot || "—"}</strong>
            </div>
          </div>
          <button type="button" className="m-signout" disabled={busy} onClick={() => void signOut()}>
            <LogOut className="m-signout__icon" />
            {busy ? "Saindo…" : "Sair da conta"}
          </button>
        </section>

        <p className="m-footer">
          <UserRound className="m-footer__icon" />
          Jeff · seu servidor, seus dados
        </p>
        <div className="m-scroll__end" />
      </div>
    </div>
  );
}
