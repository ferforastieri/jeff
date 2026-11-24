import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Chip,
  EmptyState,
  Icon,
  Menu,
  MenuHeading,
  MenuItem,
  MenuSeparator,
  PageHeader,
  type IconName,
} from "faang-ui";
import type { WidgetSpec } from "faang-ui/widgets/spec";
import { api, type Project, type User } from "../../shared/api";
import { roomsApi, type Card as TaskCard, type Principal, type Room, type Routine } from "../rooms/api";
import { formatDate, formatTime } from "../../shared/time";
import { usePrefs } from "../../shared/prefs";

type WidgetKey =
  | "tasksOpen"
  | "agents"
  | "routines"
  | "channels"
  | "taskBars"
  | "activity"
  | "routineList"
  | "doneGoal"
  | "teamOnline"
  | "loadByOwner"
  | "summary";

interface DashboardWidget {
  key: WidgetKey;
  w: 1 | 2;
  h: 1 | 2;
}

interface WidgetDef {
  key: WidgetKey;
  title: string;
  hint: string;
  icon: IconName;
  size: "s" | "m" | "l";
  color: string;
  agent: number;
}

const WIDGET_DEFS: WidgetDef[] = [
  { key: "tasksOpen", title: "Tarefas abertas", hint: "O que ainda está no quadro.", icon: "issues", size: "s", color: "#0063D1", agent: 0 },
  { key: "agents", title: "Agentes", hint: "Quem trabalha com você.", icon: "agent", size: "s", color: "#0E9F6E", agent: 0 },
  { key: "routines", title: "Rotinas ativas", hint: "O que roda sozinho.", icon: "routines", size: "s", color: "#7C5CFC", agent: 1 },
  { key: "channels", title: "Canais", hint: "Onde o time conversa.", icon: "channel", size: "s", color: "#D9822B", agent: 0 },
  { key: "taskBars", title: "Tarefas por coluna", hint: "O quadro por etapa.", icon: "chart", size: "m", color: "#0063D1", agent: 0 },
  { key: "activity", title: "Atividade do quadro", hint: "Cartões atualizados nos últimos dias.", icon: "chart", size: "m", color: "#5A67D8", agent: 0 },
  { key: "routineList", title: "Próximas rotinas", hint: "O que os agentes vão rodar.", icon: "routines", size: "m", color: "#7C5CFC", agent: 1 },
  { key: "doneGoal", title: "Concluídas", hint: "Quanto do quadro já foi feito.", icon: "checks", size: "s", color: "#0E9F6E", agent: 0 },
  { key: "teamOnline", title: "Equipe online", hint: "Quem está no workspace agora.", icon: "members", size: "s", color: "#0E9F6E", agent: 1 },
  { key: "loadByOwner", title: "Carga por responsável", hint: "Tarefas abertas por pessoa ou agente.", icon: "chart", size: "m", color: "#D9822B", agent: 0 },
  { key: "summary", title: "Resumo do workspace", hint: "Um parágrafo curto do que importa.", icon: "document", size: "m", color: "#64748B", agent: 0 },
];

const DEFAULT_WIDGETS: DashboardWidget[] = [
  { key: "tasksOpen", w: 1, h: 1 },
  { key: "agents", w: 1, h: 1 },
  { key: "routines", w: 1, h: 1 },
  { key: "channels", w: 1, h: 1 },
  { key: "taskBars", w: 2, h: 1 },
  { key: "activity", w: 2, h: 1 },
  { key: "routineList", w: 2, h: 1 },
  { key: "doneGoal", w: 1, h: 1 },
  { key: "teamOnline", w: 1, h: 1 },
];

function sizeOf(size: "s" | "m" | "l"): { w: 1 | 2; h: 1 | 2 } {
  return size === "l" ? { w: 2, h: 2 } : size === "m" ? { w: 2, h: 1 } : { w: 1, h: 1 };
}

function nextWidgetSize(widget: DashboardWidget): DashboardWidget {
  if (widget.w === 1) return { ...widget, w: 2, h: 1 };
  if (widget.h === 1) return { ...widget, w: 2, h: 2 };
  return { ...widget, w: 1, h: 1 };
}

function sizeLetter(widget: DashboardWidget): string {
  if (widget.w === 2 && widget.h === 2) return "G";
  if (widget.w === 2) return "M";
  return "P";
}

function parseWidgets(value: unknown): DashboardWidget[] | null {
  if (!Array.isArray(value)) return null;
  const known = new Set(WIDGET_DEFS.map((def) => def.key));
  const list = value
    .filter(
      (item): item is DashboardWidget =>
        Boolean(item) &&
        typeof item === "object" &&
        known.has((item as DashboardWidget).key) &&
        ((item as DashboardWidget).w === 1 || (item as DashboardWidget).w === 2) &&
        ((item as DashboardWidget).h === 1 || (item as DashboardWidget).h === 2),
    )
    .map((item) => ({ ...item }));
  return list.length > 0 ? list : null;
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Bom dia";
  if (hour < 18) return "Boa tarde";
  return "Boa noite";
}

function nextRunText(routine: Routine): string {
  const at = routine.trigger.nextRunAt;
  if (!at) return "sem próxima execução";
  return `${formatDate(at)} · ${formatTime(at)}`;
}

function dayKey(value: number): string {
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(value - offset).toISOString().slice(0, 10);
}

function shortDate(value: number): string {
  return formatDate(value, { day: "2-digit", month: "2-digit" });
}

/** A clean line over a soft area: our own chart, not the pixel dither. */
function LineChart({ values, color, tall }: { values: number[]; color: string; tall?: boolean }) {
  const width = 100;
  const height = tall ? 150 : 64;
  const max = Math.max(1, ...values);
  const min = Math.min(0, ...values);
  const span = Math.max(1, max - min);
  const points = values.map((value, index) => {
    const x = values.length <= 1 ? 0 : (index / (values.length - 1)) * width;
    const y = 4 + (1 - (value - min) / span) * (height - 8);
    return [x, y] as const;
  });
  const line = points.map(([x, y]) => `${x},${y}`).join(" ");
  const area = points.length > 1 ? `0,${height} ${line} ${width},${height}` : "";
  return (
    <svg className="ws-chartline" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
      {area ? <polygon points={area} fill={color} opacity="0.11" /> : null}
      <polyline
        points={line}
        fill="none"
        stroke={color}
        strokeWidth="1.6"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      {points.length > 0 ? (
        <circle cx={points[points.length - 1]?.[0]} cy={points[points.length - 1]?.[1]} r="2.2" fill={color} />
      ) : null}
    </svg>
  );
}

function WidgetBody({ spec, color, tall }: { spec: WidgetSpec; color: string; tall: boolean }) {
  if (spec.kind === "kpi") {
    return (
      <div className="ws-widget-kpi">
        <div className="ws-widget-value">
          {spec.prefix ? <small>{spec.prefix}</small> : null}
          {spec.value}
          {spec.suffix ? <small>{spec.suffix}</small> : null}
        </div>
        <p>{spec.note}</p>
        {spec.spark && spec.spark.length > 1 ? (
          <div className="ws-widget-spark">
            <LineChart values={spec.spark} color={color} />
          </div>
        ) : null}
      </div>
    );
  }
  if (spec.kind === "goal") {
    return (
      <div className="ws-widget-kpi">
        <div className="ws-widget-value">
          {spec.pct}
          <small>%</small>
        </div>
        <div className="ws-widget-goal">
          <span style={{ width: `${Math.max(0, Math.min(100, spec.pct))}%`, background: color }} />
        </div>
        <p>{spec.line}</p>
        {spec.note ? <p className="ws-widget-note">{spec.note}</p> : null}
      </div>
    );
  }
  if (spec.kind === "bars") {
    const max = Math.max(1, ...spec.values);
    return (
      <div className="ws-widget-barsblock">
        {spec.unit ? <span className="ws-widget-unit">{spec.unit}</span> : null}
        <div className="ws-widget-bars">
          {spec.labels.map((label, index) => (
            <span className="ws-widget-bar" key={`${label}:${index}`}>
              <b>{spec.values[index] ?? 0}</b>
              <span className="ws-widget-bar__track">
                <i
                  style={{
                    height: `${Math.max(5, ((spec.values[index] ?? 0) / max) * 100)}%`,
                    background: color,
                  }}
                />
              </span>
              <small>{label}</small>
            </span>
          ))}
        </div>
        {spec.note ? <p className="ws-widget-note">{spec.note}</p> : null}
      </div>
    );
  }
  if (spec.kind === "line") {
    return (
      <div className="ws-widget-lineblock">
        {spec.unit ? <span className="ws-widget-unit">{spec.unit}</span> : null}
        <div className={tall ? "ws-widget-line ws-widget-line--tall" : "ws-widget-line"}>
          <LineChart values={spec.values} color={color} tall={tall} />
        </div>
        <div className="ws-widget-axis">
          {spec.labels.map((label, index) => (
            <span key={`${label}:${index}`}>{label}</span>
          ))}
        </div>
        {spec.note ? <p className="ws-widget-note">{spec.note}</p> : null}
      </div>
    );
  }
  if (spec.kind === "list") {
    return (
      <ul className="ws-widget-list">
        {spec.rows.map((row, index) => (
          <li key={`${row.text}:${index}`} data-tone={row.tone}>
            <Icon name={row.tone === "warn" ? "alert" : row.tone === "ok" ? "check" : "document"} size={14} />
            <span>{row.text}</span>
            {row.meta ? <small>{row.meta}</small> : null}
          </li>
        ))}
      </ul>
    );
  }
  return (
    <ul className="ws-widget-text">
      {spec.items.map((item, index) => (
        <li key={`${item}:${index}`}>{item}</li>
      ))}
    </ul>
  );
}

interface Props {
  project: Project;
  rooms: Room[];
  bots: Principal[];
  me: Principal | null;
  userName: string;
  activeAgents: number;
  onOpenAgent: (bot: Principal) => void;
  onInviteUser: () => void;
  onOpenCalendar: () => void;
}

/** Início: the workspace's stat panels, fed by the cards, routines, people and agents. */
export default function HomeDashboard({
  project,
  rooms,
  bots,
  me,
  userName,
  activeAgents,
  onOpenAgent,
  onInviteUser,
  onOpenCalendar,
}: Props) {
  const [team, setTeam] = useState<User[]>([]);
  const [cards, setCards] = useState<TaskCard[]>([]);
  const [routines, setRoutines] = useState<Routine[]>([]);
  const prefs = usePrefs((state) => state.prefs);
  const updatePrefs = usePrefs((state) => state.update);
  const widgets = useMemo(() => parseWidgets(prefs.homeWidgets) ?? DEFAULT_WIDGETS, [prefs.homeWidgets]);
  const setWidgets = (next: DashboardWidget[]) => updatePrefs({ homeWidgets: next });
  const [arranging, setArranging] = useState(false);

  async function refreshData() {
    void api
      .team()
      .then((result) => setTeam(result.users))
      .catch(() => undefined);
    if (!project.id) return;
    try {
      const [cardList, routineList] = await Promise.all([
        roomsApi.cards(project.id),
        roomsApi.projectRoutines(project.id),
      ]);
      setCards(cardList.cards);
      setRoutines(routineList.routines);
    } catch {
      /* the next refresh tries again */
    }
  }

  useEffect(() => {
    void refreshData();
    const timer = window.setInterval(() => void refreshData(), 60_000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  const channels = rooms.filter((room) => room.kind === "room");
  const dms = rooms.filter((room) => room.kind === "dm");
  const open = cards.filter((card) => card.column !== "done");
  const done = cards.length - open.length;
  const doing = cards.filter((card) => card.column === "doing" || card.column === "review");
  const activeRoutines = routines.filter((routine) => routine.active);
  const upcoming = activeRoutines
    .filter((routine) => routine.trigger.nextRunAt)
    .sort((a, b) => (a.trigger.nextRunAt ?? 0) - (b.trigger.nextRunAt ?? 0));

  const people = useMemo(() => {
    const list: { id: string; name: string; online: boolean; kind: "human" | "bot" }[] = [];
    if (me) list.push({ id: me.id, name: userName, online: true, kind: "human" });
    for (const bot of bots) list.push({ id: bot.id, name: bot.name, online: true, kind: "bot" });
    for (const user of team) {
      if (user.id === me?.userId) continue;
      list.push({ id: `user:${user.id}`, name: user.displayName || user.username, online: false, kind: "human" });
    }
    return list;
  }, [bots, me, team, userName]);

  const online = people.filter((person) => person.online);

  const activity = useMemo(() => {
    const days = Array.from({ length: 7 }, (_, index) => {
      const date = new Date();
      date.setHours(0, 0, 0, 0);
      date.setDate(date.getDate() - (6 - index));
      return date;
    });
    const counts = days.map((day) => {
      const key = dayKey(day.getTime());
      return cards.filter((card) => dayKey(card.updatedAt) === key).length;
    });
    return {
      labels: days.map((day) =>
        new Intl.DateTimeFormat("pt-BR", { weekday: "short" }).format(day).replace(".", ""),
      ),
      counts,
    };
  }, [cards]);

  const loadByOwner = useMemo(() => {
    const map = new Map<string, number>();
    for (const card of open) {
      const name = card.owner?.name ?? "Sem responsável";
      map.set(name, (map.get(name) ?? 0) + 1);
    }
    return [...map.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);
  }, [open]);

  const columns = ["todo", "doing", "review", "blocked", "done"].map(
    (column) => cards.filter((card) => card.column === column).length,
  );
  const firstName = userName.trim().split(/\s+/)[0] || userName;

  function specOf(key: WidgetKey): WidgetSpec {
    switch (key) {
      case "tasksOpen":
        return {
          kind: "kpi",
          value: open.length,
          suffix: "abertas",
          note: `${done} ${done === 1 ? "feita" : "feitas"} no quadro`,
          spark: columns,
        };
      case "agents":
        return {
          kind: "kpi",
          value: bots.length,
          note: activeAgents > 0 ? `${activeAgents} trabalhando agora` : "prontos para trabalhar",
        };
      case "routines":
        return {
          kind: "kpi",
          value: activeRoutines.length,
          note: upcoming[0] ? `próxima ${nextRunText(upcoming[0])}` : "nenhuma agendada",
        };
      case "channels":
        return {
          kind: "kpi",
          value: channels.length,
          note: `${dms.length} ${dms.length === 1 ? "conversa direta" : "conversas diretas"}`,
        };
      case "taskBars":
        return {
          kind: "bars",
          labels: ["A fazer", "Andamento", "Revisão", "Bloqueado", "Feito"],
          values: columns,
          unit: "tarefas",
          note: `${cards.length} ${cards.length === 1 ? "tarefa" : "tarefas"} no quadro`,
        };
      case "activity":
        return {
          kind: "line",
          labels: activity.labels,
          values: activity.counts,
          unit: "cartões atualizados",
          note: `${activity.counts.reduce((total, value) => total + value, 0)} atualizações nos últimos 7 dias`,
        };
      case "routineList":
        return {
          kind: "list",
          rows: upcoming.slice(0, 6).map((routine) => ({
            text: routine.name,
            meta: shortDate(routine.trigger.nextRunAt ?? Date.now()),
            tone: "ok",
          })),
        };
      case "doneGoal":
        return {
          kind: "goal",
          pct: cards.length === 0 ? 0 : Math.round((done / cards.length) * 100),
          line: `${done} de ${cards.length} ${cards.length === 1 ? "tarefa" : "tarefas"}`,
          note: "no quadro do workspace",
        };
      case "teamOnline":
        return {
          kind: "list",
          rows: people.slice(0, 8).map((person) => ({
            text: person.name,
            meta: person.online ? "online" : "offline",
            tone: person.online ? "ok" : undefined,
          })),
        };
      case "loadByOwner":
        return {
          kind: "bars",
          labels: loadByOwner.map(([name]) => name),
          values: loadByOwner.map(([, count]) => count),
          unit: "abertas",
          note: "tarefas abertas por responsável",
        };
      case "summary":
        return {
          kind: "text",
          items: [
            `${open.length} ${open.length === 1 ? "tarefa aberta" : "tarefas abertas"}, ${doing.length} em andamento.`,
            `${activeRoutines.length} ${activeRoutines.length === 1 ? "rotina ativa" : "rotinas ativas"} no workspace.`,
            `${online.length} ${online.length === 1 ? "pessoa ou agente online" : "pessoas e agentes online"}.`,
            `${channels.length} ${channels.length === 1 ? "canal" : "canais"} e ${dms.length} ${dms.length === 1 ? "conversa direta" : "conversas diretas"}.`,
          ],
        };
    }
  }

  const agentOf = (def: WidgetDef) => bots[def.agent % Math.max(1, bots.length)];
  const addWidget = (key: WidgetKey) => {
    const def = WIDGET_DEFS.find((item) => item.key === key);
    if (!def || widgets.some((widget) => widget.key === key)) return;
    setWidgets([...widgets, { key, ...sizeOf(def.size) }]);
  };
  const removeWidget = (key: WidgetKey) =>
    setWidgets(widgets.filter((widget) => widget.key !== key));
  const resizeWidget = (key: WidgetKey) =>
    setWidgets(widgets.map((widget) => (widget.key === key ? nextWidgetSize(widget) : widget)));

  return (
    <div className="ws-home-page">
      <PageHeader
        title={`${greeting()}, ${firstName}`}
        meta={`${open.length} tarefas abertas · ${bots.length} agentes · ${activeRoutines.length} rotinas ativas`}
        actions={
          <>
            <Button variant="default" icon="calendar" onClick={onOpenCalendar}>
              Calendário
            </Button>
            <Button variant="primary" icon="personAdd" onClick={onInviteUser}>
              Novo usuário
            </Button>
          </>
        }
      />

      <section className="ws-home-stats" aria-label="Painéis de estatísticas">
        <div className="ws-home-stats__head">
          <div>
            <h2>Painéis</h2>
            <p>Os painéis do workspace. Você e os agentes podem mudá-los.</p>
          </div>
          <span className="ws-home-stats__grow" />
          <Chip lead={<Icon name="agent" size={14} />}>Editável pelos agentes</Chip>
          <Button
            size="sm"
            variant={arranging ? "default" : "ghost"}
            icon="grid"
            onClick={() => setArranging((value) => !value)}
          >
            {arranging ? "Concluir" : "Organizar"}
          </Button>
          <Menu
            align="end"
            label="Adicionar painel"
            trigger={
              <Button size="sm" variant="default" icon="plus">
                Adicionar painel
              </Button>
            }
          >
            <MenuHeading>Adicionar painel</MenuHeading>
            {WIDGET_DEFS.filter((def) => !widgets.some((widget) => widget.key === def.key)).map((def) => (
              <MenuItem key={def.key} icon={def.icon} description={def.hint} onSelect={() => addWidget(def.key)}>
                {def.title}
              </MenuItem>
            ))}
            {WIDGET_DEFS.every((def) => widgets.some((widget) => widget.key === def.key)) ? (
              <MenuItem disabled icon="check">
                Todos os painéis já estão aqui
              </MenuItem>
            ) : null}
            {bots[0] ? (
              <>
                <MenuSeparator />
                <MenuItem icon="agent" onSelect={() => onOpenAgent(bots[0] as Principal)}>
                  Pedir um painel ao {bots[0].name}
                </MenuItem>
              </>
            ) : null}
          </Menu>
        </div>

        {widgets.length === 0 ? (
          <EmptyState
            icon="grid"
            title="Nenhum painel ainda"
            actions={
              <Button variant="primary" icon="plus" onClick={() => setWidgets(DEFAULT_WIDGETS)}>
                Restaurar painéis
              </Button>
            }
          >
            Adicione os painéis que contam o que está acontecendo no workspace.
          </EmptyState>
        ) : (
          <div className="ws-widgets">
            {widgets.map((widget) => {
              const def = WIDGET_DEFS.find((item) => item.key === widget.key);
              if (!def) return null;
              const agent = agentOf(def);
              const spec = specOf(widget.key);
              return (
                <article
                  className="ws-widget"
                  key={widget.key}
                  data-w={widget.w}
                  data-h={widget.h}
                  style={{ "--widget": def.color } as React.CSSProperties}
                >
                  <header className="ws-widget__head">
                    <span className="ws-widget__icon">
                      <Icon name={def.icon} size={16} />
                    </span>
                    <h3>{def.title}</h3>
                    <span className="ws-widget__grow" />
                    {arranging ? (
                      <span className="ws-widget__organize">
                        <button
                          type="button"
                          className="ws-widget__size"
                          title="Tamanho"
                          onClick={() => resizeWidget(widget.key)}
                        >
                          {sizeLetter(widget)}
                        </button>
                        <Button
                          size="sm"
                          variant="ghost"
                          iconOnly
                          icon="close"
                          aria-label={`Remover ${def.title}`}
                          onClick={() => removeWidget(widget.key)}
                        />
                      </span>
                    ) : (
                      <Menu
                        align="end"
                        label={`Opções de ${def.title}`}
                        trigger={
                          <Button
                            size="sm"
                            variant="ghost"
                            iconOnly
                            icon="more"
                            className="ws-widget__more"
                            aria-label={`Opções de ${def.title}`}
                          />
                        }
                      >
                        <MenuItem icon="refresh" onSelect={() => void refreshData()}>
                          Atualizar
                        </MenuItem>
                        {agent ? (
                          <MenuItem icon="agent" onSelect={() => onOpenAgent(agent)}>
                            Pedir mudança ao {agent.name}
                          </MenuItem>
                        ) : null}
                        <MenuSeparator />
                        <MenuItem icon="trash" danger onSelect={() => removeWidget(widget.key)}>
                          Remover painel
                        </MenuItem>
                      </Menu>
                    )}
                  </header>
                  <div className="ws-widget__body">
                    <WidgetBody spec={spec} color={def.color} tall={widget.h === 2} />
                  </div>
                  <footer className="ws-widget__foot">
                    <span className="ws-widget__dot" />
                    {agent?.name ?? "Workspace"} · atualizado agora
                  </footer>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
