import { useEffect, useState } from "react";
import { api } from "../../shared/api";

const field =
  "w-full rounded-xl border border-border-button-default bg-background-primary-default px-3 py-2.5 text-body-2-regular text-text-primary outline-none placeholder:text-text-tertiary focus:border-accent-500";
const primaryButton =
  "w-full rounded-xl bg-accent-500 px-4 py-2 text-body-2-medium text-white disabled:opacity-40";

export default function AcceptInvite({ token }: { token: string }) {
  const [info, setInfo] = useState<{ valid: boolean; role: string } | null>(null);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api
      .inviteInfo(token)
      .then((value) => setInfo({ valid: value.valid, role: value.role }))
      .catch(() => setInfo({ valid: false, role: "" }));
  }, [token]);

  async function submit() {
    if (!username.trim() || password.length < 6) {
      setError("Usuário e senha de pelo menos 6 caracteres.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api.acceptInvite(token, {
        username: username.trim(),
        password,
        displayName: displayName.trim(),
      });
      window.location.replace("/app/");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível aceitar o convite.");
      setBusy(false);
    }
  }

  if (!info) {
    return <main className="min-h-dvh bg-background-full" />;
  }

  if (!info.valid) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-background-full p-4">
        <section className="w-full max-w-md rounded-3xl border border-border-button-white bg-background-primary-default p-6 text-center">
          <h1 className="text-title-2-medium">Convite inválido</h1>
          <p className="mt-1 text-body-2-regular text-text-secondary">
            Ele pode ter expirado ou já ter sido usado. Peça um novo link ao admin do time.
          </p>
          <a className="mt-4 inline-block text-caption-1-medium text-accent-500" href="/app/">
            ir para o login
          </a>
        </section>
      </main>
    );
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background-full p-4">
      <section className="w-full max-w-md rounded-3xl border border-border-button-white bg-background-primary-default p-6 shadow-2xl">
        <h1 className="text-title-2-medium">Entrar no time</h1>
        <p className="mt-1 text-body-2-regular text-text-secondary">
          Você foi convidado como <strong>{info.role}</strong>. Crie sua conta.
        </p>
        <div className="mt-4 space-y-2">
          <input
            className={field}
            placeholder="Usuário"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoFocus
          />
          <input
            className={field}
            placeholder="Seu nome (opcional)"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
          />
          <input
            className={field}
            type="password"
            placeholder="Senha (mínimo 6)"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void submit();
            }}
          />
        </div>
        {error ? <p className="mt-3 text-caption-1-regular text-red-500">{error}</p> : null}
        <button className={`${primaryButton} mt-4`} onClick={() => void submit()} disabled={busy}>
          {busy ? "entrando..." : "criar conta e entrar"}
        </button>
      </section>
    </main>
  );
}
