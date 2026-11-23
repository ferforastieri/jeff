import { useEffect, useState } from "react";
import { Check, Copy, Plus, X } from "@jeff/icons";
import { api, type OnboardingStatus, type Project } from "../../shared/api";

const field =
  "w-full rounded-xl border border-border-button-default bg-background-primary-default px-3 py-2.5 text-body-2-regular text-text-primary outline-none placeholder:text-text-tertiary focus:border-accent-500";
const primaryButton =
  "inline-flex items-center justify-center gap-1 rounded-xl bg-accent-500 px-4 py-2 text-body-2-medium text-white disabled:opacity-40";
const ghostButton =
  "inline-flex items-center justify-center gap-1 rounded-xl px-4 py-2 text-body-2-medium text-text-secondary hover:bg-background-tertiary-default";

const ACTIVITIES = ["dev", "estudo", "pesquisa", "trabalho", "pessoal", "outro"];

interface Props {
  status: OnboardingStatus;
  onDone: () => void;
}

export default function Onboarding({ status, onDone }: Props) {
  const [step, setStep] = useState(0);
  const [mode, setMode] = useState<"solo" | "team">(
    status.mode === "team" ? "team" : "solo",
  );
  const [activity, setActivity] = useState(status.activity || "dev");
  const [objective, setObjective] = useState(status.objective);
  const [tools, setTools] = useState(status.tools);
  const [agentName, setAgentName] = useState("");
  const [teamName, setTeamName] = useState(status.teamName);
  const [projectId, setProjectId] = useState(status.projectId);
  const [projects, setProjects] = useState<Project[]>([]);
  const [creatingProject, setCreatingProject] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [projectRoot, setProjectRoot] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ invite: string | null } | null>(null);

  useEffect(() => {
    void api
      .projects()
      .then((items) => {
        setProjects(items);
        if (!projectId && items.length > 0) setProjectId(items[0].id);
      })
      .catch(() => undefined);
  }, [projectId]);

  const steps = mode === "team" ? 5 : 4;
  const last = step === steps - 1;

  function next() {
    setError("");
    if (step === 1 && !activity) {
      setError("Escolha a atividade.");
      return;
    }
    if (step === 2 && !agentName.trim()) {
      setError("Dê um nome ao agente de configuração.");
      return;
    }
    if (step === 3 && !projectId) {
      setError("Escolha ou crie um projeto.");
      return;
    }
    if (last) {
      void finish();
      return;
    }
    setStep((value) => value + 1);
  }

  async function createProject() {
    if (!projectName.trim() || !projectRoot.trim()) {
      setError("Informe nome e pasta do projeto.");
      return;
    }
    try {
      const created = await api.createProject(projectName.trim(), projectRoot.trim(), "#0063D1");
      setProjects((current) => [...current, created]);
      setProjectId(created.id);
      setCreatingProject(false);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível criar o projeto.");
    }
  }

  async function finish() {
    setBusy(true);
    setError("");
    try {
      const done = await api.completeOnboarding({
        mode,
        activity,
        objective,
        tools,
        agentName: agentName.trim(),
        projectId,
        teamName: mode === "team" ? teamName.trim() : "",
      });
      const invite = done.invite
        ? `${window.location.origin}/app/?invite=${encodeURIComponent(done.invite.token)}`
        : null;
      setResult({ invite });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível concluir.");
    } finally {
      setBusy(false);
    }
  }

  if (!status.isAdmin) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-background-full p-4">
        <section className="w-full max-w-md rounded-3xl border border-border-button-white bg-background-primary-default p-6 text-center">
          <h1 className="text-title-2-medium">Quase lá</h1>
          <p className="mt-1 text-body-2-regular text-text-secondary">
            O admin do time ainda está configurando o workspace. Assim que ele concluir, você entra
            direto nas salas.
          </p>
          <button
            className={`${primaryButton} mt-4`}
            onClick={() => window.location.reload()}
          >
            verificar de novo
          </button>
        </section>
      </main>
    );
  }

  if (result) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-background-full p-4">
        <section className="w-full max-w-lg rounded-3xl border border-border-button-white bg-background-primary-default p-6 shadow-2xl">
          <div className="mb-2 flex size-10 items-center justify-center rounded-full bg-status-lime-text/15 text-status-lime-text">
            <Check size={20} />
          </div>
          <h1 className="text-title-2-medium">Tudo pronto</h1>
          <p className="mt-1 text-body-2-regular text-text-secondary">
            O workspace está configurado. Seu agente de configuração espera por você na conversa
            direta.
          </p>
          {result.invite ? (
            <div className="mt-4 rounded-xl border border-border-button-default p-3">
              <p className="text-caption-1-regular text-text-secondary">
                Link de convite do time (expira em 30 dias):
              </p>
              <div className="mt-1 flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate text-caption-2-regular text-text-tertiary">
                  {result.invite}
                </code>
                <button
                  className={ghostButton}
                  onClick={() => void navigator.clipboard?.writeText(result.invite ?? "")}
                >
                  <Copy size={14} /> copiar
                </button>
              </div>
            </div>
          ) : null}
          <button className={`${primaryButton} mt-5 w-full`} onClick={onDone}>
            Entrar no Jeff
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background-full p-4">
      <section className="w-full max-w-lg rounded-3xl border border-border-button-white bg-background-primary-default p-6 shadow-2xl">
        <div className="mb-4 flex items-center gap-1.5">
          {Array.from({ length: steps }).map((_, index) => (
            <span
              key={index}
              className={`h-1 flex-1 rounded-full ${
                index <= step ? "bg-accent-500" : "bg-background-tertiary-default"
              }`}
            />
          ))}
        </div>

        {step === 0 ? (
          <>
            <h1 className="text-title-2-medium">Como você vai usar o Jeff?</h1>
            <p className="mt-1 text-body-2-regular text-text-secondary">
              Isso define o workspace inicial. Dá para mudar depois.
            </p>
            <div className="mt-4 grid gap-2">
              {(
                [
                  ["solo", "Para mim", "Um workspace seu, com o agente que ajuda a configurar tudo."],
                  ["team", "Para um time", "Contas de verdade, convite por link e papéis."],
                ] as const
              ).map(([value, title, description]) => (
                <button
                  key={value}
                  className={`rounded-2xl border p-4 text-left transition-colors ${
                    mode === value
                      ? "border-accent-500 bg-accent-500/10"
                      : "border-border-button-default hover:bg-background-tertiary-default"
                  }`}
                  onClick={() => setMode(value)}
                >
                  <span className="block text-body-1-medium">{title}</span>
                  <span className="mt-0.5 block text-caption-1-regular text-text-tertiary">
                    {description}
                  </span>
                </button>
              ))}
            </div>
          </>
        ) : null}

        {step === 1 ? (
          <>
            <h1 className="text-title-2-medium">O que você faz?</h1>
            <p className="mt-1 text-body-2-regular text-text-secondary">
              Isso calibra o agente de configuração.
            </p>
            <div className="mt-4 flex flex-wrap gap-1.5">
              {ACTIVITIES.map((item) => (
                <button
                  key={item}
                  className={`rounded-full px-3 py-1.5 text-caption-1-medium ${
                    activity === item
                      ? "bg-accent-500 text-white"
                      : "bg-background-tertiary-default text-text-secondary"
                  }`}
                  onClick={() => setActivity(item)}
                >
                  {item}
                </button>
              ))}
            </div>
            <div className="mt-4 space-y-2">
              <textarea
                className={`${field} min-h-20`}
                placeholder="Qual é o objetivo principal? Ex.: entregar o app até dezembro."
                value={objective}
                onChange={(event) => setObjective(event.target.value)}
              />
              <input
                className={field}
                placeholder="Ferramentas que já usa (opcional)"
                value={tools}
                onChange={(event) => setTools(event.target.value)}
              />
            </div>
          </>
        ) : null}

        {step === 2 ? (
          <>
            <h1 className="text-title-2-medium">Nome do agente principal</h1>
            <p className="mt-1 text-body-2-regular text-text-secondary">
              Ele é fixo e ajuda a configurar o Jeff pela conversa direta.
            </p>
            <input
              className={`${field} mt-4`}
              placeholder="Ex.: Nico"
              value={agentName}
              onChange={(event) => setAgentName(event.target.value)}
              autoFocus
            />
          </>
        ) : null}

        {step === 3 ? (
          <>
            <h1 className="text-title-2-medium">Projeto inicial</h1>
            <p className="mt-1 text-body-2-regular text-text-secondary">
              Um projeto pode ser um repositório ou apenas uma pasta.
            </p>
            <div className="mt-4 space-y-2">
              {projects.map((project) => (
                <button
                  key={project.id}
                  className={`w-full rounded-xl border p-3 text-left ${
                    projectId === project.id
                      ? "border-accent-500 bg-accent-500/10"
                      : "border-border-button-default"
                  }`}
                  onClick={() => setProjectId(project.id)}
                >
                  <span className="block text-body-2-medium">{project.name}</span>
                  <span className="block truncate text-caption-2-regular text-text-tertiary">
                    {project.root}
                  </span>
                </button>
              ))}
              {creatingProject ? (
                <div className="space-y-2 rounded-xl border border-border-button-default p-3">
                  <input
                    className={field}
                    placeholder="Nome do projeto"
                    value={projectName}
                    onChange={(event) => setProjectName(event.target.value)}
                  />
                  <input
                    className={field}
                    placeholder="Pasta, ex.: /work/repos/meu-projeto"
                    value={projectRoot}
                    onChange={(event) => setProjectRoot(event.target.value)}
                  />
                  <div className="flex justify-end gap-2">
                    <button className={ghostButton} onClick={() => setCreatingProject(false)}>
                      <X size={14} /> cancelar
                    </button>
                    <button className={primaryButton} onClick={() => void createProject()}>
                      criar
                    </button>
                  </div>
                </div>
              ) : (
                <button className={ghostButton} onClick={() => setCreatingProject(true)}>
                  <Plus size={14} /> criar outro projeto
                </button>
              )}
            </div>
          </>
        ) : null}

        {step === 4 && mode === "team" ? (
          <>
            <h1 className="text-title-2-medium">Nome do time</h1>
            <p className="mt-1 text-body-2-regular text-text-secondary">
              O link de convite aparece no fim. Você define quem vê cada projeto.
            </p>
            <input
              className={`${field} mt-4`}
              placeholder="Ex.: Studio"
              value={teamName}
              onChange={(event) => setTeamName(event.target.value)}
              autoFocus
            />
          </>
        ) : null}

        {error ? <p className="mt-3 text-caption-1-regular text-red-500">{error}</p> : null}

        <div className="mt-6 flex items-center justify-between gap-2">
          <button
            className={ghostButton}
            onClick={() => setStep((value) => Math.max(0, value - 1))}
            disabled={step === 0 || busy}
          >
            voltar
          </button>
          <button className={primaryButton} onClick={next} disabled={busy}>
            {last ? (busy ? "criando..." : "concluir") : "continuar"}
          </button>
        </div>
      </section>
    </main>
  );
}
