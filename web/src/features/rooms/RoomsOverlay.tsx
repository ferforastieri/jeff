import { Button as KitButton } from "@jeff/ui/kit";
import { Input as KitInput, Textarea as KitTextarea, NativeSelect as KitSelect } from "@jeff/ui/kit";
import { useEffect, useMemo, useRef, useState } from "react";
import { Bot, Plus, Search, Send, X } from "@jeff/icons";
import { api, type Project, type RoomEventItem } from "../../shared/api";
import { useApp } from "../../app/store";
import { Bell, History, X as CloseIcon } from "@jeff/icons";
import { roomsApi, type Principal, type Room, type RoomMessage } from "./api";
import Board from "./Board";
import BotBrowserPanel from "./BotBrowserPanel";
import MemoryPanel from "./MemoryPanel";
import RoutinesPanel from "./RoutinesPanel";
import TeamPanel from "./TeamPanel";
import VaultPanel from "./VaultPanel";
import VoicePanel from "./VoicePanel";
import { useRoomsUI } from "./store";
import { formatTime } from "../../shared/time";

type RoomSearchResults = Awaited<ReturnType<typeof api.roomSearch>>;

const field =
  "w-full rounded-lg border border-border-button-default bg-background-primary-default px-3 py-2 text-body-2-regular text-text-primary outline-none placeholder:text-text-tertiary focus:border-accent-500";
const quietButton =
  "inline-flex items-center gap-1 rounded-lg px-2 py-1 text-caption-1-medium text-text-secondary hover:bg-background-tertiary-default hover:text-text-primary";
const primaryButton =
  "inline-flex items-center gap-1 rounded-lg bg-accent-500 px-3 py-1.5 text-caption-1-medium text-white disabled:opacity-40";

function clock(value: number): string {
  return formatTime(value);
}

function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export default function RoomsOverlay({ project }: { project: Project }) {
  const open = useRoomsUI((state) => state.open);
  const roomId = useRoomsUI((state) => state.roomId);
  const close = useRoomsUI((state) => state.close);
  const select = useRoomsUI((state) => state.select);

  const [me, setMe] = useState<Principal | null>(null);
  const [bots, setBots] = useState<Principal[]>([]);
  const [view, setView] = useState<
    "rooms" | "board" | "routines" | "memory" | "browser" | "team" | "voice" | "vault"
  >("rooms");
  const [bell, setBell] = useState(false);
  const notifications = useApp((state) => state.notifications);
  const [roomHistory, setRoomHistory] = useState<RoomEventItem[] | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<RoomSearchResults | null>(null);
  const [searching, setSearching] = useState(false);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [messages, setMessages] = useState<RoomMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [showRoomForm, setShowRoomForm] = useState(false);
  const [showBotForm, setShowBotForm] = useState(false);
  const [roomName, setRoomName] = useState("");
  const [roomInstructions, setRoomInstructions] = useState("");
  const [roomMembers, setRoomMembers] = useState<string[]>([]);
  const [roomLead, setRoomLead] = useState("");
  const [botName, setBotName] = useState("");
  const [botHandle, setBotHandle] = useState("");
  const [botTitle, setBotTitle] = useState("");
  const [botPersona, setBotPersona] = useState("");
  const [botEngine, setBotEngine] = useState("claude");
  const [botModel, setBotModel] = useState("");
  const [botEffort, setBotEffort] = useState("");
  const [botProxy, setBotProxy] = useState("");
  const bottom = useRef<HTMLDivElement>(null);

  const room = useMemo(() => rooms.find((item) => item.id === roomId) ?? null, [rooms, roomId]);
  const people = useMemo(
    () => [me, ...bots].filter((item): item is Principal => Boolean(item)),
    [me, bots],
  );

  async function refreshRooms() {
    const result = await roomsApi.list(project.id);
    setRooms(result.rooms);
    const current = useRoomsUI.getState().roomId;
    if (current && !result.rooms.some((item) => item.id === current)) {
      select(result.rooms[0]?.id ?? null);
    } else if (!current && result.rooms.length > 0) {
      select(result.rooms[0].id);
    }
  }

  async function refreshPrincipals() {
    const result = await roomsApi.principals();
    setMe(result.me);
    setBots(result.bots);
  }

  async function refreshMessages(id: string) {
    const result = await roomsApi.messages(project.id, id);
    setMessages(result.messages);
  }

  useEffect(() => {
    if (!open) return;
    setError("");
    void Promise.all([refreshPrincipals(), refreshRooms()]).catch((cause) =>
      setError(cause instanceof Error ? cause.message : "Não foi possível abrir as salas."),
    );
    const timer = window.setInterval(() => {
      void refreshRooms().catch(() => undefined);
    }, 6000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, project.id]);

  useEffect(() => {
    if (!open || !roomId) {
      setMessages([]);
      return;
    }
    setError("");
    void refreshMessages(roomId).catch((cause) =>
      setError(cause instanceof Error ? cause.message : "Não foi possível abrir a sala."),
    );
    const timer = window.setInterval(() => {
      void refreshMessages(roomId).catch(() => undefined);
    }, 3000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, roomId]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [messages.length, roomId]);

  if (!open) return null;

  async function send() {
    const text = draft.trim();
    if (!text || !room || sending) return;
    setSending(true);
    setError("");
    try {
      await roomsApi.send(project.id, room.id, { text });
      setDraft("");
      await refreshMessages(room.id);
      await refreshRooms();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível enviar.");
    } finally {
      setSending(false);
    }
  }

  async function createRoom() {
    const name = roomName.trim();
    if (!name) {
      setError("A sala precisa de um nome.");
      return;
    }
    try {
      const created = await roomsApi.create(project.id, {
        name,
        instructions: roomInstructions.trim(),
        memberIds: roomMembers,
        leadId: roomLead || null,
      });
      setRooms((current) => [created, ...current]);
      select(created.id);
      setShowRoomForm(false);
      setRoomName("");
      setRoomInstructions("");
      setRoomMembers([]);
      setRoomLead("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível criar a sala.");
    }
  }

  async function createBot() {
    const name = botName.trim();
    if (!name) {
      setError("O bot precisa de um nome.");
      return;
    }
    try {
      const created = await roomsApi.createBot({
        name,
        handle: botHandle.trim() || undefined,
        title: botTitle.trim(),
        persona: botPersona.trim(),
        engine: botEngine,
        model: botModel.trim(),
        effort: botEffort.trim(),
        proxy: botProxy.trim(),
      });
      setBots((current) => [...current, created]);
      setShowBotForm(false);
      setBotName("");
      setBotHandle("");
      setBotTitle("");
      setBotPersona("");
      setBotModel("");
      setBotEffort("");
      setBotProxy("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível criar o bot.");
    }
  }

  async function addBot(botId: string) {
    if (!room) return;
    try {
      await roomsApi.addMember(project.id, room.id, botId);
      await refreshRooms();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível adicionar o bot.");
    }
  }

  async function toggleHistory() {
    if (roomHistory) {
      setRoomHistory(null);
      return;
    }
    if (!room) return;
    try {
      const result = await api.roomEvents(project.id, room.id);
      setRoomHistory(result.events);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível ler o histórico.");
    }
  }

  async function runSearch() {
    const term = query.trim();
    if (!term) {
      setResults(null);
      return;
    }
    setSearching(true);
    try {
      setResults(await api.roomSearch(project.id, term));
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "A busca falhou.");
    } finally {
      setSearching(false);
    }
  }

  function clearSearch() {
    setResults(null);
    setQuery("");
  }

  const unreadRoom = notifications.filter(
    (item) => item.roomId && item.projectId === project.id && !item.read,
  );

  const available = bots.filter(
    (bot) => !room || !room.members.some((member) => member.id === bot.id),
  );
  const roomBots = room?.members.filter((member) => member.kind === "bot") ?? [];

  return (
    <div className="fixed inset-0 z-[70] flex bg-background-full text-text-primary">
      <aside className="relative flex w-[300px] shrink-0 flex-col border-r border-separator-border bg-background-secondary-default">
        <header className="flex h-10 shrink-0 items-center gap-2 border-b border-separator-border px-3">
          <strong className="text-body-2-medium">Salas</strong>
          <span className="min-w-0 flex-1" />
          <KitButton variant="raw"
            className={`${quietButton} relative`}
            onClick={() => setBell((value) => !value)}
            aria-label="Notificações de sala"
            title="Notificações de sala"
          >
            <Bell size={15} />
            {unreadRoom.length > 0 ? (
              <span className="absolute -right-0.5 -top-0.5 flex size-3.5 items-center justify-center rounded-full bg-accent-500 text-[9px] text-white">
                {unreadRoom.length}
              </span>
            ) : null}
          </KitButton>
          <KitButton variant="raw" className={quietButton} onClick={close} aria-label="Fechar salas">
            <X size={16} />
          </KitButton>
        </header>
        {bell ? (
          <div className="absolute inset-x-2 top-11 z-20 max-h-80 overflow-y-auto rounded-xl border border-border-button-white bg-background-primary-default p-1 shadow-2xl">
            {unreadRoom.length === 0 ? (
              <p className="px-2 py-4 text-center text-caption-2-regular text-text-tertiary">
                Nenhuma notificação.
              </p>
            ) : (
              unreadRoom.map((item) => (
                <KitButton variant="raw"
                  key={item.id}
                  className="block w-full rounded-lg px-2 py-1.5 text-left hover:bg-background-tertiary-default"
                  onClick={() => {
                    if (item.roomId) select(item.roomId);
                    setView("rooms");
                    useApp.getState().markNotificationRead(item.id);
                    setBell(false);
                  }}
                >
                  <span className="block truncate text-caption-1-medium">{item.title}</span>
                  <span className="line-clamp-2 block text-caption-2-regular text-text-tertiary">
                    {item.body}
                  </span>
                </KitButton>
              ))
            )}
          </div>
        ) : null}
        <div className="flex shrink-0 flex-wrap gap-1 border-b border-separator-border px-2 py-1.5">
          {(
            [
              ["rooms", "Salas"],
              ["board", "Quadro"],
              ["routines", "Rotinas"],
              ["memory", "Memória"],
              ["browser", "Browser"],
              ["team", "Time"],
              ["voice", "Voz"],
              ["vault", "Cofre"],
            ] as const
          ).map(([id, label]) => (
            <KitButton variant="raw"
              key={id}
              className={
                view === id
                  ? "rounded-lg bg-background-tertiary-default px-1.5 py-1 text-caption-1-semibold text-text-primary"
                  : `${quietButton} px-1.5`
              }
              onClick={() => setView(id)}
            >
              {label}
            </KitButton>
          ))}
        </div>
        <div className="flex gap-1 border-b border-separator-border px-2 py-2">
          <KitButton variant="raw" className={quietButton} onClick={() => setShowRoomForm(true)}>
            <Plus size={14} /> Sala
          </KitButton>
          <KitButton variant="raw" className={quietButton} onClick={() => setShowBotForm(true)}>
            <Bot size={14} /> Bot
          </KitButton>
        </div>
        <div className="flex items-center gap-1 border-b border-separator-border px-2 py-1.5">
          <Search size={14} className="shrink-0 text-text-tertiary" />
          <KitInput raw
            className="min-w-0 flex-1 bg-transparent text-caption-1-regular text-text-primary outline-none placeholder:text-text-tertiary"
            placeholder="Buscar salas, mensagens e cards"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void runSearch();
              if (event.key === "Escape") clearSearch();
            }}
          />
          {searching ? (
            <span className="text-caption-2-regular text-text-tertiary">…</span>
          ) : results ? (
            <KitButton variant="raw" className={quietButton} onClick={clearSearch} aria-label="Limpar busca">
              <X size={12} />
            </KitButton>
          ) : null}
        </div>
        <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
          {results ? (
            <div className="space-y-3">
              {results.rooms.length > 0 ? (
                <section>
                  <p className="px-1 pb-1 text-caption-2-semibold uppercase text-text-tertiary">
                    Salas
                  </p>
                  {results.rooms.map((item) => (
                    <KitButton variant="raw"
                      key={item.id}
                      className="block w-full rounded-lg px-2 py-1.5 text-left hover:bg-background-tertiary-default"
                      onClick={() => {
                        select(item.id);
                        setView("rooms");
                        clearSearch();
                      }}
                    >
                      <span className="block truncate text-caption-1-medium">{item.name}</span>
                      {item.title ? (
                        <span className="block truncate text-caption-2-regular text-text-tertiary">
                          {item.title}
                        </span>
                      ) : null}
                    </KitButton>
                  ))}
                </section>
              ) : null}
              {results.messages.length > 0 ? (
                <section>
                  <p className="px-1 pb-1 text-caption-2-semibold uppercase text-text-tertiary">
                    Mensagens
                  </p>
                  {results.messages.map((item) => (
                    <KitButton variant="raw"
                      key={item.id}
                      className="block w-full rounded-lg px-2 py-1.5 text-left hover:bg-background-tertiary-default"
                      onClick={() => {
                        select(item.roomId);
                        setView("rooms");
                        clearSearch();
                      }}
                    >
                      <span className="block truncate text-caption-2-regular text-text-tertiary">
                        {item.roomName} · @{item.author}
                      </span>
                      <span className="line-clamp-2 block text-caption-1-regular">
                        {item.text}
                      </span>
                    </KitButton>
                  ))}
                </section>
              ) : null}
              {results.cards.length > 0 ? (
                <section>
                  <p className="px-1 pb-1 text-caption-2-semibold uppercase text-text-tertiary">
                    Cards
                  </p>
                  {results.cards.map((item) => (
                    <KitButton variant="raw"
                      key={item.id}
                      className="block w-full rounded-lg px-2 py-1.5 text-left hover:bg-background-tertiary-default"
                      onClick={() => {
                        setView("board");
                        clearSearch();
                      }}
                    >
                      <span className="block truncate text-caption-1-medium">{item.title}</span>
                      <span className="block truncate text-caption-2-regular text-text-tertiary">
                        {item.column}
                      </span>
                    </KitButton>
                  ))}
                </section>
              ) : null}
              {results.rooms.length + results.messages.length + results.cards.length === 0 ? (
                <p className="px-2 py-6 text-caption-1-regular text-text-tertiary">
                  Nada encontrado para “{query}”.
                </p>
              ) : null}
            </div>
          ) : rooms.length === 0 ? (
            <p className="px-2 py-6 text-caption-1-regular text-text-tertiary">
              Nenhuma sala neste repo ainda.
            </p>
          ) : (
            rooms.map((item) => (
              <KitButton variant="raw"
                key={item.id}
                onClick={() => select(item.id)}
                className={`flex w-full items-start gap-2 rounded-xl px-2 py-2 text-left ${
                  item.id === roomId
                    ? "bg-background-tertiary-default"
                    : "hover:bg-background-tertiary-default"
                }`}
              >
                <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-accent-500/15 text-caption-2-medium text-accent-500">
                  {initials(item.name)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body-2-medium">{item.name}</span>
                  <span className="block truncate text-caption-2-regular text-text-tertiary">
                    {item.title || `${item.members.length} membro${item.members.length === 1 ? "" : "s"}`}
                  </span>
                </span>
              </KitButton>
            ))
          )}
        </div>
        {error ? (
          <p className="border-t border-separator-border px-3 py-2 text-caption-2-regular text-red-500">
            {error}
          </p>
        ) : null}
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        {view === "board" ? (
          <Board
            project={project}
            people={people}
            onOpenRoom={(id) => {
              select(id);
              setView("rooms");
            }}
          />
        ) : view === "routines" ? (
          room ? (
            <RoutinesPanel project={project} room={room} bots={roomBots} />
          ) : (
            <div className="flex flex-1 items-center justify-center text-caption-1-regular text-text-tertiary">
              Escolha uma sala para ver as rotinas.
            </div>
          )
        ) : view === "memory" ? (
          roomBots.length > 0 ? (
            <MemoryPanel bots={roomBots} />
          ) : (
            <div className="flex flex-1 items-center justify-center text-caption-1-regular text-text-tertiary">
              Adicione um bot a uma sala para ver a memória.
            </div>
          )
        ) : view === "browser" ? (
          <BotBrowserPanel project={project} bots={roomBots} />
        ) : view === "team" ? (
          <TeamPanel project={project} />
        ) : view === "voice" ? (
          room ? (
            <VoicePanel project={project} room={room} meId={me?.id ?? null} />
          ) : (
            <div className="flex flex-1 items-center justify-center text-caption-1-regular text-text-tertiary">
              Escolha uma sala para entrar na voz.
            </div>
          )
        ) : view === "vault" ? (
          <VaultPanel project={project} />
        ) : room ? (
          <>
            <header className="flex h-14 shrink-0 items-center gap-3 border-b border-separator-border px-4">
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-body-1-medium">{room.name}</h2>
                <p className="truncate text-caption-1-regular text-text-tertiary">
                  {room.title || room.instructions || "Sala do repo"}
                </p>
              </div>
              <div className="flex items-center gap-1">
                {room.members.map((member) => (
                  <span
                    key={member.id}
                    title={`${member.name} (@${member.handle})`}
                    className={`flex size-7 items-center justify-center rounded-full text-caption-2-medium ${
                      member.kind === "bot"
                        ? "bg-accent-500/15 text-accent-500"
                        : "bg-background-tertiary-default text-text-secondary"
                    }`}
                  >
                    {initials(member.name)}
                  </span>
                ))}
              </div>
              <KitButton variant="raw"
                className={quietButton}
                onClick={() => void toggleHistory()}
                title="Histórico da sala"
              >
                <History size={14} />
              </KitButton>
              {available.length > 0 ? (
                <KitSelect raw
                  className="rounded-lg border border-border-button-default bg-background-primary-default px-2 py-1 text-caption-1-regular"
                  value=""
                  onChange={(event) => {
                    if (event.target.value) void addBot(event.target.value);
                  }}
                >
                  <option value="">Adicionar bot…</option>
                  {available.map((bot) => (
                    <option key={bot.id} value={bot.id}>
                      {bot.name}
                    </option>
                  ))}
                </KitSelect>
              ) : null}
            </header>

            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
              {messages.length === 0 ? (
                <p className="py-10 text-center text-caption-1-regular text-text-tertiary">
                  {roomBots.length > 0
                    ? "Manda a primeira mensagem. O bot responde aqui."
                    : "Adiciona um bot para começar."}
                </p>
              ) : (
                messages.map((message) => {
                  const mine = message.author.id === me?.id;
                  const system = message.kind !== "message";
                  return (
                    <div
                      key={message.id}
                      className={`flex ${mine ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`max-w-[72ch] rounded-2xl px-3 py-2 ${
                          system
                            ? "bg-background-tertiary-default text-text-secondary"
                            : mine
                              ? "bg-accent-500 text-white"
                              : "bg-background-secondary-default text-text-primary"
                        }`}
                      >
                        <div className="mb-1 flex items-center gap-2 text-caption-2-regular opacity-70">
                          <span className="font-medium">
                            {message.author.name}
                            {message.author.kind === "bot" ? " · bot" : ""}
                          </span>
                          <span>{clock(message.createdAt)}</span>
                        </div>
                        <p className="whitespace-pre-wrap break-words text-body-2-regular">
                          {message.text}
                        </p>
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={bottom} />
            </div>

            <footer className="shrink-0 border-t border-separator-border p-3">
              <div className="flex items-end gap-2">
                <KitTextarea raw
                  className={`${field} max-h-40 min-h-[44px] resize-none`}
                  placeholder={`Mensagem em ${room.name}`}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void send();
                    }
                  }}
                />
                <KitButton variant="raw" className={primaryButton} onClick={() => void send()} disabled={sending || !draft.trim()}>
                  <Send size={14} /> Enviar
                </KitButton>
              </div>
            </footer>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center text-caption-1-regular text-text-tertiary">
            Escolha ou crie uma sala.
          </div>
        )}
      </main>

      {roomHistory ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4">
          <section className="max-h-[80vh] w-full max-w-md overflow-y-auto rounded-2xl border border-border-button-white bg-background-primary-default p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-body-1-medium">Histórico de {room?.name}</h3>
              <KitButton variant="raw" className={quietButton} onClick={() => setRoomHistory(null)}>
                <CloseIcon size={14} />
              </KitButton>
            </div>
            {roomHistory.length === 0 ? (
              <p className="text-caption-1-regular text-text-tertiary">Sem eventos ainda.</p>
            ) : (
              <div className="space-y-1">
                {roomHistory.map((event) => (
                  <div
                    key={event.id}
                    className="rounded-lg border border-separator-border px-2 py-1.5 text-caption-2-regular text-text-secondary"
                  >
                    <span className="font-medium">{event.kind}</span>
                    {event.detail ? ` · ${event.detail}` : ""}
                    {event.actorName ? ` · ${event.actorName}` : ""}
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      ) : null}

      {showRoomForm ? (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/50 p-4">
          <section className="w-full max-w-md rounded-2xl border border-border-button-white bg-background-primary-default p-4">
            <h3 className="mb-3 text-body-1-medium">Nova sala</h3>
            <div className="space-y-2">
              <KitInput raw
                className={field}
                placeholder="Nome da sala"
                value={roomName}
                onChange={(event) => setRoomName(event.target.value)}
                autoFocus
              />
              <KitTextarea raw
                className={`${field} min-h-20`}
                placeholder="Instruções que todo membro lê (opcional)"
                value={roomInstructions}
                onChange={(event) => setRoomInstructions(event.target.value)}
              />
              {bots.length > 0 ? (
                <div className="rounded-lg border border-border-button-default p-2">
                  <p className="mb-1 text-caption-2-regular text-text-tertiary">Bots</p>
                  <div className="max-h-40 space-y-1 overflow-y-auto">
                    {bots.map((bot) => (
                      <label key={bot.id} className="flex items-center gap-2 text-caption-1-regular">
                        <KitInput raw
                          type="checkbox"
                          checked={roomMembers.includes(bot.id)}
                          onChange={(event) =>
                            setRoomMembers((current) =>
                              event.target.checked
                                ? [...current, bot.id]
                                : current.filter((id) => id !== bot.id),
                            )
                          }
                        />
                        {bot.name}
                      </label>
                    ))}
                  </div>
                  {roomMembers.length > 0 ? (
                    <KitSelect raw
                      className={`${field} mt-2`}
                      value={roomLead}
                      onChange={(event) => setRoomLead(event.target.value)}
                    >
                      <option value="">Sem líder (todos respondem)</option>
                      {roomMembers.map((id) => (
                        <option key={id} value={id}>
                          Líder: {bots.find((bot) => bot.id === id)?.name ?? id}
                        </option>
                      ))}
                    </KitSelect>
                  ) : null}
                </div>
              ) : null}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <KitButton variant="raw" className={quietButton} onClick={() => setShowRoomForm(false)}>
                Cancelar
              </KitButton>
              <KitButton variant="raw" className={primaryButton} onClick={() => void createRoom()}>
                Criar sala
              </KitButton>
            </div>
          </section>
        </div>
      ) : null}

      {showBotForm ? (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/50 p-4">
          <section className="w-full max-w-md rounded-2xl border border-border-button-white bg-background-primary-default p-4">
            <h3 className="mb-3 text-body-1-medium">Novo bot</h3>
            <div className="space-y-2">
              <KitInput raw
                className={field}
                placeholder="Nome"
                value={botName}
                onChange={(event) => setBotName(event.target.value)}
                autoFocus
              />
              <KitInput raw
                className={field}
                placeholder="Handle (opcional)"
                value={botHandle}
                onChange={(event) => setBotHandle(event.target.value)}
              />
              <KitInput raw
                className={field}
                placeholder="Título (ex.: revisor de código)"
                value={botTitle}
                onChange={(event) => setBotTitle(event.target.value)}
              />
              <KitTextarea raw
                className={`${field} min-h-20`}
                placeholder="Persona e instruções"
                value={botPersona}
                onChange={(event) => setBotPersona(event.target.value)}
              />
              <div className="grid grid-cols-2 gap-2">
                <KitSelect raw
                  className={field}
                  value={botEngine}
                  onChange={(event) => setBotEngine(event.target.value)}
                >
                  <option value="claude">Claude Code</option>
                  <option value="codex">Codex</option>
                  <option value="opencode">OpenCode</option>
                </KitSelect>
                <KitInput raw
                  className={field}
                  placeholder="Modelo"
                  value={botModel}
                  onChange={(event) => setBotModel(event.target.value)}
                />
              </div>
              <KitInput raw
                className={field}
                placeholder="Effort (opcional)"
                value={botEffort}
                onChange={(event) => setBotEffort(event.target.value)}
              />
              <KitInput raw
                className={field}
                placeholder="Proxy do navegador (ex.: http://host:3128)"
                value={botProxy}
                onChange={(event) => setBotProxy(event.target.value)}
              />
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <KitButton variant="raw" className={quietButton} onClick={() => setShowBotForm(false)}>
                Cancelar
              </KitButton>
              <KitButton variant="raw" className={primaryButton} onClick={() => void createBot()}>
                Criar bot
              </KitButton>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
