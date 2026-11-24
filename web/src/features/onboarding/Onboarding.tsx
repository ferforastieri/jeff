import { useState, type ReactNode } from "react";
import { Button } from "faang-ui/components/Button";
import { Field, FormStack, Input } from "faang-ui/components/Field";
import {
  Card,
  Icon,
  OptionCard,
  ProviderLogo,
  type IconName,
  type PersonRecipe,
} from "faang-ui";
import { TimezoneSelect, type TimezoneSelectLabels } from "faang-ui/components/TimezoneSelect";
import { api, type OnboardingStatus } from "../../shared/api";
import { useApp } from "../../app/store";
import { WizardShell } from "./WizardShell";
import { WorkspaceLogoDialog } from "./WorkspaceLogoDialog";
import { ProfilePhotoDialog } from "./ProfilePhotoDialog";
import { ProfileAvatarDialog } from "./ProfileAvatarDialog";
import { ApiKeyDialog } from "./ApiKeyDialog";
import { PersonFace } from "./PersonFace";

const ACTIVITIES: { value: string; icon: IconName }[] = [
  { value: "Agência", icon: "crown" },
  { value: "Loja online", icon: "wallet" },
  { value: "Clínica ou consultório", icon: "shield" },
  { value: "Software e apps", icon: "code" },
  { value: "Atendimento ao cliente", icon: "sound" },
  { value: "Escritório de serviços", icon: "document" },
  { value: "Outra coisa", icon: "more" },
];

const TIMEZONE_LABELS: TimezoneSelectLabels = {
  search: "Buscar fuso",
  searchPlaceholder: "Cidade, país, UTC−3…",
  groups: {
    suggested: "Sugeridos",
    America: "América",
    Europe: "Europa",
    Asia: "Ásia",
    Africa: "África",
    Oceania: "Oceania",
    Antarctica: "Antártida",
    Other: "Outros",
  },
  noResults: "Nenhum fuso encontrado.",
  list: "Fusos horários",
};

const TIMEZONE_NAMES: Record<string, string> = {
  "America/Sao_Paulo": "Horário de Brasília",
  UTC: "UTC",
};

interface Props {
  status: OnboardingStatus;
  onDone: () => void;
}

function JeffProfilePortrait({ recipe }: { recipe: PersonRecipe }) {
  return (
    <span className="jeff-profile-portrait">
      <PersonFace recipe={recipe} crop="full" />
    </span>
  );
}

function AiOption({
  pressed,
  onClick,
  logo,
  title,
  meta,
  trailing,
}: {
  pressed: boolean;
  onClick: () => void;
  logo: ReactNode;
  title: string;
  meta: string;
  trailing: ReactNode;
}) {
  return (
    <OptionCard pressed={pressed} onClick={onClick} className="jeff-ai__option">
      {logo}
      <span className="jeff-ai__text">
        <strong>{title}</strong>
        <span>{meta}</span>
      </span>
      {trailing}
    </OptionCard>
  );
}

export default function Onboarding({ status, onDone }: Props) {
  const setWorkspaceTimezone = useApp((state) => state.setWorkspaceTimezone);
  const workspaceTimezone = useApp((state) => state.workspaceTimezone);
  const [step, setStep] = useState(0);
  const [workspaceName, setWorkspaceName] = useState(status.teamName || "");
  const [workspaceLogo, setWorkspaceLogo] = useState<string | null>(
    status.workspaceLogo || null,
  );
  const initialAvatar = status.avatar as {
    kind?: string;
    recipe?: PersonRecipe;
    url?: string;
  };
  const [logoOpen, setLogoOpen] = useState(false);
  const [avatarOpen, setAvatarOpen] = useState(false);
  const [photoOpen, setPhotoOpen] = useState(false);
  const [apiKeyOpen, setApiKeyOpen] = useState(false);
  const [apiKeyProvider, setApiKeyProvider] = useState<"anthropic" | "openai" | "custom">("anthropic");
  const [profileKind, setProfileKind] = useState<"initials" | "person" | "photo">(
    initialAvatar.kind === "person" && initialAvatar.recipe
      ? "person"
      : initialAvatar.kind === "photo" && initialAvatar.url
        ? "photo"
        : "initials",
  );
  const [profileRecipe, setProfileRecipe] = useState<PersonRecipe | null>(
    initialAvatar.recipe ?? null,
  );
  const [profilePhoto, setProfilePhoto] = useState<string | null>(
    initialAvatar.url ?? null,
  );
  const [timeZone, setTimeZone] = useState<string>(
    status.timezone || workspaceTimezone || "America/Sao_Paulo",
  );
  const [displayName, setDisplayName] = useState(
    status.displayName === "Admin" ? "" : status.displayName || "",
  );
  const [activity, setActivity] = useState(
    ACTIVITIES.some((item) => item.value === status.activity) ? status.activity : "",
  );
  const [objective, setObjective] = useState(status.objective);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [aiChoice, setAiChoice] = useState<string | null>(null);

  const logoSrc = `${import.meta.env.BASE_URL}brand/jeff-logo-horizontal.png`;
  const jeffSrc = (name: string) => `${import.meta.env.BASE_URL}jeffs/${name}.png`;
  const firstName = displayName.trim().split(/\s+/)[0] || "você";
  const avatarPayload =
    profileKind === "photo" && profilePhoto
      ? { kind: "photo", url: profilePhoto }
      : profileKind === "person" && profileRecipe
        ? { kind: "person", recipe: profileRecipe }
        : {};

  const last = step === 4;
  const titles = [
    { title: "Como se chama o seu workspace?", meta: "É onde o time e os agentes conversam." },
    {
      title: workspaceName.trim()
        ? `O que a ${workspaceName.trim()} faz?`
        : "O que vocês fazem?",
      meta: "Todos os agentes leem isso. Você muda quando quiser.",
    },
    { title: "Sobre você", meta: "Como você quer ser chamado?" },
    {
      title: "Conecte uma IA para o Jeff pensar",
      meta: "Use uma assinatura que você já tem. Nada muda no seu plano.",
    },
    {
      title: "Quem trabalha com você?",
      meta: "Quem abrir pede para entrar. Eu te mostro cada pedido, e você aprova.",
    },
  ];
  const current = titles[Math.max(0, Math.min(titles.length - 1, step))];

  async function next() {
    setError("");
    if (step === 0) {
      if (!workspaceName.trim()) {
        setError("Dê um nome ao workspace.");
        return;
      }
      setStep(1);
      return;
    }
    if (step === 1) {
      if (!activity) {
        setError("Escolha o que vocês fazem.");
        return;
      }
      setStep(2);
      return;
    }
    if (step === 2) {
      const name = displayName.trim();
      if (!name) {
        setError("Informe seu nome.");
        return;
      }
      if (name !== status.displayName) {
        setBusy(true);
        try {
          await api.setDisplayName(name);
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "Não foi possível salvar seu nome.");
          setBusy(false);
          return;
        } finally {
          setBusy(false);
        }
      }
      setStep(3);
      return;
    }
    if (step === 3) {
      setStep(4);
      return;
    }
    if (last) {
      void finish();
    }
  }

  async function finish() {
    setBusy(true);
    setError("");
    try {
      await api.completeOnboarding({
        activity,
        objective,
        tools: status.tools,
        agentName: "Jeff",
        teamName: workspaceName.trim(),
        timezone: timeZone,
        avatar: avatarPayload,
        workspaceLogo: workspaceLogo ?? "",
      });
      onDone();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível concluir.");
    } finally {
      setBusy(false);
    }
  }

  async function createInviteLink() {
    setInviteBusy(true);
    setError("");
    try {
      const invite = await api.createInvite("member", 30);
      setInviteLink(
        `${window.location.origin}/app/?invite=${encodeURIComponent(invite.token)}`,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível criar o link.");
    } finally {
      setInviteBusy(false);
    }
  }

  function copyInvite() {
    if (inviteLink) void navigator.clipboard?.writeText(inviteLink);
  }

  if (!status.isAdmin) {
    return (
      <main className="jeff-welcome">
        <section className="jeff-welcome__main">
          <Card className="jeff-step__card">
            <h1 className="jeff-welcome__question">Quase lá</h1>
            <p className="jeff-welcome__hint">
              O admin do time ainda está configurando o workspace. Assim que ele concluir, você
              entra direto nas salas.
            </p>
            <Button variant="primary" size="sm" block onClick={() => window.location.reload()}>
              Verificar de novo
            </Button>
          </Card>
        </section>
      </main>
    );
  }

  const disabled =
    (step === 0 && !workspaceName.trim()) ||
    (step === 1 && !activity) ||
    (step === 2 && !displayName.trim());

  const actions =
    step === 3 ? undefined : (
      <Button
        variant="primary"
        size="sm"
        block
        loading={busy}
        disabled={disabled}
        onClick={() => void next()}
      >
        {last ? "Entrar no workspace" : "Continuar"}
      </Button>
    );

  return (
    <>
      <WizardShell
        step={step}
        firstName={firstName}
        logo={logoSrc}
        workspaceName={workspaceName}
        workspaceLogo={workspaceLogo}
        profileKind={profileKind}
        profileRecipe={profileRecipe}
        profilePhoto={profilePhoto}
        jeffSrc={jeffSrc}
        title={current.title}
        meta={current.meta}
        notes={[workspaceName.trim(), activity, displayName.trim(), "Depois"]}
        onBack={step > 0 ? () => setStep(step - 1) : undefined}
        actions={actions}
      >
        {step === 0 ? (
          <div className="jeff-workspace-name">
            <div className="jeff-workspace-name__row">
              <Button
                variant="default"
                size="sm"
                iconOnly
                icon="upload"
                aria-label="Enviar imagem do workspace"
                className="jeff-workspace-name__upload"
                onClick={() => setLogoOpen(true)}
              />
              <Field
                className="jeff-workspace-name__field"
                label={<span className="ac-visually-hidden">Nome do workspace</span>}
              >
                <Input
                  placeholder="Ex.: Acme"
                  value={workspaceName}
                  onChange={(event) => setWorkspaceName(event.target.value)}
                  autoFocus
                />
              </Field>
            </div>
            <div className="jeff-workspace-name__tz">
              <Field label="Fuso horário">
                <TimezoneSelect
                  value={timeZone}
                  onChange={(zone) => {
                    setTimeZone(zone);
                    setWorkspaceTimezone(zone);
                  }}
                  labels={TIMEZONE_LABELS}
                  nameOf={(zone) => TIMEZONE_NAMES[zone]}
                  suggested={[timeZone, "UTC"]}
                  aria-label="Fuso horário"
                />
              </Field>
            </div>
            {error ? <p className="jeff-server__error">{error}</p> : null}
          </div>
        ) : null}

        {step === 1 ? (
          <div className="jeff-wizard__form">
            <div className="jeff-step__activities">
              {ACTIVITIES.map((item) => (
                <Button
                  key={item.value}
                  size="sm"
                  icon={item.icon}
                  variant={activity === item.value ? "primary" : "default"}
                  onClick={() => setActivity(item.value)}
                >
                  {item.value}
                </Button>
              ))}
            </div>
            <Field
              label="Em uma frase"
              hint={{
                name: "Sobre esta frase",
                text: "Um resumo do que o time faz. Os agentes leem isso para entender o contexto do workspace.",
              }}
            >
              <Input
                placeholder="Ex.: criamos sites e apps para pequenos negócios."
                value={objective}
                onChange={(event) => setObjective(event.target.value)}
              />
            </Field>
            {error ? <p className="jeff-server__error">{error}</p> : null}
          </div>
        ) : null}

        {step === 2 ? (
          <FormStack>
            <Field label="Seu nome">
              <Input
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                autoFocus
              />
            </Field>
            <div className="jeff-profile-choice">
              <span className="jeff-profile-choice__preview">
                {profileKind === "photo" && profilePhoto ? (
                  <img src={profilePhoto} alt="" draggable={false} />
                ) : profileKind === "person" && profileRecipe ? (
                  <JeffProfilePortrait recipe={profileRecipe} />
                ) : (
                  <span className="jeff-profile-choice__initials">{firstName.charAt(0).toUpperCase()}</span>
                )}
              </span>
              <div className="jeff-profile-choice__copy">
                <strong>Seu avatar</strong>
                <p>Crie um avatar ou envie uma foto para o seu perfil.</p>
                <div className="jeff-profile-choice__actions">
                  <Button
                    variant="default"
                    size="sm"
                    icon="smile"
                    onClick={() => setAvatarOpen(true)}
                  >
                    Criar avatar
                  </Button>
                  <Button
                    variant="default"
                    size="sm"
                    icon="image"
                    onClick={() => setPhotoOpen(true)}
                  >
                    Enviar foto
                  </Button>
                  {profileKind !== "initials" ? (
                    <Button
                      variant="link"
                      onClick={() => setProfileKind("initials")}
                    >
                      Usar iniciais
                    </Button>
                  ) : null}
                </div>
              </div>
            </div>
            {error ? <p className="jeff-server__error">{error}</p> : null}
          </FormStack>
        ) : null}

        {step === 3 ? (
          <div className="jeff-ai">
            <div className="jeff-ai__list">
              <AiOption
                pressed={aiChoice === "claude"}
                onClick={() => {
                  setAiChoice("claude");
                  setApiKeyProvider("anthropic");
                  setApiKeyOpen(true);
                }}
                logo={<ProviderLogo id="anthropic" size="tile" />}
                title="Claude"
                meta="Pro, Max, Ultra, Team ou Enterprise"
                trailing={<Icon name="chevronRight" size={16} className="jeff-ai__chev" />}
              />
              <AiOption
                pressed={aiChoice === "chatgpt"}
                onClick={() => {
                  setAiChoice("chatgpt");
                  setApiKeyProvider("openai");
                  setApiKeyOpen(true);
                }}
                logo={<ProviderLogo id="openai" size="tile" />}
                title="ChatGPT"
                meta="Plus, Pro, Business ou Enterprise"
                trailing={<Icon name="chevronRight" size={16} className="jeff-ai__chev" />}
              />
              <AiOption
                pressed={aiChoice === "other"}
                onClick={() => {
                  setAiChoice("other");
                  setApiKeyProvider("custom");
                  setApiKeyOpen(true);
                }}
                logo={
                  <span className="jeff-ai__providers" aria-hidden="true">
                    <ProviderLogo id="gemini" size="chip" />
                    <ProviderLogo id="xai" size="chip" />
                    <ProviderLogo id="cursor" size="chip" />
                    <ProviderLogo id="zai" size="chip" />
                  </span>
                }
                title="Outro plano"
                meta="Gemini, Grok, Cursor, GLM Coding, Kimi Code, MiniMax e OpenCode"
                trailing={<Icon name="chevronDown" size={16} className="jeff-ai__chev" />}
              />
              <AiOption
                pressed={aiChoice === "key"}
                onClick={() => {
                  setAiChoice("key");
                  setApiKeyProvider("anthropic");
                  setApiKeyOpen(true);
                }}
                logo={
                  <span className="jeff-ai__key">
                    <Icon name="key" size={20} />
                  </span>
                }
                title="Chave de API"
                meta="Você paga pelo uso, direto ao provedor."
                trailing={<Icon name="chevronRight" size={16} className="jeff-ai__chev" />}
              />
              <AiOption
                pressed={aiChoice === "free"}
                onClick={() => setAiChoice("free")}
                logo={<ProviderLogo id="opencode" size="tile" />}
                title="Começar grátis"
                meta="Com os modelos grátis do OpenCode"
                trailing={<span className="jeff-ai__tag">Sem assinatura</span>}
              />
            </div>
            {aiChoice ? (
              <p className="jeff-ai__note">
                A conexão com{" "}
                {aiChoice === "claude"
                  ? "Claude"
                  : aiChoice === "chatgpt"
                    ? "ChatGPT"
                    : aiChoice === "other"
                      ? "outro plano"
                      : aiChoice === "key"
                        ? "sua chave de API"
                        : "o plano grátis"}{" "}
                abre em Configurações → IA depois que você entrar.
              </p>
            ) : null}
            <p className="jeff-ai__skip">
              Sem uma IA, os agentes não respondem.{" "}
              <Button variant="link" onClick={() => setStep(4)}>
                Conectar depois
              </Button>
            </p>
            {error ? <p className="jeff-server__error">{error}</p> : null}
          </div>
        ) : null}

        {step === 4 ? (
          <div className="jeff-invite">
            <div className="jeff-invite__head">
              <span className={inviteLink ? "jeff-invite__state" : "jeff-invite__state is-empty"}>
                {inviteLink ? "Link ativo" : "Nenhum link ativo."}
              </span>
              <div className="jeff-invite__actions">
                {inviteLink ? (
                  <Button variant="ghost" size="sm" icon="copy" onClick={copyInvite}>
                    Copiar
                  </Button>
                ) : null}
                <Button
                  variant="default"
                  size="sm"
                  icon="link"
                  loading={inviteBusy}
                  onClick={() => void createInviteLink()}
                >
                  {inviteLink ? "Novo link" : "Criar link"}
                </Button>
              </div>
            </div>
            {inviteLink ? <code className="jeff-invite__link">{inviteLink}</code> : null}
            <ol className="jeff-invite__steps">
              <li>
                <span>1</span>
                <p>A pessoa abre o link e diz quem é.</p>
              </li>
              <li>
                <span>2</span>
                <p>O pedido chega para quem convida, aqui e no celular.</p>
              </li>
              <li>
                <span>3</span>
                <p>Você aprova e escolhe com que cargo a pessoa entra.</p>
              </li>
            </ol>
            {error ? <p className="jeff-server__error">{error}</p> : null}
          </div>
        ) : null}
      </WizardShell>
      <WorkspaceLogoDialog
        open={logoOpen}
        currentLogo={workspaceLogo}
        defaultLogo={`${import.meta.env.BASE_URL}brand/jeff-mark.png`}
        onClose={() => setLogoOpen(false)}
        onSave={(logo) => setWorkspaceLogo(logo)}
      />
      <ProfileAvatarDialog
        open={avatarOpen}
        current={profileRecipe}
        onClose={() => setAvatarOpen(false)}
        onPhoto={() => {
          setAvatarOpen(false);
          setPhotoOpen(true);
        }}
        onSave={(recipe) => {
          setProfileKind("person");
          setProfileRecipe(recipe);
        }}
      />
      <ProfilePhotoDialog
        open={photoOpen}
        photo={profilePhoto}
        initial={firstName.charAt(0).toUpperCase()}
        onClose={() => setPhotoOpen(false)}
        onSave={(photo) => {
          setProfileKind("photo");
          setProfilePhoto(photo);
        }}
      />
      <ApiKeyDialog
        open={apiKeyOpen}
        provider={apiKeyProvider}
        onClose={() => setApiKeyOpen(false)}
        onSaved={() => setAiChoice("key")}
      />
    </>
  );
}
