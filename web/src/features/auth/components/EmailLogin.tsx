import { useState, type FormEvent } from "react";
import { Button } from "faang-ui/components/Button";
import { Field, FormStack, Input } from "faang-ui/components/Field";
import { Select } from "faang-ui/components/Select";
import { EventPill, EventPillAction } from "faang-ui/components/EventPill";
import { Icon } from "faang-ui/icons/Icon";
import { api, ApiError, probeServer } from "../../../shared/api";
import { useApp } from "../../../app/store";
import { BubbleCard, ServerSwitchModal } from "@jeff/ui/kit";
import { JeffSky } from "@jeff/ui/kit";

type Step = "email" | "name" | "password";

interface Props {
  onConnected?: (url: string) => void;
  onOpenLauncher?: () => void;
}

export default function EmailLogin({ onConnected, onOpenLauncher }: Props) {
  const setUser = useApp((state) => state.setUser);
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [switching, setSwitching] = useState(false);
  const logoSrc = `${import.meta.env.BASE_URL}brand/jeff-logo-horizontal.png`;
  const jeffSrc = (name: string) => `${import.meta.env.BASE_URL}jeffs/${name}.png`;
  const firstName = name.trim().split(/\s+/)[0] || "você";
  const passwordStrength = Math.min(7, Math.ceil((password.length / 8) * 7));

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (step === "email") {
      if (!email.trim()) return;
      setBusy(true);
      try {
        const status = await api.emailStatus(email.trim());
        if (status.exists) {
          const result = await api.loginWithEmail(email.trim());
          setUser(result.user);
          return;
        }
        setStep("name");
      } catch (cause) {
        setError(
          cause instanceof ApiError
            ? cause.status === 429
              ? "Muitas tentativas. Aguarde um minuto."
              : cause.message
            : "Não foi possível verificar o e-mail.",
        );
      } finally {
        setBusy(false);
      }
      return;
    }
    if (step === "name") {
      if (!name.trim()) {
        setError("Informe seu nome.");
        return;
      }
      setStep("password");
      return;
    }
    if (password.length < 8) {
      setError("A senha precisa ter pelo menos 8 caracteres.");
      return;
    }
    setBusy(true);
    try {
      const result = await api.registerWithEmail(email.trim(), name.trim(), password);
      setUser(result.user);
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.status === 429
            ? "Muitas tentativas. Aguarde um minuto."
            : cause.message
          : "Não foi possível criar a conta.",
      );
    } finally {
      setBusy(false);
    }
  }

  const question =
    step === "email"
      ? "Vamos criar sua conta. Qual é o seu e-mail de trabalho?"
      : step === "name"
        ? "Prazer. Esse e-mail é novo por aqui."
        : `Boa, ${firstName}. Agora uma senha.`;
  const hint = step === "name" ? "Como o time te chama?" : "";

  const emailPill =
    step !== "email" ? (
      <EventPill
        mark={<Icon name="mail" size={14} />}
        actions={
          <EventPillAction
            onClick={() => {
              setStep("email");
              setError("");
            }}
          >
            Trocar
          </EventPillAction>
        }
      >
        {email.trim()}
      </EventPill>
    ) : null;

  return (
    <>
      <main className="jeff-welcome">
        <h1 className="jeff-welcome__sr">Jeff</h1>
        <header className="jeff-welcome__header">
          <img src={logoSrc} alt="Jeff" className="jeff-welcome__logo" draggable={false} />
          <Select
            aria-label="Idioma"
            value="pt-BR"
            onValueChange={() => undefined}
            size="sm"
            options={[{ value: "pt-BR", label: "Português (Brasil)" }]}
          />
        </header>

        <section className="jeff-welcome__main">
          <div className="jeff-welcome__panel">
            <BubbleCard avatarSrc={jeffSrc("jeff-01-blue")} title={question} hint={hint || undefined} />

            <form onSubmit={submit} noValidate>
              <FormStack>
                {emailPill}
                {step === "email" ? (
                  <Field label="E-mail de trabalho">
                    <Input
                      type="email"
                      inputMode="email"
                      autoComplete="email"
                      placeholder="voce@empresa.com"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      autoFocus
                    />
                  </Field>
                ) : null}

                {step === "name" ? (
                  <Field label={<span className="ac-visually-hidden">Seu nome</span>}>
                    <Input
                      placeholder="Seu nome"
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      autoFocus
                    />
                  </Field>
                ) : null}

                {step === "password" ? (
                  <div className="jeff-password">
                    <Field
                      label={<span className="ac-visually-hidden">Senha</span>}
                      example={
                        <span className="jeff-password__strength">
                          <span className="jeff-password__bars" aria-hidden="true">
                            {Array.from({ length: 7 }).map((_, index) => (
                              <span key={index} className={index < passwordStrength ? "is-on" : ""} />
                            ))}
                          </span>
                          <span>Pelo menos 8 caracteres.</span>
                        </span>
                      }
                    >
                      <Input
                        type={showPassword ? "text" : "password"}
                        autoComplete="new-password"
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        autoFocus
                      />
                    </Field>
                    <Button
                      variant="link"
                      className="jeff-password__eye"
                      aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                      onClick={() => setShowPassword((value) => !value)}
                    >
                      <Icon name={showPassword ? "eyeOff" : "eye"} size={16} />
                    </Button>
                  </div>
                ) : null}

                {error ? <p className="jeff-server__error">{error}</p> : null}

                <Button
                  type="submit"
                  variant="primary"
                  size="sm"
                  block
                  loading={busy}
                  disabled={
                    (step === "email" && !email.trim()) ||
                    (step === "name" && !name.trim()) ||
                    (step === "password" && password.length < 8)
                  }
                >
                  {step === "password" ? "Criar conta" : "Continuar"}
                  {step !== "password" ? <Icon name="arrowRight" size={16} /> : null}
                </Button>
              </FormStack>
            </form>

            <div className="jeff-welcome__domain">
              <Icon name="globe" size={14} />
              <span>
                Entrando em <span className="jeff-welcome__domain-host">{window.location.host}</span>
              </span>
              {onConnected ? (
                <>
                  <span className="jeff-welcome__domain-dot">·</span>
                  <Button variant="link" onClick={() => setSwitching(true)}>
                    Trocar
                  </Button>
                </>
              ) : null}
            </div>

            {onOpenLauncher ? (
              <Button variant="link" onClick={onOpenLauncher}>
                Voltar ao launcher
              </Button>
            ) : null}
          </div>
        </section>

        <JeffSky srcFor={jeffSrc} />
      </main>

      {onConnected ? (
        <ServerSwitchModal
          open={switching}
          currentUrl={window.location.origin}
          srcFor={jeffSrc}
          onClose={() => setSwitching(false)}
          onConnect={async (url) => {
            const base = await probeServer(url);
            onConnected(base);
          }}
        />
      ) : null}
    </>
  );
}
