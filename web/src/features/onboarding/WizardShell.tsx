import type { ReactNode } from "react";
import {
  Avatar,
  Button,
  Card,
  Chip,
  GroupHeading,
  Icon,
  Kbd,
  ListRow,
  SearchField,
  type PersonRecipe,
} from "faang-ui";
import { JeffLoader, JeffSky } from "@jeff/ui/kit";
import { PersonFace } from "./PersonFace";

const STEP_LABELS = [
  "Nome do workspace",
  "O que vocês fazem",
  "Sobre você",
  "Conectar uma IA",
  "Convidar pessoas",
] as const;

interface Props {
  step: number;
  firstName: string;
  logo: string;
  workspaceName?: string;
  workspaceLogo?: string | null;
  profileKind?: "initials" | "person" | "photo";
  profileRecipe?: PersonRecipe | null;
  profilePhoto?: string | null;
  jeffSrc: (name: string) => string;
  title: ReactNode;
  meta: ReactNode;
  notes?: Array<string | undefined>;
  side?: ReactNode;
  onBack?: () => void;
  actions?: ReactNode;
  children: ReactNode;
}

/** The workspace setup shell: numbered steps on the left, the step in the middle, the workspace on the right. */
export function WizardShell({
  step,
  firstName,
  logo,
  workspaceName,
  workspaceLogo,
  profileKind = "initials",
  profileRecipe,
  profilePhoto,
  jeffSrc,
  title,
  meta,
  notes,
  side,
  onBack,
  actions,
  children,
}: Props) {
  const done = Math.min(step, STEP_LABELS.length);
  const markSrc = `${import.meta.env.BASE_URL}brand/jeff-mark.png`;
  const remaining = STEP_LABELS.length - done;
  const guide = [
    `Oi, ${firstName}. Eu sou o Jeff. Vou montar o time com você em uns dois minutos.`,
    "Com isso eu já sei quem chamar para o time.",
    "Prazer. Como você quer ser chamado?",
    "Escolha a IA que você já usa e eu acordo. Depois, falta só chamar as pessoas.",
    "Agora as pessoas. Mande o link e eu te mostro cada pedido.",
  ][Math.min(step, 4)];

  return (
    <main className="jeff-wizard">
      <JeffSky srcFor={jeffSrc} />
      <div className="jeff-wizard__veil" aria-hidden="true" />

      <aside className="jeff-wizard__rail">
        <div className="jeff-wizard__brand">
          <img src={logo} alt="Jeff" draggable={false} />
        </div>

        <div className="jeff-wizard__progress">
          <div className="jeff-wizard__progress-line">
            <span>{remaining === 1 ? "Falta 1 etapa" : `Faltam ${remaining} etapas`}</span>
            <span>
              {done} de {STEP_LABELS.length}
            </span>
          </div>
          <div className="jeff-wizard__progress-track">
            <span style={{ width: `${(done / STEP_LABELS.length) * 100}%` }} />
            <span
              className="jeff-wizard__progress-hop"
              style={{ left: `${(done / STEP_LABELS.length) * 100}%` }}
            >
              <JeffLoader src={jeffSrc("jeff-01-blue")} size={32} />
            </span>
          </div>
        </div>

        <ol className="jeff-wizard__steps">
          {STEP_LABELS.map((label, index) => (
            <li
              key={label}
              className={index === step ? "is-now" : index < step ? "is-done" : ""}
            >
              <span className="jeff-wizard__step-number">
                {index < step ? <Icon name="check" size={14} /> : index + 1}
              </span>
              <span className="jeff-wizard__step-label">
                {label}
                {index < step && notes?.[index] ? <small>{notes[index]}</small> : null}
              </span>
            </li>
          ))}
        </ol>

        <div className="jeff-wizard__guide">
          <Card className="jeff-wizard__guide-bubble">
            <p>{guide}</p>
          </Card>
          <div className="jeff-wizard__guide-who">
            <img src={jeffSrc("jeff-01-blue")} alt="" draggable={false} />
            <Chip>Jeff</Chip>
          </div>
        </div>
      </aside>

      <section className="jeff-wizard__main">
        <header className="jeff-wizard__head">
          {onBack ? (
            <Button variant="link" icon="chevronLeft" className="jeff-wizard__back" onClick={onBack}>
              Voltar
            </Button>
          ) : null}
          <p className="jeff-wizard__eyebrow">
            Passo {step + 1} de {STEP_LABELS.length}
          </p>
          <h1>{title}</h1>
          <p>{meta}</p>
        </header>
        <div className="jeff-wizard__content">{children}</div>
        {actions ? <div className="jeff-wizard__actions">{actions}</div> : null}
      </section>

      <aside className="jeff-wizard__side">
        {side ?? (
          <div className="jeff-wizard__side-preview">
            <div className="ws-sidebar">
              <div className="ws-ambient" aria-hidden="true" />
              <header className="ws-workspace">
                <span className="ws-workspace-mark">
                  <img src={workspaceLogo || markSrc} alt="" draggable={false} />
                </span>
                <span className="ws-workspace-title">
                  <strong>{workspaceName?.trim() || "Seu workspace"}</strong>
                  <small>Seu servidor · 1 membro · 1 agente</small>
                </span>
                <Icon name="chevronDown" size={16} />
              </header>

              <div className="ws-search">
                <div className="ws-search-row">
                  <SearchField
                    placeholder="Ir para…"
                    size="sm"
                    shortcut={
                      <span className="ws-kbd">
                        <Kbd>Ctrl</Kbd>
                        <Kbd>K</Kbd>
                      </span>
                    }
                    readOnly
                    aria-label="Ir para"
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    iconOnly
                    icon="bolt"
                    aria-label="Agentes nos canais"
                    className="ws-working"
                    tabIndex={-1}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    iconOnly
                    icon="sidebar"
                    aria-label="Recolher barra"
                    tabIndex={-1}
                  />
                </div>
              </div>

              <nav className="ws-nav" aria-label="Workspace">
                <ListRow
                  className="is-active"
                  lead={<Icon name="home" size={16} />}
                  title="Início"
                />
                <ListRow lead={<Icon name="checks" size={16} />} title="Tarefas" />
                <ListRow lead={<Icon name="calendar" size={16} />} title="Calendário" />
                <ListRow lead={<Icon name="drive" size={16} />} title="Drive" />
                <ListRow lead={<Icon name="book" size={16} />} title="Wiki" />
              </nav>

              <div className="ws-sidebar-scroll">
                <GroupHeading
                  title={
                    <span className="ws-heading">
                      <Icon name="chevronDown" size={14} />
                      <span>Canais</span>
                    </span>
                  }
                  aside={
                    <Button
                      variant="ghost"
                      size="sm"
                      iconOnly
                      icon="plus"
                      aria-label="Criar canal"
                      tabIndex={-1}
                    />
                  }
                />
                <ListRow lead={<Icon name="channel" size={16} />} title="general" />

                <GroupHeading
                  title={
                    <span className="ws-heading">
                      <Icon name="chevronDown" size={14} />
                      <span>Agentes</span>
                    </span>
                  }
                  aside={
                    <Button
                      variant="ghost"
                      size="sm"
                      iconOnly
                      icon="plus"
                      aria-label="Novo agente"
                      tabIndex={-1}
                    />
                  }
                />
                <ListRow
                  className="is-active ws-agent-row"
                  lead={
                    <span className="ws-face ws-face--agent" style={{ width: 32, height: 32 }}>
                      <img src={jeffSrc("jeff-01-blue")} alt="" draggable={false} />
                    </span>
                  }
                  title="Jeff"
                  meta="seu braço direito"
                />

                <GroupHeading
                  title={
                    <span className="ws-heading">
                      <Icon name="chevronDown" size={14} />
                      <span>Mensagens diretas</span>
                    </span>
                  }
                />
                <p className="ws-dm-note">
                  Suas conversas com pessoas aparecem aqui.{" "}
                  <Button variant="link">Nova mensagem</Button>
                </p>
              </div>

              <footer className="ws-user">
                {profileKind === "person" && profileRecipe ? (
                  <span className="ws-face" style={{ width: 28, height: 28 }}>
                    <PersonFace recipe={profileRecipe} crop="face" />
                  </span>
                ) : (
                  <Avatar
                    kind="person"
                    name={firstName}
                    size="sm"
                    imageUrl={profileKind === "photo" ? profilePhoto : null}
                  />
                )}
                <span className="ws-user-copy">
                  <strong>{firstName}</strong>
                  <small>Online</small>
                </span>
                <Button variant="ghost" size="sm" iconOnly icon="bell" aria-label="Notificações" />
              </footer>
            </div>
          </div>
        )}
      </aside>
    </main>
  );
}
