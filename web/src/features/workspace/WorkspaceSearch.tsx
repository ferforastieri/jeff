import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button, Chip, Icon, Kbd, SearchField, type IconName } from "faang-ui";
import { api } from "../../shared/api";
import { type Principal, type Room } from "../rooms/api";
import { formatDate, formatTime } from "../../shared/time";
import BotAvatar from "../agents/components/BotAvatar";
import { Avatar } from "faang-ui";

interface RoomHit {
  id: string;
  name: string;
  title: string;
}
interface MessageHit {
  id: string;
  roomId: string;
  roomName: string;
  text: string;
  createdAt: number;
  author: string;
}
interface CardHit {
  id: string;
  title: string;
  description: string;
  column: string;
  roomId: string | null;
}

interface Results {
  messages: MessageHit[];
  cards: CardHit[];
  rooms: RoomHit[];
}

interface SearchEntry {
  key: string;
  group: string;
  icon?: IconName;
  face?: ReactNode;
  label: ReactNode;
  meta?: ReactNode;
  snippet?: ReactNode;
  action: () => void;
}

const CACHE_TTL = 20_000;
const CACHE_MAX = 60;
const cache = new Map<string, { at: number; data: Results }>();

const COLUMNS: Record<string, string> = {
  todo: "A fazer",
  doing: "Em andamento",
  review: "Em revisão",
  blocked: "Bloqueado",
  done: "Feito",
};

function highlighted(text: string, term: string): ReactNode {
  const at = term ? text.toLowerCase().indexOf(term.toLowerCase()) : -1;
  if (at < 0) return text;
  return (
    <>
      {text.slice(0, at)}
      <mark className="ws-search-mark">{text.slice(at, at + term.length)}</mark>
      {text.slice(at + term.length)}
    </>
  );
}

function entry(
  key: string,
  group: string,
  label: ReactNode,
  action: () => void,
  options: Partial<Pick<SearchEntry, "icon" | "face" | "meta" | "snippet">> = {},
): SearchEntry {
  return { key, group, label, action, ...options };
}

export default function WorkspaceSearch({
  projectId,
  rooms,
  people,
  bots,
  me,
  views,
  onOpenRoom,
  onOpenAgent,
  onOpenView,
  onOpenCard,
}: {
  projectId: string;
  rooms: Room[];
  people: Principal[];
  bots: Principal[];
  me: Principal | null;
  views: { id: string; label: string; icon: IconName }[];
  onOpenRoom: (roomId: string) => void;
  onOpenAgent: (bot: Principal) => void;
  onOpenView: (view: string) => void;
  onOpenCard: (roomId: string | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<Results | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);

  const term = query.trim();
  const short = term.length < 2;

  // The shortcut is the field's: no palette needed for the workspace search.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "k") return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable]")) return;
      event.preventDefault();
      setOpen(true);
      input.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (box.current && !box.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  useEffect(() => {
    if (!open || short) {
      setResults(null);
      setLoading(false);
      setError("");
      return;
    }
    const key = `${projectId}:${term}`;
    const cached = cache.get(key);
    if (cached && Date.now() - cached.at < CACHE_TTL) {
      setResults(cached.data);
      setLoading(false);
      setError("");
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError("");
      void api
        .roomSearch(projectId, term, controller.signal)
        .then((data) => {
          if (controller.signal.aborted) return;
          cache.set(key, { at: Date.now(), data });
          if (cache.size > CACHE_MAX) {
            const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
            if (oldest) cache.delete(oldest[0]);
          }
          setResults(data);
        })
        .catch((cause) => {
          if (controller.signal.aborted) return;
          setError(cause instanceof Error ? cause.message : "Não foi possível buscar.");
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 180);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [open, projectId, short, term]);

  const groups = useMemo(() => {
    if (!open) return [] as { label: string; entries: SearchEntry[] }[];
    const needle = term.toLowerCase();
    const viewEntries: SearchEntry[] = views
      .filter((view) => !needle || view.label.toLowerCase().includes(needle))
      .slice(0, 4)
      .map((view) =>
        entry(`v:${view.id}`, "Ir para", view.label, () => onOpenView(view.id), { icon: view.icon }),
      );

    const liveRooms: SearchEntry[] = (results?.rooms ?? [])
      .slice(0, 6)
      .map((room) =>
        entry(`r:${room.id}`, "Canais", highlighted(`#${room.name}`, term), () => onOpenRoom(room.id), {
          icon: "channel",
          meta: room.title || undefined,
        }),
      );

    const messages: SearchEntry[] = (results?.messages ?? [])
      .slice(0, 8)
      .map((message) =>
        entry(
          `m:${message.id}`,
          "Mensagens",
          highlighted(message.text, term),
          () => onOpenRoom(message.roomId),
          {
            icon: "message",
            meta: (
              <>
                {message.author} em <b>#{message.roomName}</b> · {formatDate(message.createdAt)} {formatTime(message.createdAt)}
              </>
            ),
          },
        ),
      );

    const cards: SearchEntry[] = (results?.cards ?? [])
      .slice(0, 5)
      .map((card) =>
        entry(`c:${card.id}`, "Tarefas", highlighted(card.title, term), () => onOpenCard(card.roomId), {
          icon: "issues",
          meta: COLUMNS[card.column] ?? card.column,
          snippet: card.description ? highlighted(card.description, term) : undefined,
        }),
      );

    const agentEntries: SearchEntry[] = bots
      .filter((bot) => {
        if (!needle) return false;
        return [bot.name, bot.handle, bot.bot?.title].filter(Boolean).join(" ").toLowerCase().includes(needle);
      })
      .slice(0, 4)
      .map((bot) =>
        entry(`a:${bot.id}`, "Agentes", highlighted(bot.name, term), () => onOpenAgent(bot), {
          face: <BotAvatar bot={{ name: bot.name, color: "#5AA8FF", avatar: "jeff-logo" }} size={20} look={false} />,
          meta: bot.bot?.title || `@${bot.handle}`,
        }),
      );

    const peopleEntries: SearchEntry[] = people
      .filter((person) => person.kind === "human" && person.id !== me?.id)
      .filter((person) => {
        if (!needle) return false;
        const dm = rooms.some(
          (room) =>
            room.kind === "dm" &&
            room.members.some((member) => member.id === person.id) &&
            room.members.some((member) => member.id === me?.id),
        );
        return dm && [person.name, person.handle].join(" ").toLowerCase().includes(needle);
      })
      .slice(0, 4)
      .map((person) => {
        const dm = rooms.find(
          (room) =>
            room.kind === "dm" &&
            room.members.some((member) => member.id === person.id) &&
            room.members.some((member) => member.id === me?.id),
        );
        return entry(`p:${person.id}`, "Pessoas", highlighted(person.name, term), () => {
          if (dm) onOpenRoom(dm.id);
        }, {
          face: <Avatar name={person.name} size="xs" />,
          meta: `@${person.handle}`,
        });
      });

    const list = [
      { label: "Ir para", entries: viewEntries },
      { label: "Canais", entries: liveRooms },
      { label: "Mensagens", entries: messages },
      { label: "Tarefas", entries: cards },
      { label: "Agentes", entries: agentEntries },
      { label: "Pessoas", entries: peopleEntries },
    ];
    return list.filter((group) => group.entries.length > 0);
  }, [bots, me?.id, onOpenAgent, onOpenCard, onOpenRoom, onOpenView, open, people, results, rooms, term, views]);

  const flat = groups.flatMap((group) => group.entries);
  useEffect(() => {
    setActive(0);
  }, [term, results]);

  function run(entry: SearchEntry) {
    entry.action();
    setOpen(false);
    setQuery("");
    setResults(null);
  }

  const empty = !short && !loading && results && flat.length === 0;

  return (
    <div className="ws-search-box" ref={box}>
      <SearchField
        ref={input}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onClear={() => {
          setQuery("");
          setResults(null);
          input.current?.focus();
        }}
        clearLabel="Limpar busca"
        placeholder="Buscar…"
        aria-label="Buscar no workspace"
        shortcut={
          <span className="ws-kbd">
            <Kbd>Ctrl</Kbd>
            <Kbd>K</Kbd>
          </span>
        }
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            setOpen(false);
            return;
          }
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActive((index) => (flat.length === 0 ? 0 : (index + 1) % flat.length));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive((index) => (flat.length === 0 ? 0 : (index - 1 + flat.length) % flat.length));
          } else if (event.key === "Enter" && flat[active]) {
            event.preventDefault();
            run(flat[active] as SearchEntry);
          }
        }}
      />
      {open ? (
        <div className="ws-search-panel" role="dialog" aria-label="Resultados da busca">
          <header className="ws-search-panel__head">
            <span>{short ? "Buscar no workspace" : `Resultados para “${term}”`}</span>
            {loading ? <Chip>Buscando…</Chip> : null}
            <span className="ws-search-panel__grow" />
            <span className="ws-search-panel__hint">↑↓ navegar · Enter abrir · Esc fechar</span>
            <Button
              size="sm"
              variant="ghost"
              iconOnly
              icon="close"
              aria-label="Fechar busca"
              onClick={() => setOpen(false)}
            />
          </header>
          {error ? <p className="ws-search-panel__error">{error}</p> : null}
          {short ? (
            <p className="ws-search-panel__hintbody">
              Digite ao menos 2 letras para buscar canais, mensagens, tarefas, agentes e pessoas.
            </p>
          ) : null}
          <div className="ws-search-panel__body">
            {groups.map((group) => (
              <section className="ws-search-group" key={group.label}>
                <h3>{group.label}</h3>
                {group.entries.map((item) => {
                  const index = flat.findIndex((value) => value.key === item.key);
                  return (
                    <button
                      key={item.key}
                      type="button"
                      className="ws-search-result"
                      data-active={index === active || undefined}
                      onMouseDown={(event) => event.preventDefault()}
                      onMouseEnter={() => setActive(index)}
                      onClick={() => run(item)}
                    >
                      <span className="ws-search-result__lead">
                        {item.face ?? (item.icon ? <Icon name={item.icon} size={16} /> : null)}
                      </span>
                      <span className="ws-search-result__copy">
                        <span className="ws-search-result__label">{item.label}</span>
                        {item.meta ? <span className="ws-search-result__meta">{item.meta}</span> : null}
                        {item.snippet ? <span className="ws-search-result__snippet">{item.snippet}</span> : null}
                      </span>
                    </button>
                  );
                })}
              </section>
            ))}
            {empty ? <p className="ws-search-panel__empty">Nada encontrado para “{term}”.</p> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
