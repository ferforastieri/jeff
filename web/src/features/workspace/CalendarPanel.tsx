import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  Button,
  Card,
  Chip,
  DatePicker,
  Dialog,
  DialogBody,
  DialogFooter,
  Field,
  FilterToggle,
  Icon,
  Input,
  Kbd,
  ListRow,
  PageHeader,
  Popover,
  Segmented,
  Select,
  Textarea,
  TimeSelect,
} from "faang-ui";
import { type Project } from "../../shared/api";
import {
  roomsApi,
  type Card as TaskCard,
  type Principal,
  type Room,
  type Routine,
  type Schedule,
} from "../rooms/api";
import { formatDate, formatTime } from "../../shared/time";
import BotAvatar from "../agents/components/BotAvatar";

const WEEKDAYS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
const EVENT_COLORS = ["#3B82F6", "#F59E0B", "#10B981", "#8B5CF6", "#06B6D4", "#EC4899"];
const PER_DAY = 3;
const HOUR_START = 7;
const HOUR_END = 21;

type Frequency = "daily" | "weekdays" | "weekly" | "monthly" | "once";
type ViewMode = "day" | "week" | "month" | "agenda";

interface CalEvent {
  key: string;
  kind: "routine" | "deadline";
  title: string;
  date: Date;
  time: string;
  agent?: Principal;
  room?: Room;
  routine?: Routine;
  card?: TaskCard;
}

function startOfDay(date: Date): Date {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addDays(date: Date, amount: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

function addMonths(date: Date, amount: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1);
}

function ymd(date: Date): string {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function monthGrid(first: Date): Date[] {
  const start = new Date(first);
  start.setDate(1 - start.getDay());
  return Array.from({ length: 42 }, (_, index) => addDays(start, index));
}

function weekStart(date: Date): Date {
  const start = startOfDay(date);
  start.setDate(start.getDate() - start.getDay());
  return start;
}

function viewDays(view: ViewMode, focus: Date): Date[] {
  if (view === "day") return [startOfDay(focus)];
  if (view === "week") {
    const start = weekStart(focus);
    return Array.from({ length: 7 }, (_, index) => addDays(start, index));
  }
  if (view === "agenda") return Array.from({ length: 30 }, (_, index) => addDays(startOfDay(new Date()), index));
  return monthGrid(startOfMonth(focus));
}

function timeOf(schedule: Schedule): string {
  if (schedule.kind === "hourly") return `${String(schedule.minute).padStart(2, "0")} min`;
  if (schedule.kind === "interval") return "a cada " + schedule.amount + " " + schedule.unit;
  if (schedule.kind === "custom" || schedule.kind === "advanced") return "agenda própria";
  return schedule.time;
}

function occursOn(schedule: Schedule, day: Date): boolean {
  switch (schedule.kind) {
    case "daily":
      return true;
    case "weekdays":
      return day.getDay() >= 1 && day.getDay() <= 5;
    case "weekly":
      return day.getDay() === schedule.weekday;
    case "monthly":
      return day.getDate() === schedule.day;
    case "once":
      return ymd(day) === schedule.date;
    default:
      return false;
  }
}

function scheduleText(schedule: Schedule): string {
  switch (schedule.kind) {
    case "daily":
      return `Todo dia às ${schedule.time}`;
    case "weekdays":
      return `Dias úteis às ${schedule.time}`;
    case "weekly":
      return `${WEEKDAYS[schedule.weekday] ?? "Toda semana"}, ${schedule.time}`;
    case "monthly":
      return `Todo dia ${schedule.day} às ${schedule.time}`;
    case "once":
      return `${formatDate(new Date(`${schedule.date}T12:00:00`))} às ${schedule.time}`;
    case "hourly":
      return `A cada hora, aos ${String(schedule.minute).padStart(2, "0")} min`;
    case "interval":
      return `A cada ${schedule.amount} ${schedule.unit}`;
    case "custom":
      return schedule.expression;
    case "advanced":
      return "Agenda avançada";
  }
}

function nextRunText(routine: Routine): string {
  const at = routine.trigger.nextRunAt;
  if (!at) return "sem próxima execução";
  return `${formatDate(at)} · ${formatTime(at)}`;
}

function agentColor(id: string): string {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) hash = (hash * 31 + id.charCodeAt(index)) >>> 0;
  return EVENT_COLORS[hash % EVENT_COLORS.length] as string;
}

function minutesOf(time: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function monthName(date: Date): string {
  const value = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" }).format(date);
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function rangeLabel(view: ViewMode, focus: Date, days: Date[]): string {
  if (view === "month") return monthName(focus);
  if (view === "day") return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "long", year: "numeric" }).format(focus);
  if (view === "agenda") return "Próximos 30 dias";
  const first = days[0] ?? focus;
  const last = days[6] ?? focus;
  const start = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" }).format(first).replace(".", "");
  const end = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "long", year: "numeric" }).format(last);
  return `${start} – ${end}`;
}

interface Props {
  project: Project;
  rooms: Room[];
  bots: Principal[];
  people: Principal[];
  selectedRoomId: string;
}

/** Calendário: views, mini month, upcomings, filters, routines and deadlines. */
export default function CalendarPanel({ project, rooms, bots, people, selectedRoomId }: Props) {
  const [view, setView] = useState<ViewMode>(() => (typeof window !== "undefined" && window.matchMedia("(max-width: 900px)").matches ? "agenda" : "month"));
  const [focus, setFocus] = useState(() => startOfDay(new Date()));
  const [panel, setPanel] = useState(() => !(typeof window !== "undefined" && window.matchMedia("(max-width: 900px)").matches));
  const [sources, setSources] = useState({ routine: true, deadline: true });
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [cards, setCards] = useState<TaskCard[]>([]);
  const [selected, setSelected] = useState<CalEvent | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [name, setName] = useState("");
  const [instruction, setInstruction] = useState("");
  const [agentId, setAgentId] = useState("");
  const [roomId, setRoomId] = useState("");
  const [frequency, setFrequency] = useState<Frequency>("daily");
  const [time, setTime] = useState("09:00");
  const [weekday, setWeekday] = useState("1");
  const [day, setDay] = useState("1");
  const [date, setDate] = useState(() => ymd(new Date()));

  const channels = rooms.filter((room) => room.kind === "room");
  const today = startOfDay(new Date());

  async function refresh() {
    if (!project.id) return;
    try {
      const [routineList, cardList] = await Promise.all([
        roomsApi.projectRoutines(project.id),
        roomsApi.cards(project.id),
      ]);
      setRoutines(routineList.routines);
      setCards(cardList.cards);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível carregar o calendário.");
    }
  }

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const el = event.target instanceof Element ? event.target : null;
      if (el?.closest("input, textarea, [contenteditable], [role=dialog], [role=menu], [role=listbox]")) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key.toLowerCase() === "n") {
        event.preventDefault();
        openCreate();
      } else if (event.key.toLowerCase() === "t") {
        event.preventDefault();
        setFocus(startOfDay(new Date()));
      } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        step(event.key === "ArrowLeft" ? -1 : 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, focus]);

  const days = useMemo(() => viewDays(view, focus), [view, focus]);
  const dayKeys = useMemo(() => new Set(days.map(ymd)), [days]);

  const events = useMemo(() => {
    const list: CalEvent[] = [];
    for (const routine of routines) {
      const room = rooms.find((item) => item.id === routine.roomId);
      const agent = people.find((person) => person.id === routine.agentId);
      const schedule = routine.trigger.schedule;
      if (
        schedule.kind === "interval" ||
        schedule.kind === "custom" ||
        schedule.kind === "advanced" ||
        schedule.kind === "hourly"
      ) {
        if (!routine.trigger.nextRunAt) continue;
        const at = new Date(routine.trigger.nextRunAt);
        if (!dayKeys.has(ymd(at))) continue;
        list.push({
          key: `${routine.id}:next`,
          kind: "routine",
          title: routine.name,
          date: at,
          time: formatTime(at),
          agent,
          room,
          routine,
        });
        continue;
      }
      for (const day of days) {
        if (!occursOn(schedule, day)) continue;
        list.push({
          key: `${routine.id}:${ymd(day)}`,
          kind: "routine",
          title: routine.name,
          date: day,
          time: timeOf(schedule),
          agent,
          room,
          routine,
        });
      }
    }
    for (const card of cards) {
      if (!card.dueAt || card.column === "done") continue;
      const at = new Date(card.dueAt);
      if (!dayKeys.has(ymd(at))) continue;
      list.push({
        key: `card:${card.id}`,
        kind: "deadline",
        title: card.title,
        date: at,
        time: "prazo",
        card,
      });
    }
    return list.sort((a, b) => a.date.getTime() - b.date.getTime() || a.time.localeCompare(b.time));
  }, [cards, dayKeys, days, people, rooms, routines]);

  const shown = events.filter((event) => (event.kind === "routine" ? sources.routine : sources.deadline));
  const activeRoutines = routines.filter((routine) => routine.active);
  const upcoming = useMemo(() => {
    const now = Date.now();
    const list: CalEvent[] = [];
    for (const routine of activeRoutines) {
      if (!routine.trigger.nextRunAt || routine.trigger.nextRunAt < now) continue;
      const agent = people.find((person) => person.id === routine.agentId);
      const room = rooms.find((item) => item.id === routine.roomId);
      const at = new Date(routine.trigger.nextRunAt);
      list.push({ key: `up:${routine.id}`, kind: "routine", title: routine.name, date: at, time: formatTime(at), agent, room, routine });
    }
    for (const card of cards) {
      if (!card.dueAt || card.column === "done" || card.dueAt < now) continue;
      const at = new Date(card.dueAt);
      list.push({ key: `up:card:${card.id}`, kind: "deadline", title: card.title, date: at, time: "prazo", card });
    }
    return list.sort((a, b) => a.date.getTime() - b.date.getTime()).slice(0, 6);
  }, [activeRoutines, cards, people, rooms]);

  const busyDays = useMemo(() => new Set(events.map((event) => ymd(event.date))), [events]);
  const label = rangeLabel(view, focus, days);

  function step(direction: -1 | 1) {
    if (view === "day") setFocus((current) => addDays(current, direction));
    else if (view === "week") setFocus((current) => addDays(current, 7 * direction));
    else if (view === "month") setFocus((current) => addMonths(current, direction));
    else setFocus((current) => addDays(current, 30 * direction));
  }

  function openCreate() {
    setError("");
    setName("");
    setInstruction("");
    setAgentId(bots[0]?.id ?? "");
    setRoomId(selectedRoomId || channels[0]?.id || "");
    setFrequency("daily");
    setTime("09:00");
    setWeekday("1");
    setDay("1");
    setDate(ymd(new Date()));
    setCreating(true);
  }

  async function create() {
    if (!name.trim() || !instruction.trim()) {
      setError("Dê um nome e as instruções da rotina.");
      return;
    }
    if (!agentId || !roomId) {
      setError("Escolha o agente e o canal da rotina.");
      return;
    }
    let schedule: Schedule;
    switch (frequency) {
      case "weekdays":
        schedule = { kind: "weekdays", time };
        break;
      case "weekly":
        schedule = { kind: "weekly", weekday: Number(weekday), time };
        break;
      case "monthly":
        schedule = { kind: "monthly", day: Math.max(1, Math.min(28, Number(day))), time };
        break;
      case "once":
        schedule = { kind: "once", date, time };
        break;
      default:
        schedule = { kind: "daily", time };
    }
    setBusy(true);
    setError("");
    try {
      await roomsApi.createRoutine(project.id, roomId, {
        agentId,
        name: name.trim(),
        instruction: instruction.trim(),
        schedule,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        active: true,
      });
      setCreating(false);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível criar a rotina.");
    } finally {
      setBusy(false);
    }
  }

  const filters = (
    <div className="ws-cal-filters">
      <FilterToggle
        pressed={sources.routine}
        onPressedChange={(pressed) => setSources((current) => ({ ...current, routine: pressed }))}
        icon="routines"
        count={events.filter((event) => event.kind === "routine").length}
      >
        Rotinas
      </FilterToggle>
      <FilterToggle
        pressed={sources.deadline}
        onPressedChange={(pressed) => setSources((current) => ({ ...current, deadline: pressed }))}
        icon="issues"
        count={events.filter((event) => event.kind === "deadline").length}
      >
        Prazos
      </FilterToggle>
    </div>
  );

  return (
    <div className="ws-calendar-page">
      <PageHeader
        title="Calendário"
        meta={label}
        metaLive
        actions={
          <>
            <Button
              variant="ghost"
              iconOnly
              icon="sidebar"
              aria-label={panel ? "Ocultar painel" : "Mostrar painel"}
              aria-expanded={panel}
              onClick={() => setPanel((value) => !value)}
            />
            <Button variant="primary" icon="plus" onClick={openCreate}>
              Nova rotina
              <Kbd aria-hidden="true">N</Kbd>
            </Button>
          </>
        }
      >
        <div className="cal-page__tools">
          <div className="cal-nav" role="group" aria-label="Navegação do calendário">
            <Button
              size="sm"
              variant="ghost"
              iconOnly
              icon="chevronLeft"
              aria-label="Anterior"
              onClick={() => step(-1)}
            />
            <Button size="sm" variant="ghost" onClick={() => setFocus(startOfDay(new Date()))}>
              Hoje
            </Button>
            <Button
              size="sm"
              variant="ghost"
              iconOnly
              icon="chevronRight"
              aria-label="Próximo"
              onClick={() => step(1)}
            />
          </div>
          <Segmented<ViewMode>
            label="Visão do calendário"
            size="sm"
            value={view}
            onValueChange={setView}
            options={[
              { value: "day", label: "Dia" },
              { value: "week", label: "Semana" },
              { value: "month", label: "Mês" },
              { value: "agenda", label: "Agenda" },
            ]}
          />
        </div>
        {!panel ? (
          <Popover
            label="Filtros"
            side="bottom"
            align="end"
            trigger={
              <Button size="sm" variant="ghost" icon="filter">
                Filtros
              </Button>
            }
          >
            {filters}
          </Popover>
        ) : null}
      </PageHeader>

      {error ? <p className="ws-error">{error}</p> : null}

      <div className={panel ? "ws-calendar-layout" : "ws-calendar-layout is-panel-closed"}>
        <div className="ws-calendar-main">
          {view === "month" ? (
            <Card className="ws-cal" padded={false}>
              <div className="ws-cal__head">
                {days.slice(0, 7).map((day) => (
                  <span key={day.getDay()}>
                    {new Intl.DateTimeFormat("pt-BR", { weekday: "short" }).format(day).replace(".", "")}
                  </span>
                ))}
              </div>
              <div className="ws-cal__grid">
                {monthGrid(startOfMonth(focus)).map((day) => {
                  const list = shown.filter((event) => sameDay(event.date, day));
                  const rest = list.length - PER_DAY;
                  return (
                    <div
                      key={ymd(day)}
                      className="ws-cal__cell"
                      data-other={day.getMonth() !== focus.getMonth() || undefined}
                      data-today={sameDay(day, today) || undefined}
                    >
                      <span className="ws-cal__num">{day.getDate()}</span>
                      {list.slice(0, rest > 0 ? PER_DAY : list.length).map((event) => (
                        <button
                          key={event.key}
                          type="button"
                          className="ws-cal-event"
                          data-kind={event.kind}
                          style={{ "--event": event.kind === "routine" ? agentColor(event.routine?.agentId ?? "") : "#D14343" } as CSSProperties}
                          title={`${event.time} · ${event.title}`}
                          onClick={() => setSelected(event)}
                        >
                          <Icon name={event.kind === "routine" ? "routines" : "alert"} size={14} />
                          <span className="ws-cal-event__time">{event.time}</span>
                          <span className="ws-cal-event__title">{event.title}</span>
                        </button>
                      ))}
                      {rest > 0 ? (
                        <Popover
                          side="bottom"
                          align="start"
                          label={`Mais ${rest} em ${day.getDate()}`}
                          className="ws-cal-more"
                          trigger={<button type="button" className="ws-cal__more">+{rest} mais</button>}
                        >
                          <div className="ws-cal-more__list">
                            {list.map((event) => (
                              <button
                                key={event.key}
                                type="button"
                                className="ws-cal-event"
                                data-kind={event.kind}
                                style={{ "--event": event.kind === "routine" ? agentColor(event.routine?.agentId ?? "") : "#D14343" } as CSSProperties}
                                onClick={() => setSelected(event)}
                              >
                                <Icon name={event.kind === "routine" ? "routines" : "alert"} size={14} />
                                <span className="ws-cal-event__time">{event.time}</span>
                                <span className="ws-cal-event__title">{event.title}</span>
                              </button>
                            ))}
                          </div>
                        </Popover>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </Card>
          ) : view === "agenda" ? (
            <Card className="ws-cal-agenda" padded>
              {shown.length === 0 ? (
                <p className="ws-muted">Nenhuma rotina ou prazo nos próximos 30 dias.</p>
              ) : (
                shown.map((event) => (
                  <button key={event.key} type="button" className="ws-cal-agenda__row" onClick={() => setSelected(event)}>
                    <span className="ws-cal-agenda__date">
                      <b>{event.date.getDate()}</b>
                      <small>{new Intl.DateTimeFormat("pt-BR", { month: "short" }).format(event.date).replace(".", "")}</small>
                    </span>
                    <span className="ws-cal-agenda__face">
                      <Icon name={event.kind === "routine" ? "routines" : "issues"} size={16} />
                    </span>
                    <span className="ws-cal-agenda__copy">
                      <b>{event.title}</b>
                      <small>
                        {event.time}
                        {event.agent ? ` · ${event.agent.name}` : ""}
                        {event.room ? ` · #${event.room.name}` : ""}
                      </small>
                    </span>
                    <Chip icon={event.kind === "routine" ? "routines" : "issues"}>
                      {event.kind === "routine" ? "Rotina" : "Prazo"}
                    </Chip>
                  </button>
                ))
              )}
            </Card>
          ) : (
            <TimeGrid days={days} events={shown} today={today} onOpen={setSelected} />
          )}
        </div>

        {panel ? (
          <aside className="ws-cal-side" aria-label="Painel do calendário">
            <MiniMonth focus={focus} today={today} busy={busyDays} onPick={setFocus} />
            <section className="ws-cal-side__section">
              <h2>Próximos</h2>
              {upcoming.length === 0 ? (
                <p className="ws-muted">Nada marcado para os próximos dias.</p>
              ) : (
                <div className="ws-cal-upcoming">
                  {upcoming.map((event) => (
                    <ListRow
                      key={event.key}
                      lead={<Icon name={event.kind === "routine" ? "routines" : "issues"} size={16} />}
                      title={event.title}
                      meta={`${formatDate(event.date)} · ${event.time}`}
                      onClick={() => {
                        setFocus(startOfDay(event.date));
                        setView("day");
                      }}
                    />
                  ))}
                </div>
              )}
            </section>
            <section className="ws-cal-side__section">
              <h2>Filtros</h2>
              {filters}
            </section>
            <section className="ws-cal-side__section">
              <h2>Rotinas</h2>
              <p className="ws-muted">
                {activeRoutines.length} {activeRoutines.length === 1 ? "rotina ativa" : "rotinas ativas"} no workspace.
              </p>
              <Button size="sm" variant="ghost" icon="plus" onClick={openCreate}>
                Nova rotina
              </Button>
            </section>
          </aside>
        ) : null}
      </div>

      <Dialog
        open={creating}
        onOpenChange={(open) => {
          if (!open) setCreating(false);
        }}
        title="Nova rotina"
        description="Uma instrução e quando ela roda. O agente trabalha sozinho no canal escolhido."
        closeLabel="Fechar"
        width={560}
      >
        <DialogBody className="ws-form">
          <Field label="Nome">
            <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex.: Resumo diário de produto" autoFocus />
          </Field>
          <Field label="Instrução">
            <Textarea value={instruction} onChange={(event) => setInstruction(event.target.value)} rows={4} placeholder="O que o agente deve fazer a cada execução?" />
          </Field>
          <div className="ws-task-form-grid">
            <Field label="Agente">
              <Select value={agentId} onValueChange={setAgentId} placeholder="Escolha o agente" options={bots.map((bot) => ({ value: bot.id, label: bot.name }))} />
            </Field>
            <Field label="Canal">
              <Select value={roomId} onValueChange={setRoomId} placeholder="Escolha o canal" options={channels.map((channel) => ({ value: channel.id, label: `#${channel.name}` }))} />
            </Field>
          </div>
          <div className="ws-task-form-grid">
            <Field label="Quando">
              <Select
                value={frequency}
                onValueChange={(value) => setFrequency(value as Frequency)}
                options={[
                  { value: "daily", label: "Todo dia" },
                  { value: "weekdays", label: "Dias úteis" },
                  { value: "weekly", label: "Toda semana" },
                  { value: "monthly", label: "Todo mês" },
                  { value: "once", label: "Uma vez" },
                ]}
              />
            </Field>
            <Field label="Horário">
              <TimeSelect value={time} onChange={setTime} aria-label="Horário da rotina" />
            </Field>
          </div>
          {frequency === "weekly" ? (
            <Field label="Dia da semana">
              <Select value={weekday} onValueChange={setWeekday} options={WEEKDAYS.map((label, value) => ({ value: String(value), label }))} />
            </Field>
          ) : null}
          {frequency === "monthly" ? (
            <Field label="Dia do mês">
              <Input type="number" min={1} max={28} value={day} onChange={(event) => setDay(event.target.value)} />
            </Field>
          ) : null}
          {frequency === "once" ? (
            <Field label="Data">
              <DatePicker
                value={date}
                onChange={setDate}
                locale="pt-BR"
                labels={{ previousMonth: "Mês anterior", nextMonth: "Próximo mês", choose: "Escolher data" }}
              />
            </Field>
          ) : null}
          {error ? <p className="ws-error">{error}</p> : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="default" onClick={() => setCreating(false)}>
            Cancelar
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void create()}>
            Criar rotina
          </Button>
        </DialogFooter>
      </Dialog>

      <Dialog
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
        title={selected?.title ?? "Rotina"}
        description={selected?.kind === "routine" ? "Rotina do workspace" : "Prazo de uma tarefa"}
        closeLabel="Fechar"
        width={520}
      >
        <DialogBody className="ws-form">
          {selected ? (
            <>
              <div className="ws-cal-detail">
                <span className="ws-cal-detail__face">
                  {selected.agent ? (
                    <BotAvatar bot={{ name: selected.agent.name, color: "#5AA8FF", avatar: "jeff-logo" }} size={44} look={false} />
                  ) : (
                    <Icon name={selected.kind === "routine" ? "routines" : "issues"} size={20} />
                  )}
                </span>
                <span className="ws-cal-detail__copy">
                  <b>{selected.agent?.name ?? (selected.kind === "routine" ? "Rotina" : "Tarefa")}</b>
                  <small>
                    {selected.room ? `#${selected.room.name}` : ""}
                    {selected.room ? " · " : ""}
                    {selected.kind === "routine" && selected.routine
                      ? scheduleText(selected.routine.trigger.schedule)
                      : selected.time}
                  </small>
                </span>
              </div>
              {selected.routine ? (
                <>
                  <p className="ws-cal-detail__text">{selected.routine.instruction}</p>
                  <p className="ws-muted">Próxima execução: {nextRunText(selected.routine)}</p>
                </>
              ) : selected.card ? (
                <>
                  <p className="ws-cal-detail__text">{selected.card.description || "Sem descrição."}</p>
                  <p className="ws-muted">
                    Vence em {selected.card.dueAt ? formatDate(selected.card.dueAt) : "—"}
                    {selected.card.owner ? ` · ${selected.card.owner.name}` : " · sem responsável"}
                  </p>
                </>
              ) : null}
            </>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="default" onClick={() => setSelected(null)}>
            Fechar
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}

function MiniMonth({
  focus,
  today,
  busy,
  onPick,
}: {
  focus: Date;
  today: Date;
  busy: ReadonlySet<string>;
  onPick: (date: Date) => void;
}) {
  const first = startOfMonth(focus);
  const grid = monthGrid(first);
  return (
    <Card className="ws-mini" padded>
      <header className="ws-mini__head">{monthName(focus)}</header>
      <div className="ws-mini__grid">
        {["D", "S", "T", "Q", "Q", "S", "S"].map((day, index) => (
          <span className="ws-mini__wd" key={`${day}:${index}`}>
            {day}
          </span>
        ))}
        {grid.map((day) => (
          <button
            key={ymd(day)}
            type="button"
            className="ws-mini__day"
            data-other={day.getMonth() !== first.getMonth() || undefined}
            data-today={sameDay(day, today) || undefined}
            data-busy={busy.has(ymd(day)) || undefined}
            onClick={() => onPick(day)}
          >
            {day.getDate()}
          </button>
        ))}
      </div>
    </Card>
  );
}

function TimeGrid({
  days,
  events,
  today,
  onOpen,
}: {
  days: Date[];
  events: CalEvent[];
  today: Date;
  onOpen: (event: CalEvent) => void;
}) {
  const hours = Array.from({ length: HOUR_END - HOUR_START }, (_, index) => HOUR_START + index);
  const columns = `56px repeat(${days.length}, minmax(0, 1fr))`;
  const timed = events.filter((event) => minutesOf(event.time) !== null);
  const allDay = events.filter((event) => minutesOf(event.time) === null);
  return (
    <Card className="ws-cal-time" padded={false}>
      <div className="ws-cal-time__head" style={{ gridTemplateColumns: columns }}>
        <span />
        {days.map((day) => (
          <div key={ymd(day)} className="ws-cal-time__dayhead" data-today={sameDay(day, today) || undefined}>
            <span>{new Intl.DateTimeFormat("pt-BR", { weekday: "short" }).format(day).replace(".", "")}</span>
            <b>{day.getDate()}</b>
          </div>
        ))}
      </div>
      {allDay.length > 0 ? (
        <div className="ws-cal-time__allday" style={{ gridTemplateColumns: columns }}>
          <span />
          {days.map((day) => (
            <div key={ymd(day)}>
              {allDay
                .filter((event) => sameDay(event.date, day))
                .map((event) => (
                  <button
                    key={event.key}
                    type="button"
                    className="ws-cal-event"
                    style={{ "--event": "#D14343" } as CSSProperties}
                    onClick={() => onOpen(event)}
                  >
                    <Icon name="alert" size={14} />
                    <span className="ws-cal-event__title">{event.title}</span>
                  </button>
                ))}
            </div>
          ))}
        </div>
      ) : null}
      <div className="ws-cal-time__scroll">
        <div className="ws-cal-time__body" style={{ gridTemplateColumns: columns }}>
          <div className="ws-cal-time__hours">
            {hours.map((hour) => (
              <span key={hour}>{String(hour).padStart(2, "0")}:00</span>
            ))}
          </div>
          {days.map((day) => (
            <div key={ymd(day)} className="ws-cal-time__day">
              {timed
                .filter((event) => sameDay(event.date, day))
                .map((event) => {
                  const minutes = minutesOf(event.time) ?? HOUR_START * 60;
                  const top = Math.max(0, ((minutes - HOUR_START * 60) / ((HOUR_END - HOUR_START) * 60)) * 100);
                  const height = Math.max(2.4, (30 / ((HOUR_END - HOUR_START) * 60)) * 100);
                  return (
                    <button
                      key={event.key}
                      type="button"
                      className="ws-cal-time__event"
                      style={
                        {
                          top: `${top}%`,
                          height: `${height}%`,
                          "--event": event.kind === "routine" ? agentColor(event.routine?.agentId ?? "") : "#D14343",
                        } as CSSProperties
                      }
                      title={`${event.time} · ${event.title}`}
                      onClick={() => onOpen(event)}
                    >
                      <span>{event.time}</span>
                      <b>{event.title}</b>
                    </button>
                  );
                })}
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}
