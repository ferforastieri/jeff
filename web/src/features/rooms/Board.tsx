import { useEffect, useMemo, useState } from "react";
import { History, Plus, Trash2, X } from "@jeff/icons";
import { api, type Project } from "../../shared/api";
import { roomsApi, type Card, type Principal } from "./api";
import type { RoomEventItem } from "../../shared/api";

const field =
  "w-full rounded-lg border border-border-button-default bg-background-primary-default px-3 py-2 text-body-2-regular text-text-primary outline-none placeholder:text-text-tertiary focus:border-accent-500";
const quietButton =
  "inline-flex items-center gap-1 rounded-lg px-2 py-1 text-caption-1-medium text-text-secondary hover:bg-background-tertiary-default hover:text-text-primary";
const primaryButton =
  "inline-flex items-center gap-1 rounded-lg bg-accent-500 px-3 py-1.5 text-caption-1-medium text-white disabled:opacity-40";

const COLUMNS = [
  { id: "todo", label: "A fazer" },
  { id: "doing", label: "Andamento" },
  { id: "review", label: "Revisão" },
  { id: "blocked", label: "Bloqueado" },
  { id: "done", label: "Concluído" },
] as const;

const PRIORITY: Record<string, string> = {
  low: "baixa",
  normal: "normal",
  high: "alta",
  urgent: "urgente",
};

function day(value: number | null): string {
  if (!value) return "";
  return new Date(value).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

interface Props {
  project: Project;
  people: Principal[];
  onOpenRoom: (roomId: string) => void;
}

export default function Board({ project, people, onOpenRoom }: Props) {
  const [cards, setCards] = useState<Card[]>([]);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [owner, setOwner] = useState("");
  const [priority, setPriority] = useState("normal");
  const [due, setDue] = useState("");
  const [events, setEvents] = useState<Record<string, RoomEventItem[]>>({});

  async function refresh() {
    try {
      const result = await roomsApi.cards(project.id);
      setCards(result.cards);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível carregar o quadro.");
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

  const grouped = useMemo(() => {
    const map = new Map<string, Card[]>();
    for (const column of COLUMNS) map.set(column.id, []);
    for (const card of cards) {
      const list = map.get(card.column) ?? map.get("todo")!;
      list.push(card);
    }
    return map;
  }, [cards]);

  async function move(card: Card, column: string) {
    setCards((current) =>
      current.map((item) => (item.id === card.id ? { ...item, column } : item)),
    );
    try {
      await roomsApi.moveCard(project.id, card.id, column);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível mover o card.");
      await refresh();
    }
  }

  async function create() {
    if (!title.trim()) {
      setError("O card precisa de um título.");
      return;
    }
    try {
      await roomsApi.createCard(project.id, {
        title: title.trim(),
        description: description.trim(),
        ownerId: owner || null,
        priority,
        dueAt: due ? new Date(`${due}T12:00:00`).getTime() : null,
      });
      setCreating(false);
      setTitle("");
      setDescription("");
      setOwner("");
      setPriority("normal");
      setDue("");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível criar o card.");
    }
  }

  async function history(card: Card) {
    if (events[card.id]) {
      setEvents((current) => {
        const next = { ...current };
        delete next[card.id];
        return next;
      });
      return;
    }
    try {
      const result = await api.cardEvents(project.id, card.id);
      setEvents((current) => ({ ...current, [card.id]: result.events }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível ler o histórico.");
    }
  }

  async function remove(card: Card) {
    setCards((current) => current.filter((item) => item.id !== card.id));
    try {
      await roomsApi.deleteCard(project.id, card.id);
    } catch {
      await refresh();
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-separator-border px-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-body-1-medium">Quadro</h2>
          <p className="truncate text-caption-1-regular text-text-tertiary">
            {cards.length} card{cards.length === 1 ? "" : "s"} em {project.name}
          </p>
        </div>
        <button className={primaryButton} onClick={() => setCreating(true)}>
          <Plus size={14} /> Novo card
        </button>
      </header>

      {error ? (
        <p className="border-b border-separator-border px-4 py-2 text-caption-2-regular text-red-500">
          {error}
        </p>
      ) : null}

      <div className="grid min-h-0 flex-1 grid-cols-5 gap-3 overflow-hidden p-3">
        {COLUMNS.map((column) => {
          const list = grouped.get(column.id) ?? [];
          return (
            <section
              key={column.id}
              className="flex min-h-0 flex-col rounded-xl border border-separator-border bg-background-secondary-default"
            >
              <header className="flex h-9 shrink-0 items-center gap-2 border-b border-separator-border px-3">
                <strong className="text-caption-1-semibold">{column.label}</strong>
                <span className="rounded-full bg-background-tertiary-default px-1.5 text-caption-2-regular text-text-tertiary">
                  {list.length}
                </span>
              </header>
              <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
                {list.map((card) => (
                  <article
                    key={card.id}
                    className="rounded-lg border border-border-button-default bg-background-primary-default p-2"
                  >
                    <div className="flex items-start gap-1">
                      <p className="min-w-0 flex-1 text-caption-1-medium">{card.title}</p>
                      <button
                        className="rounded p-0.5 text-text-tertiary hover:bg-background-tertiary-default hover:text-red-500"
                        title="Apagar card"
                        onClick={() => void remove(card)}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                    {card.description ? (
                      <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-caption-2-regular text-text-tertiary">
                        {card.description}
                      </p>
                    ) : null}
                    <div className="mt-2 flex flex-wrap items-center gap-1">
                      {card.owner ? (
                        <span
                          title={`${card.owner.name} (@${card.owner.handle})`}
                          className="flex size-5 items-center justify-center rounded-full bg-accent-500/15 text-caption-2-medium text-accent-500"
                        >
                          {initials(card.owner.name)}
                        </span>
                      ) : (
                        <span className="text-caption-2-regular text-text-tertiary">sem dono</span>
                      )}
                      {card.priority !== "normal" ? (
                        <span className="rounded bg-background-tertiary-default px-1 text-caption-2-regular text-text-secondary">
                          {PRIORITY[card.priority] ?? card.priority}
                        </span>
                      ) : null}
                      {card.dueAt ? (
                        <span className="text-caption-2-regular text-text-tertiary">
                          {day(card.dueAt)}
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-2 flex items-center gap-1">
                      <select
                        className="min-w-0 flex-1 rounded border border-border-button-default bg-background-secondary-default px-1 py-0.5 text-caption-2-regular"
                        value={card.column}
                        onChange={(event) => void move(card, event.target.value)}
                      >
                        {COLUMNS.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.label}
                          </option>
                        ))}
                      </select>
                      <button
                        className={quietButton}
                        title="Histórico do card"
                        onClick={() => void history(card)}
                      >
                        <History size={12} />
                      </button>
                      {card.roomId ? (
                        <button
                          className={quietButton}
                          title="Abrir a conversa que criou o card"
                          onClick={() => onOpenRoom(card.roomId!)}
                        >
                          abrir
                        </button>
                      ) : null}
                    </div>
                  </article>
                ))}
                {list.length === 0 ? (
                  <p className="px-1 py-4 text-center text-caption-2-regular text-text-tertiary">
                    vazio
                  </p>
                ) : null}
              </div>
            </section>
          );
        })}
      </div>

      {creating ? (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/50 p-4">
          <section className="w-full max-w-md rounded-2xl border border-border-button-white bg-background-primary-default p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-body-1-medium">Novo card</h3>
              <button className={quietButton} onClick={() => setCreating(false)}>
                <X size={14} />
              </button>
            </div>
            <div className="space-y-2">
              <input
                className={field}
                placeholder="Título"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                autoFocus
              />
              <textarea
                className={`${field} min-h-24`}
                placeholder="Descrição"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
              <div className="grid grid-cols-2 gap-2">
                <select className={field} value={owner} onChange={(event) => setOwner(event.target.value)}>
                  <option value="">Sem responsável</option>
                  {people.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.name}
                    </option>
                  ))}
                </select>
                <select
                  className={field}
                  value={priority}
                  onChange={(event) => setPriority(event.target.value)}
                >
                  <option value="low">Baixa</option>
                  <option value="normal">Normal</option>
                  <option value="high">Alta</option>
                  <option value="urgent">Urgente</option>
                </select>
              </div>
              <input
                type="date"
                className={field}
                value={due}
                onChange={(event) => setDue(event.target.value)}
              />
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button className={quietButton} onClick={() => setCreating(false)}>
                Cancelar
              </button>
              <button className={primaryButton} onClick={() => void create()}>
                Criar
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
