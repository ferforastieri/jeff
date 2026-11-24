import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
} from "react";
import {
  Avatar,
  Button,
  Chip,
  DatePicker,
  Dialog,
  DialogBody,
  DialogFooter,
  FactLine,
  Field,
  FilterChip,
  GroupHeading,
  Icon,
  Input,
  Kbd,
  List,
  ListRow,
  Menu,
  MenuItem,
  MenuSeparator,
  PageHeader,
  SearchField,
  Segmented,
  Select,
  Textarea,
  Toolbar,
  type IconName,
  type LineFact,
} from "faang-ui";
import { api, type Project, type RoomEventItem } from "../../shared/api";
import { roomsApi, type Card, type Principal } from "./api";
import { formatDate } from "../../shared/time";
import BotAvatar from "../agents/components/BotAvatar";
import { usePrefs } from "../../shared/prefs";

type ColumnId = "todo" | "doing" | "review" | "blocked" | "done";

const COLUMNS: { id: ColumnId; label: string; icon: IconName }[] = [
  { id: "todo", label: "A fazer", icon: "stageTodo" },
  { id: "doing", label: "Em andamento", icon: "stageProgress" },
  { id: "review", label: "Em revisão", icon: "stageReview" },
  { id: "blocked", label: "Bloqueado", icon: "block" },
  { id: "done", label: "Feito", icon: "stageDone" },
];

const PRIORITY: Record<string, { label: string; icon: IconName }> = {
  low: { label: "Baixa", icon: "arrowDown" },
  normal: { label: "Normal", icon: "dash" },
  high: { label: "Alta", icon: "arrowUp" },
  urgent: { label: "Urgente", icon: "alert" },
};

const NO_OWNER = "__none";

function columnOf(card: Card): ColumnId {
  return COLUMNS.some((column) => column.id === card.column)
    ? (card.column as ColumnId)
    : "todo";
}

function day(value: number | null): string {
  if (!value) return "";
  return formatDate(value, { day: "2-digit", month: "2-digit" });
}

function dueTone(value: number): "warn" | undefined {
  const end = new Date(value);
  end.setHours(23, 59, 59, 999);
  const days = Math.ceil((end.getTime() - Date.now()) / 86_400_000);
  return days <= 1 ? "warn" : undefined;
}

function dueInput(value: number | null): string {
  if (!value) return "";
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(value - offset).toISOString().slice(0, 10);
}

function faceOf(kind: string | undefined, name: string, size = 18) {
  return kind === "bot" ? (
    <BotAvatar
      bot={{ name, color: "#5AA8FF", avatar: "jeff-logo" }}
      size={size}
      look={false}
    />
  ) : (
    <Avatar name={name} size="xs" />
  );
}

interface Props {
  project: Project;
  people: Principal[];
  onOpenRoom: (roomId: string) => void;
}

/**
 * The tasks board, as the reference's kanban: the page's head, the filters,
 * then the columns on the sunken ground, each scrolling on its own, with the
 * cards raised on it. Cards move between columns by drag or by their dialog.
 */
export default function Board({ project, people, onOpenRoom }: Props) {
  const [cards, setCards] = useState<Card[]>([]);
  const [error, setError] = useState("");
  const [formError, setFormError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // Filters.
  const [query, setQuery] = useState("");
  const [owners, setOwners] = useState<string[]>([]);
  const [priorities, setPriorities] = useState<string[]>([]);
  const prefs = usePrefs((state) => state.prefs);
  const updatePrefs = usePrefs((state) => state.update);
  const layout = prefs.taskLayout === "list" ? "list" : "board";
  const setLayout = (next: "board" | "list") => updatePrefs({ taskLayout: next });
  const searchRef = useRef<HTMLInputElement>(null);

  // New task: the column it starts in (null = closed).
  const [creating, setCreating] = useState<ColumnId | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [owner, setOwner] = useState("");
  const [priority, setPriority] = useState("normal");
  const [due, setDue] = useState("");

  // Open task.
  const [editing, setEditing] = useState<Card | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editOwner, setEditOwner] = useState("");
  const [editPriority, setEditPriority] = useState("normal");
  const [editDue, setEditDue] = useState("");
  const [editColumn, setEditColumn] = useState<ColumnId>("todo");
  const [history, setHistory] = useState<RoomEventItem[] | null>(null);
  const [historyBusy, setHistoryBusy] = useState(false);

  // Drag.
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<ColumnId | null>(null);

  async function refresh() {
    try {
      const result = await roomsApi.cards(project.id);
      setCards(result.cards);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível carregar o quadro.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => {
      void refresh();
    }, 5000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  // N opens a new task, / focuses the search, as on the reference's page.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const element = event.target instanceof Element ? event.target : null;
      if (element?.closest("input, textarea, [contenteditable], [role=dialog], [role=menu], [role=listbox]")) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key.toLowerCase() === "n") {
        event.preventDefault();
        startCreate("todo");
      } else if (event.key === "/") {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function move(card: Card, column: ColumnId) {
    if (columnOf(card) === column) return;
    setCards((current) =>
      current.map((item) => (item.id === card.id ? { ...item, column } : item)),
    );
    try {
      await roomsApi.moveCard(project.id, card.id, column);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível mover a tarefa.");
      await refresh();
    }
  }

  function startCreate(column: ColumnId) {
    setFormError("");
    setCreating(column);
    setTitle("");
    setDescription("");
    setOwner("");
    setPriority("normal");
    setDue("");
  }

  async function create() {
    if (!title.trim()) {
      setFormError("Dê um título à tarefa.");
      return;
    }
    setBusy(true);
    setFormError("");
    try {
      const card = await roomsApi.createCard(project.id, {
        title: title.trim(),
        description: description.trim(),
        ownerId: owner || null,
        priority,
        dueAt: due ? new Date(`${due}T12:00:00`).getTime() : null,
      });
      if (creating && creating !== "todo") {
        await roomsApi.moveCard(project.id, card.id, creating);
      }
      setCreating(null);
      await refresh();
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : "Não foi possível criar a tarefa.");
    } finally {
      setBusy(false);
    }
  }

  function openCard(card: Card) {
    setFormError("");
    setEditing(card);
    setEditTitle(card.title);
    setEditDescription(card.description);
    setEditOwner(card.ownerId ?? "");
    setEditPriority(card.priority);
    setEditDue(dueInput(card.dueAt));
    setEditColumn(columnOf(card));
    setHistory(null);
  }

  async function save() {
    if (!editing) return;
    if (!editTitle.trim()) {
      setFormError("Dê um título à tarefa.");
      return;
    }
    setBusy(true);
    setFormError("");
    try {
      await roomsApi.updateCard(project.id, editing.id, {
        title: editTitle.trim(),
        description: editDescription.trim(),
        ownerId: editOwner || null,
        priority: editPriority,
        dueAt: editDue ? new Date(`${editDue}T12:00:00`).getTime() : null,
        column: editColumn,
      });
      setEditing(null);
      await refresh();
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : "Não foi possível salvar a tarefa.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(card: Card) {
    if (!window.confirm(`Apagar “${card.title}”?`)) return;
    setBusy(true);
    setFormError("");
    try {
      await roomsApi.deleteCard(project.id, card.id);
      setEditing(null);
      await refresh();
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : "Não foi possível apagar a tarefa.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleHistory(card: Card) {
    if (history) {
      setHistory(null);
      return;
    }
    setHistoryBusy(true);
    setFormError("");
    try {
      const result = await api.cardEvents(project.id, card.id);
      setHistory(result.events);
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : "Não foi possível ler o histórico.");
    } finally {
      setHistoryBusy(false);
    }
  }

  function startDrag(event: DragEvent<HTMLElement>, card: Card) {
    setDragging(card.id);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", card.id);
  }

  function drop(event: DragEvent<HTMLElement>, column: ColumnId) {
    event.preventDefault();
    const id = event.dataTransfer.getData("text/plain") || dragging;
    setOver(null);
    setDragging(null);
    const card = cards.find((item) => item.id === id);
    if (card) void move(card, column);
  }

  const ownerOptions = useMemo(
    () => [
      ...[...people]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((person) => ({
          value: person.id,
          label: person.name,
          leading: faceOf(person.kind, person.name),
          count: cards.filter((card) => card.ownerId === person.id).length,
        })),
      {
        value: NO_OWNER,
        label: "Sem responsável",
        leading: <Icon name="person" size={14} />,
        count: cards.filter((card) => !card.ownerId).length,
      },
    ],
    [people, cards],
  );

  const priorityOptions = useMemo(
    () =>
      Object.entries(PRIORITY).map(([value, item]) => ({
        value,
        label: item.label,
        leading: <Icon name={item.icon} size={14} />,
        count: cards.filter((card) => card.priority === value).length,
      })),
    [cards],
  );

  const searched = query.trim().toLowerCase();
  const visible = cards.filter((card) => {
    if (searched) {
      const text = [card.title, card.description, card.owner?.name ?? ""]
        .join(" ")
        .toLowerCase();
      if (!text.includes(searched)) return false;
    }
    if (owners.length > 0 && !owners.includes(card.ownerId ?? NO_OWNER)) return false;
    if (priorities.length > 0 && !priorities.includes(card.priority)) return false;
    return true;
  });
  const grouped = COLUMNS.map((column) => ({
    ...column,
    cards: visible.filter((card) => columnOf(card) === column.id),
  }));

  const open = cards.filter((card) => card.column !== "done");
  const done = cards.length - open.length;
  const unassigned = open.filter((card) => !card.ownerId).length;
  const filtered = owners.length > 0 || priorities.length > 0 || searched !== "";

  function clearFilters() {
    setQuery("");
    setOwners([]);
    setPriorities([]);
  }

  const ownerField = (value: string, onChange: (value: string) => void) => (
    <Select
      value={value}
      onValueChange={onChange}
      placeholder="Sem responsável"
      options={[
        { value: "", label: "Sem responsável" },
        ...people
          .slice()
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((person) => ({ value: person.id, label: `${person.name} (@${person.handle})` })),
      ]}
    />
  );

  return (
    <div className="ws-tasks-page">
      <PageHeader
        title="Tarefas"
        meta={[
          `${open.length} ${open.length === 1 ? "aberta" : "abertas"}`,
          `${done} ${done === 1 ? "feita" : "feitas"}`,
          unassigned > 0
            ? `${unassigned} sem ${unassigned === 1 ? "responsável" : "responsáveis"}`
            : "",
        ]
          .filter(Boolean)
          .join(" · ")}
        actions={
          <Button
            variant="primary"
            icon="plus"
            kbd={["N"]}
            onClick={() => startCreate("todo")}
          >
            Nova tarefa
          </Button>
        }
      />

      <Toolbar
        label="Filtros"
        search={
          <SearchField
            ref={searchRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onClear={() => setQuery("")}
            clearLabel="Limpar busca"
            placeholder="Buscar tarefas"
            aria-label="Buscar tarefas"
            shortcut={<Kbd aria-hidden="true">/</Kbd>}
          />
        }
        actions={
          <>
          <Segmented<"board" | "list">
            size="sm"
            label="Visão das tarefas"
            value={layout}
            onValueChange={setLayout}
            options={[
              {
                value: "board",
                label: (
                  <>
                    <Icon name="grid" size={16} />
                    <span className="ac-visually-hidden">Quadro</span>
                  </>
                ),
              },
              {
                value: "list",
                label: (
                  <>
                    <Icon name="list" size={16} />
                    <span className="ac-visually-hidden">Lista</span>
                  </>
                ),
              },
            ]}
          />
          <Menu
            align="end"
            label="Mais opções"
            trigger={
              <Button size="sm" iconOnly icon="more" aria-label="Mais opções" />
            }
          >
            <MenuItem icon="plus" onSelect={() => startCreate("todo")}>
              Nova tarefa
            </MenuItem>
            <MenuItem icon="refresh" onSelect={() => void refresh()}>
              Atualizar
            </MenuItem>
            {filtered ? (
              <>
                <MenuSeparator />
                <MenuItem icon="close" onSelect={clearFilters}>
                  Limpar filtros
                </MenuItem>
              </>
            ) : null}
          </Menu>
          </>
        }
      >
        <FilterChip
          label="Responsável"
          icon="person"
          multiple
          options={ownerOptions}
          value={owners}
          onChange={setOwners}
          clearLabel="Limpar responsável"
          searchLabel="Buscar responsável"
          searchPlaceholder="Buscar pessoa ou agente"
          noResults="Ninguém encontrado."
        />
        <FilterChip
          label="Prioridade"
          icon="flag"
          multiple
          options={priorityOptions}
          value={priorities}
          onChange={setPriorities}
          clearLabel="Limpar prioridade"
        />
      </Toolbar>

      {error ? <p className="ws-error">{error}</p> : null}

      {layout === "board" ? (
      <div className="ws-boardframe">
        <div className="ws-boardwrap">
          <div className="ws-board">
            {grouped.map((column) => (
              <section
                key={column.id}
                className={`ws-board-col${over === column.id ? " is-over" : ""}`}
                aria-label={column.label}
                onDragOver={(event) => {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                  if (over !== column.id) setOver(column.id);
                }}
                onDragEnter={() => setOver(column.id)}
                onDragLeave={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node)) setOver(null);
                }}
                onDrop={(event) => drop(event, column.id)}
              >
                <div className="ws-board-col__head">
                  <Icon name={column.icon} size={16} />
                  <h2>{column.label}</h2>
                  <span className="tabular">{column.cards.length}</span>
                  <span className="ws-board-col__grow" />
                  {column.id === "todo" ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      iconOnly
                      icon="plus"
                      aria-label="Nova tarefa em A fazer"
                      title="Nova tarefa em A fazer"
                      onClick={() => startCreate("todo")}
                    />
                  ) : null}
                </div>
                <div className="ws-board-col__cards">
                  {column.cards.map((card) => (
                    <div
                      className="ws-board-col__slot"
                      key={card.id}
                      hidden={dragging === card.id && over === column.id}
                    >
                      <button
                        type="button"
                        className={`ws-task-card${dragging === card.id ? " is-dragging" : ""}`}
                        data-status={column.id}
                        draggable
                        aria-label={`${card.title}${card.owner ? ` — ${card.owner.name}` : ""}`}
                        onClick={() => openCard(card)}
                        onDragStart={(event) => startDrag(event, card)}
                        onDragEnd={() => {
                          setDragging(null);
                          setOver(null);
                        }}
                      >
                        <span className="ws-task-card__title">{card.title}</span>
                        <CardFacts card={card} />
                        <span className="ws-task-card__who">
                          {card.owner ? (
                            faceOf(card.owner.kind, card.owner.name)
                          ) : (
                            <span className="ws-task-card__noface">
                              <Icon name="person" size={14} />
                            </span>
                          )}
                          <b>{card.owner?.name ?? "Sem responsável"}</b>
                        </span>
                      </button>
                    </div>
                  ))}
                  {column.cards.length === 0 ? (
                    <p className="ws-board-col__empty">
                      {over === column.id ? "Soltar aqui" : "Nenhuma tarefa"}
                    </p>
                  ) : null}
                </div>
              </section>
            ))}
          </div>
        </div>
      </div>

      ) : (
        <div className="ws-task-list">
          {grouped.filter((column) => column.cards.length > 0).length === 0 ? (
            <p className="ws-muted">Nenhuma tarefa encontrada.</p>
          ) : (
            grouped
              .filter((column) => column.cards.length > 0)
              .map((column) => (
                <section key={column.id} className="ws-task-list__group">
                  <GroupHeading
                    title={
                      <>
                        <Icon name={column.icon} size={16} />
                        {column.label}
                      </>
                    }
                    count={column.cards.length}
                  />
                  <List>
                    {column.cards.map((card) => (
                      <ListRow
                        key={card.id}
                        lead={
                          card.owner ? (
                            faceOf(card.owner.kind, card.owner.name)
                          ) : (
                            <Icon name="person" size={16} />
                          )
                        }
                        title={card.title}
                        meta={card.owner?.name ?? "Sem responsável"}
                        trailing={
                          <span className="ws-task-list__end">
                            {card.priority !== "normal" ? (
                              <Chip icon={PRIORITY[card.priority]?.icon}>
                                {PRIORITY[card.priority]?.label ?? card.priority}
                              </Chip>
                            ) : null}
                            {card.dueAt ? (
                              <span className="ws-task-list__when">{day(card.dueAt)}</span>
                            ) : null}
                          </span>
                        }
                        onClick={() => openCard(card)}
                      />
                    ))}
                  </List>
                </section>
              ))
          )}
        </div>
      )}

      {loading && cards.length === 0 ? (
        <p className="ws-muted ws-board-loading">Carregando tarefas…</p>
      ) : null}

      <Dialog
        open={creating !== null}
        onOpenChange={(openNow) => {
          if (!openNow) setCreating(null);
        }}
        title="Nova tarefa"
        description={creating ? `Em ${COLUMNS.find((column) => column.id === creating)?.label ?? "A fazer"}.` : undefined}
        closeLabel="Fechar"
        width={560}
      >
        <DialogBody className="ws-form">
          <Field label="Título">
            <Input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="O que precisa ser feito?"
              autoFocus
            />
          </Field>
          <Field label="Descrição">
            <Textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Contexto, links, critérios…"
              rows={4}
            />
          </Field>
          <div className="ws-task-form-grid">
            <Field label="Responsável">{ownerField(owner, setOwner)}</Field>
            <Field label="Prioridade">
              <Select
                value={priority}
                onValueChange={setPriority}
                options={Object.entries(PRIORITY).map(([value, item]) => ({
                  value,
                  label: item.label,
                }))}
              />
            </Field>
          </div>
          <div className="ws-task-form-grid">
            <Field label="Vencimento">
              <DatePicker
                value={due || null}
                onChange={(value) => setDue(value)}
                onClear={() => setDue("")}
                locale="pt-BR"
                placeholder="Sem vencimento"
                labels={{
                  previousMonth: "Mês anterior",
                  nextMonth: "Próximo mês",
                  choose: "Escolher data",
                  clear: "Tirar o vencimento",
                }}
              />
            </Field>
            <Field label="Coluna">
              <Select
                value={creating ?? "todo"}
                onValueChange={(value) => setCreating(value as ColumnId)}
                options={COLUMNS.map((column) => ({ value: column.id, label: column.label }))}
              />
            </Field>
          </div>
          {formError ? <p className="ws-error">{formError}</p> : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="default" onClick={() => setCreating(null)}>
            Cancelar
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void create()}>
            Criar tarefa
          </Button>
        </DialogFooter>
      </Dialog>

      <Dialog
        open={editing !== null}
        onOpenChange={(openNow) => {
          if (!openNow) setEditing(null);
        }}
        title="Tarefa"
        description="O que precisa ser feito, quem cuida e onde ela está."
        closeLabel="Fechar"
        width={560}
      >
        <DialogBody className="ws-form">
          <Field label="Título">
            <Input
              value={editTitle}
              onChange={(event) => setEditTitle(event.target.value)}
              autoFocus
            />
          </Field>
          <Field label="Descrição">
            <Textarea
              value={editDescription}
              onChange={(event) => setEditDescription(event.target.value)}
              rows={4}
              placeholder="Contexto, links, critérios…"
            />
          </Field>
          <div className="ws-task-form-grid">
            <Field label="Responsável">{ownerField(editOwner, setEditOwner)}</Field>
            <Field label="Prioridade">
              <Select
                value={editPriority}
                onValueChange={setEditPriority}
                options={Object.entries(PRIORITY).map(([value, item]) => ({
                  value,
                  label: item.label,
                }))}
              />
            </Field>
          </div>
          <div className="ws-task-form-grid">
            <Field label="Vencimento">
              <DatePicker
                value={editDue || null}
                onChange={(value) => setEditDue(value)}
                onClear={() => setEditDue("")}
                locale="pt-BR"
                placeholder="Sem vencimento"
                labels={{
                  previousMonth: "Mês anterior",
                  nextMonth: "Próximo mês",
                  choose: "Escolher data",
                  clear: "Tirar o vencimento",
                }}
              />
            </Field>
            <Field label="Coluna">
              <Select
                value={editColumn}
                onValueChange={(value) => setEditColumn(value as ColumnId)}
                options={COLUMNS.map((column) => ({ value: column.id, label: column.label }))}
              />
            </Field>
          </div>
          {editing ? (
            <div className="ws-task-history">
              <Button
                variant="ghost"
                size="sm"
                icon="clock"
                loading={historyBusy}
                onClick={() => void toggleHistory(editing)}
              >
                {history ? "Ocultar histórico" : "Ver histórico"}
              </Button>
              {history ? (
                history.length === 0 ? (
                  <p className="ws-muted">Sem histórico ainda.</p>
                ) : (
                  <ol className="ws-task-history__list">
                    {history.map((event) => (
                      <li key={event.id}>
                        <span className="ws-task-history__who">
                          {event.actorName ?? "Alguém"}
                        </span>
                        <span>{event.detail || event.kind}</span>
                        <time>{formatDate(event.createdAt)}</time>
                      </li>
                    ))}
                  </ol>
                )
              ) : null}
            </div>
          ) : null}
          {formError ? <p className="ws-error">{formError}</p> : null}
        </DialogBody>
        <DialogFooter
          note={
            editing ? (
              <span className="ws-task-dialog__acts">
                {editing.roomId ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    icon="thread"
                    onClick={() => {
                      const roomId = editing.roomId;
                      setEditing(null);
                      if (roomId) onOpenRoom(roomId);
                    }}
                  >
                    Abrir conversa
                  </Button>
                ) : null}
                <Button
                  variant="ghost"
                  size="sm"
                  icon="trash"
                  loading={busy}
                  onClick={() => void remove(editing)}
                >
                  Apagar
                </Button>
              </span>
            ) : undefined
          }
        >
          <Button variant="default" onClick={() => setEditing(null)}>
            Cancelar
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void save()}>
            Salvar
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}

function CardFacts({ card }: { card: Card }) {
  const facts: LineFact[] = [];
  const priority = PRIORITY[card.priority];
  if (card.priority !== "normal" && priority) {
    facts.push({
      key: "priority",
      icon: priority.icon,
      text: priority.label,
      tone:
        card.priority === "high" || card.priority === "urgent" ? "warn-icon" : undefined,
    });
  }
  if (card.dueAt) {
    const tone = dueTone(card.dueAt);
    facts.push({
      key: "due",
      icon: tone ? "alert" : "calendar",
      text: day(card.dueAt),
      tone,
      title: "Vencimento",
    });
  }
  if (card.roomId) {
    facts.push({ key: "room", icon: "thread", text: "conversa", title: "Abrir a conversa" });
  }
  return <FactLine facts={facts} className="ws-task-card__facts" />;
}
