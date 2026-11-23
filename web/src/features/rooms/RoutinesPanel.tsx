import { useEffect, useState } from "react";
import { Plus, RefreshCw, Trash2, X } from "@jeff/icons";
import type { Project } from "../../shared/api";
import {
  roomsApi,
  type Principal,
  type Room,
  type Routine,
  type RoutineRun,
  type Schedule,
} from "./api";

const field =
  "w-full rounded-lg border border-border-button-default bg-background-primary-default px-3 py-2 text-body-2-regular text-text-primary outline-none placeholder:text-text-tertiary focus:border-accent-500";
const quietButton =
  "inline-flex items-center gap-1 rounded-lg px-2 py-1 text-caption-1-medium text-text-secondary hover:bg-background-tertiary-default hover:text-text-primary";
const primaryButton =
  "inline-flex items-center gap-1 rounded-lg bg-accent-500 px-3 py-1.5 text-caption-1-medium text-white disabled:opacity-40";

const WEEKDAYS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

function describe(schedule: Schedule): string {
  switch (schedule.kind) {
    case "hourly":
      return `a cada hora, no minuto ${schedule.minute}`;
    case "daily":
      return `todo dia às ${schedule.time}`;
    case "weekdays":
      return `segunda a sexta às ${schedule.time}`;
    case "weekly":
      return `toda ${WEEKDAYS[schedule.weekday] ?? schedule.weekday} às ${schedule.time}`;
    case "monthly":
      return `todo dia ${schedule.day} às ${schedule.time}`;
    case "interval":
      return `a cada ${schedule.amount} ${
        schedule.unit === "minutes" ? "minuto(s)" : schedule.unit === "hours" ? "hora(s)" : "dia(s)"
      }`;
    case "once":
      return `uma vez em ${schedule.date} às ${schedule.time}`;
    case "custom":
      return `cron ${schedule.expression}`;
    default:
      return "agendamento avançado";
  }
}

function when(value: number | null): string {
  if (!value) return "sem próxima execução";
  return new Date(value).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

interface Props {
  project: Project;
  room: Room;
  bots: Principal[];
}

export default function RoutinesPanel({ project, room, bots }: Props) {
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [runs, setRuns] = useState<Record<string, RoutineRun[]>>({});
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [agentId, setAgentId] = useState(bots[0]?.id ?? "");
  const [name, setName] = useState("");
  const [instruction, setInstruction] = useState("");
  const [kind, setKind] = useState("daily");
  const [time, setTime] = useState("09:00");
  const [weekday, setWeekday] = useState(1);
  const [day, setDay] = useState(1);
  const [minute, setMinute] = useState(0);
  const [amount, setAmount] = useState(30);
  const [unit, setUnit] = useState<"minutes" | "hours" | "days">("minutes");
  const [date, setDate] = useState("");
  const [expression, setExpression] = useState("0 9 * * 1-5");
  const [timezone, setTimezone] = useState(
    Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  );
  const [active, setActive] = useState(true);

  async function refresh() {
    try {
      const result = await roomsApi.routines(project.id, room.id);
      setRoutines(result.routines);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível carregar as rotinas.");
    }
  }

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => {
      void refresh();
    }, 8000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, room.id]);

  function schedule(): Schedule | null {
    switch (kind) {
      case "hourly":
        return { kind: "hourly", minute: Number(minute) };
      case "daily":
        return { kind: "daily", time };
      case "weekdays":
        return { kind: "weekdays", time };
      case "weekly":
        return { kind: "weekly", weekday, time };
      case "monthly":
        return { kind: "monthly", day, time };
      case "interval":
        return { kind: "interval", amount, unit, anchorAt: Date.now() };
      case "once":
        return { kind: "once", date, time };
      case "custom":
        return { kind: "custom", expression };
      default:
        return null;
    }
  }

  async function create() {
    if (!agentId || !name.trim() || !instruction.trim()) {
      setError("Bot, nome e instrução são obrigatórios.");
      return;
    }
    const value = schedule();
    if (!value) {
      setError("Agendamento inválido.");
      return;
    }
    try {
      await roomsApi.createRoutine(project.id, room.id, {
        agentId,
        name: name.trim(),
        instruction: instruction.trim(),
        schedule: value,
        timezone,
        active,
      });
      setCreating(false);
      setName("");
      setInstruction("");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível criar a rotina.");
    }
  }

  async function toggle(routine: Routine) {
    try {
      await roomsApi.updateRoutine(project.id, routine.id, { active: !routine.active });
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível alterar a rotina.");
    }
  }

  async function remove(routine: Routine) {
    if (!window.confirm(`Apagar a rotina "${routine.name}"?`)) return;
    try {
      await roomsApi.deleteRoutine(project.id, routine.id);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível apagar a rotina.");
    }
  }

  async function test(routine: Routine) {
    try {
      await roomsApi.testRoutine(project.id, routine.id);
      const result = await roomsApi.routineRuns(project.id, routine.id);
      setRuns((current) => ({ ...current, [routine.id]: result.runs }));
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível testar a rotina.");
    }
  }

  async function history(routine: Routine) {
    if (runs[routine.id]) {
      setRuns((current) => {
        const next = { ...current };
        delete next[routine.id];
        return next;
      });
      return;
    }
    try {
      const result = await roomsApi.routineRuns(project.id, routine.id);
      setRuns((current) => ({ ...current, [routine.id]: result.runs }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível ler o histórico.");
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-separator-border px-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-body-1-medium">Rotinas</h2>
          <p className="truncate text-caption-1-regular text-text-tertiary">
            {routines.length} rotina{routines.length === 1 ? "" : "s"} em {room.name}
          </p>
        </div>
        <button
          className={primaryButton}
          onClick={() => setCreating(true)}
          disabled={bots.length === 0}
          title={bots.length === 0 ? "Adicione um bot à sala primeiro" : "Nova rotina"}
        >
          <Plus size={14} /> Nova rotina
        </button>
      </header>

      {error ? (
        <p className="border-b border-separator-border px-4 py-2 text-caption-2-regular text-red-500">
          {error}
        </p>
      ) : null}

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4">
        {routines.length === 0 ? (
          <p className="py-10 text-center text-caption-1-regular text-text-tertiary">
            Nenhuma rotina nesta sala.
          </p>
        ) : (
          routines.map((routine) => {
            const bot = bots.find((item) => item.id === routine.agentId);
            return (
              <article
                key={routine.id}
                className="rounded-xl border border-separator-border bg-background-secondary-default p-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <strong className="text-body-2-medium">{routine.name}</strong>
                  <span className="rounded-full bg-background-tertiary-default px-2 text-caption-2-regular text-text-secondary">
                    {bot?.name ?? "bot"}
                  </span>
                  <span className="text-caption-2-regular text-text-tertiary">
                    {describe(routine.trigger.schedule)}
                  </span>
                  <span className="min-w-0 flex-1" />
                  <label className="flex items-center gap-1 text-caption-2-regular text-text-secondary">
                    <input
                      type="checkbox"
                      checked={routine.active}
                      onChange={() => void toggle(routine)}
                    />
                    ativa
                  </label>
                  <button className={quietButton} onClick={() => void test(routine)}>
                    <RefreshCw size={12} /> testar
                  </button>
                  <button className={quietButton} onClick={() => void history(routine)}>
                    histórico
                  </button>
                  <button
                    className={quietButton}
                    onClick={() => void remove(routine)}
                    title="Apagar rotina"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
                <p className="mt-1 text-caption-2-regular text-text-tertiary">
                  próxima: {when(routine.trigger.nextRunAt)} · {routine.timezone}
                </p>
                <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-caption-1-regular text-text-secondary">
                  {routine.instruction}
                </p>
                {runs[routine.id] ? (
                  <div className="mt-2 space-y-1 border-t border-separator-border pt-2">
                    {runs[routine.id].length === 0 ? (
                      <p className="text-caption-2-regular text-text-tertiary">sem execuções</p>
                    ) : (
                      runs[routine.id].slice(0, 6).map((run) => (
                        <div
                          key={run.id}
                          className="flex items-center gap-2 text-caption-2-regular text-text-secondary"
                        >
                          <span className="w-20 shrink-0">{when(run.scheduledFor)}</span>
                          <span
                            className={
                              run.status === "failed"
                                ? "text-red-500"
                                : run.status === "succeeded"
                                  ? "text-green-600"
                                  : "text-text-tertiary"
                            }
                          >
                            {run.status}
                          </span>
                          <span className="min-w-0 flex-1 truncate">{run.error || run.kind}</span>
                        </div>
                      ))
                    )}
                  </div>
                ) : null}
              </article>
            );
          })
        )}
      </div>

      {creating ? (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/50 p-4">
          <section className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-border-button-white bg-background-primary-default p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-body-1-medium">Nova rotina</h3>
              <button className={quietButton} onClick={() => setCreating(false)}>
                <X size={14} />
              </button>
            </div>
            <div className="space-y-2">
              <select className={field} value={agentId} onChange={(event) => setAgentId(event.target.value)}>
                {bots.map((bot) => (
                  <option key={bot.id} value={bot.id}>
                    {bot.name}
                  </option>
                ))}
              </select>
              <input
                className={field}
                placeholder="Nome da rotina"
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoFocus
              />
              <textarea
                className={`${field} min-h-24`}
                placeholder="O que o bot deve fazer quando rodar"
                value={instruction}
                onChange={(event) => setInstruction(event.target.value)}
              />
              <div className="grid grid-cols-2 gap-2">
                <select className={field} value={kind} onChange={(event) => setKind(event.target.value)}>
                  <option value="hourly">A cada hora</option>
                  <option value="daily">Todo dia</option>
                  <option value="weekdays">Dias úteis</option>
                  <option value="weekly">Toda semana</option>
                  <option value="monthly">Todo mês</option>
                  <option value="interval">Intervalo</option>
                  <option value="once">Uma vez</option>
                  <option value="custom">Cron</option>
                </select>
                {kind === "hourly" ? (
                  <input
                    type="number"
                    min={0}
                    max={59}
                    className={field}
                    value={minute}
                    onChange={(event) => setMinute(Number(event.target.value))}
                    placeholder="Minuto"
                  />
                ) : kind === "weekly" ? (
                  <select
                    className={field}
                    value={weekday}
                    onChange={(event) => setWeekday(Number(event.target.value))}
                  >
                    {WEEKDAYS.map((label, index) => (
                      <option key={label} value={index}>
                        {label}
                      </option>
                    ))}
                  </select>
                ) : kind === "monthly" ? (
                  <input
                    type="number"
                    min={1}
                    max={31}
                    className={field}
                    value={day}
                    onChange={(event) => setDay(Number(event.target.value))}
                    placeholder="Dia"
                  />
                ) : kind === "interval" ? (
                  <div className="flex gap-1">
                    <input
                      type="number"
                      min={1}
                      className={field}
                      value={amount}
                      onChange={(event) => setAmount(Number(event.target.value))}
                    />
                    <select
                      className={field}
                      value={unit}
                      onChange={(event) =>
                        setUnit(event.target.value as "minutes" | "hours" | "days")
                      }
                    >
                      <option value="minutes">min</option>
                      <option value="hours">horas</option>
                      <option value="days">dias</option>
                    </select>
                  </div>
                ) : kind === "once" ? (
                  <input
                    type="date"
                    className={field}
                    value={date}
                    onChange={(event) => setDate(event.target.value)}
                  />
                ) : kind === "custom" ? (
                  <input
                    className={field}
                    value={expression}
                    onChange={(event) => setExpression(event.target.value)}
                    placeholder="0 9 * * 1-5"
                  />
                ) : (
                  <input
                    type="time"
                    className={field}
                    value={time}
                    onChange={(event) => setTime(event.target.value)}
                  />
                )}
              </div>
              {kind === "weekly" || kind === "monthly" || kind === "once" ? (
                <input
                  type="time"
                  className={field}
                  value={time}
                  onChange={(event) => setTime(event.target.value)}
                />
              ) : null}
              <input
                className={field}
                value={timezone}
                onChange={(event) => setTimezone(event.target.value)}
                placeholder="Fuso IANA, ex.: America/Sao_Paulo"
              />
              <label className="flex items-center gap-2 text-caption-1-regular text-text-secondary">
                <input
                  type="checkbox"
                  checked={active}
                  onChange={(event) => setActive(event.target.checked)}
                />
                ativa
              </label>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button className={quietButton} onClick={() => setCreating(false)}>
                Cancelar
              </button>
              <button className={primaryButton} onClick={() => void create()}>
                Criar rotina
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
