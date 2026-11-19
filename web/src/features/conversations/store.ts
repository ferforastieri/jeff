import { create } from "zustand";
import { BOT_AVATARS, type BotAvatar, type BotLanguage } from "../agents/avatars";

const DEFAULT_JEFF_COLOR = "#0063D1";
const LEGACY_BRAND_COLORS = new Set(["#FFB547", "#F01F31", "#FF5C69", "#FF98A1", "#0F766E", "#14B8A6", "#5EEAD4"]);

function currentBrandColor(color?: string): string {
  const value = color?.trim();
  if (!value) return DEFAULT_JEFF_COLOR;
  return LEGACY_BRAND_COLORS.has(value.toUpperCase()) ? DEFAULT_JEFF_COLOR : value;
}

type JeffAgentMode = "build" | "plan";
type JeffPermissionMode = "yolo" | "ask" | "deny";

export interface ChatJeff {
  /** A Jeff belongs to the project, not to a conversation. */
  id: string;
  name: string;
  handle: string;
  role: string;
  description: string;
  personality: string;
  prompt: string;
  model: string;
  /** External CLI that owns the agent loop. */
  engine: string;
  effort: string;
  agentMode: JeffAgentMode;
  permissionMode: JeffPermissionMode;
  mcpServers: string[];
  emailAccountIds: string[];
  language: BotLanguage;
  color: string;
  avatar: BotAvatar;
  notifications: boolean;
  createdAt: number;
}

/** A conversation (task) with one Jeff or a group of them. */
export interface JeffChat {
  id: string;
  /** Empty means "use the participants' names" in the UI. */
  name: string;
  /** What the session is about, derived from its first user message. */
  subject: string;
  /** Context applied to every participant of this task. */
  description: string;
  /** One id is an individual task; two or more make a group. */
  participantIds: string[];
  /** Model, effort and harness chosen in this conversation, by Jeff id. */
  jeffSettings?: Record<string, { model?: string; effort?: string; engine?: string }>;
  createdAt: number;
  updatedAt: number;
}

export interface ChatMessage {
  id: string;
  chatId: string;
  role: "user" | "assistant" | "reasoning" | "tool" | "system" | "error" | "activity";
  jeffId?: string;
  content: string;
  title?: string;
  detail?: string;
  status?: "running" | "complete" | "error";
  permissionId?: string;
  permissionAction?: string;
  sessionId?: string;
  pending?: boolean;
  durationMs?: number;
  createdAt: number;
}

export interface ProjectChats {
  version: 5;
  /** Tasks: each one has one Jeff (individual) or several (group). */
  chats: JeffChat[];
  /** Project-level Jeff identities. The same Jeff can join many tasks. */
  jeffs: ChatJeff[];
  messages: ChatMessage[];
  activeChatId: string | null;
  hydrated?: boolean;
}

type ProjectChatsSnapshot = Omit<ProjectChats, "messages" | "hydrated">;

export interface JeffPreset {
  name: string;
  role: string;
  description: string;
  personality: string;
  prompt: string;
  color: string;
  avatar: BotAvatar;
  model?: string;
  engine?: string;
  effort?: string;
  agentMode?: JeffAgentMode;
  permissionMode?: JeffPermissionMode;
  mcpServers?: string[];
  emailAccountIds?: string[];
  language?: BotLanguage;
}

function newId(prefix: string): string {
  const value = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}-${value}`;
}

function slugifyJeff(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
}

function uniqueName(desired: string, used: Set<string>): string {
  const base = desired.trim() || "Jeff";
  let name = base;
  let index = 2;
  while (used.has(name.toLowerCase())) {
    name = `${base} ${index}`;
    index += 1;
  }
  return name;
}

function uniqueHandle(desired: string, used: Set<string>): string {
  const base = slugifyJeff(desired) || "jeff";
  let handle = base;
  let index = 2;
  while (used.has(handle)) {
    handle = `${base}-${index}`;
    index += 1;
  }
  return handle;
}

function normalizeJeff(jeff: Partial<ChatJeff>): ChatJeff {
  const name = jeff.name?.trim() || "Jeff";
  return {
    id: String(jeff.id),
    name,
    handle: jeff.handle || slugifyJeff(name),
    role: jeff.role?.trim() || "Jeff",
    description: jeff.description ?? "",
    personality: jeff.personality ?? "",
    prompt: jeff.prompt ?? "",
    model: jeff.model ?? "",
    engine: typeof jeff.engine === "string" && jeff.engine ? jeff.engine : "opencode",
    effort: jeff.effort ?? "",
    agentMode: jeff.agentMode === "plan" ? "plan" : "build",
    permissionMode: jeff.permissionMode === "ask" || jeff.permissionMode === "deny" ? jeff.permissionMode : "yolo",
    mcpServers: Array.isArray(jeff.mcpServers) ? jeff.mcpServers.filter((item): item is string => typeof item === "string") : [],
    emailAccountIds: Array.isArray(jeff.emailAccountIds) ? jeff.emailAccountIds.filter((item): item is string => typeof item === "string") : [],
    language: jeff.language === "pt" || jeff.language === "en" || jeff.language === "es" ? jeff.language : "auto",
    color: currentBrandColor(jeff.color),
    avatar: jeff.avatar && BOT_AVATARS.includes(jeff.avatar) ? jeff.avatar : "jeff-logo",
    notifications: jeff.notifications !== false,
    createdAt: Number.isFinite(jeff.createdAt) ? Number(jeff.createdAt) : Date.now(),
  };
}

function normalizeMessage(message: ChatMessage): ChatMessage {
  return {
    ...message,
    content: capMessageText(typeof message.content === "string" ? message.content : ""),
    detail: typeof message.detail === "string" ? capMessageText(message.detail) : message.detail,
    createdAt: Number.isFinite(message.createdAt) ? message.createdAt : Date.now(),
    pending: message.pending === true,
  };
}

const MAX_MESSAGE_TEXT = 200_000;

/** Keep huge tool payloads (base64 images, minified files) from freezing the
 * UI and bloating the persisted history. */
function capMessageText(value: string): string {
  if (value.length <= MAX_MESSAGE_TEXT) return value;
  return `${value.slice(0, MAX_MESSAGE_TEXT)}\n… (${value.length - MAX_MESSAGE_TEXT} caracteres omitidos)`;
}

function cappedMessage(message: ChatMessage): ChatMessage {
  return {
    ...message,
    content: capMessageText(message.content),
    detail: typeof message.detail === "string" ? capMessageText(message.detail) : message.detail,
  };
}

/** A project starts empty: Jeffs are created first, tasks open around them. */
function freshProject(hydrated = false): ProjectChats {
  return { version: 5, chats: [], jeffs: [], messages: [], activeChatId: null, hydrated };
}

function sanitizeProject(input: ProjectChats | null | undefined): ProjectChats {
  if (!input) return freshProject(true);
  const now = Date.now();
  const raw = input as unknown as {
    version?: number;
    chat?: Partial<JeffChat> & { kind?: string };
    chats?: Array<Partial<JeffChat> & { kind?: string; participantIds?: string[] }>;
    jeffs?: Array<Partial<ChatJeff> & { chatId?: string }>;
    messages?: ChatMessage[];
    activeChatId?: string | null;
  };

  const rawJeffs = Array.isArray(raw.jeffs) ? raw.jeffs : [];
  const seenJeffs = new Set<string>();
  const jeffs: ChatJeff[] = [];
  for (const item of rawJeffs) {
    if (!item || typeof item.id !== "string" || !item.id || seenJeffs.has(item.id)) continue;
    seenJeffs.add(item.id);
    jeffs.push(normalizeJeff(item));
  }
  const handles = new Set<string>();
  for (const jeff of jeffs) {
    jeff.handle = uniqueHandle(jeff.handle || jeff.name, handles);
    handles.add(jeff.handle);
  }
  const jeffIds = new Set(jeffs.map((jeff) => jeff.id));

  let rawChats: Array<Partial<JeffChat> & { kind?: string; participantIds?: string[] }> = [];
  if (Array.isArray(raw.chats)) rawChats = raw.chats.filter((item) => item && typeof item.id === "string" && item.id);
  else if (raw.chat && typeof raw.chat.id === "string" && raw.chat.id) rawChats = [raw.chat];

  const seenChats = new Set<string>();
  let chats: JeffChat[] = rawChats.flatMap((item) => {
    if (!item.id || seenChats.has(item.id)) return [];
    seenChats.add(item.id);
    const explicit = Array.isArray(item.participantIds)
      ? item.participantIds.filter((id): id is string => typeof id === "string" && jeffIds.has(id))
      : [];
    const legacy = rawJeffs
      .filter((jeff) => jeff && typeof jeff.id === "string" && jeffIds.has(jeff.id) && jeff.chatId === item.id)
      .map((jeff) => jeff.id!);
    const participantIds = [...new Set(explicit.length > 0 ? explicit : legacy)];
    const name = item.name?.trim() === "Equipe" ? "" : item.name?.trim() ?? "";
    return [{
      id: item.id,
      name,
      subject: typeof item.subject === "string" ? item.subject.trim() : "",
      description: item.description ?? "",
      participantIds,
      jeffSettings: normalizeJeffSettings(item.jeffSettings),
      createdAt: Number.isFinite(item.createdAt) ? Number(item.createdAt) : now,
      updatedAt: Number.isFinite(item.updatedAt) ? Number(item.updatedAt) : now,
    }];
  });

  if (chats.length === 0 && (jeffs.length > 0 || (Array.isArray(raw.messages) && raw.messages.length > 0))) {
    chats = [{
      id: newId("chat"),
      name: "",
      subject: "",
      description: "",
      participantIds: [...jeffs.map((jeff) => jeff.id)],
      createdAt: now,
      updatedAt: now,
    }];
  }

  const chatIds = new Set(chats.map((chat) => chat.id));
  const mappedMessages = (Array.isArray(raw.messages) ? raw.messages : [])
    .filter((message): message is ChatMessage => Boolean(
      message &&
      typeof message.id === "string" &&
      (!message.jeffId || jeffIds.has(message.jeffId)),
    ))
    .map((message) => normalizeMessage({
      ...message,
      chatId: chatIds.has(message.chatId) ? message.chatId : chats[0]?.id ?? message.chatId,
    }))
    .filter((message) => chatIds.has(message.chatId))
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));

  const activeChatId = chats.some((chat) => chat.id === raw.activeChatId) ? raw.activeChatId! : chats[0]?.id ?? null;
  return { version: 5, chats, jeffs, messages: mappedMessages, activeChatId, hydrated: true };
}

function normalizeJeffSettings(raw: unknown): Record<string, { model?: string; effort?: string; engine?: string }> {
  if (!raw || typeof raw !== "object") return {};
  const next: Record<string, { model?: string; effort?: string; engine?: string }> = {};
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const item = value as { model?: unknown; effort?: unknown; engine?: unknown };
    next[id] = {
      ...(typeof item.model === "string" && item.model ? { model: item.model } : {}),
      ...(typeof item.effort === "string" ? { effort: item.effort } : {}),
      ...(typeof item.engine === "string" && item.engine ? { engine: item.engine } : {}),
    };
  }
  return next;
}

function emptyProject(hydrated = false): ProjectChats {
  return freshProject(hydrated);
}

function queueWrite(
  writes: Record<string, Record<string, ChatMessage>>,
  projectId: string,
  message: ChatMessage,
): Record<string, Record<string, ChatMessage>> {
  if (message.pending) return writes;
  return { ...writes, [projectId]: { ...(writes[projectId] ?? {}), [message.id]: message } };
}

function removeWritesForChat(
  writes: Record<string, Record<string, ChatMessage>>,
  projectId: string,
  chatId: string,
): Record<string, Record<string, ChatMessage>> {
  const pending = Object.fromEntries(
    Object.entries(writes[projectId] ?? {}).filter(([, message]) => message.chatId !== chatId),
  );
  return { ...writes, [projectId]: pending };
}

interface ChatStore {
  byProject: Record<string, ProjectChats>;
  messageWrites: Record<string, Record<string, ChatMessage>>;
  load: (projectId: string, chats?: ProjectChats | null) => void;
  ensure: (projectId: string) => ProjectChats;
  snapshot: (projectId: string) => ProjectChatsSnapshot | null;
  unload: (projectId: string) => void;
  forget: (projectId: string) => void;
  /** Creates a task with one Jeff (individual) or several (group). */
  createConversation: (projectId: string, participantIds: string[], options?: { name?: string; description?: string }) => JeffChat | null;
  updateChat: (projectId: string, chatId: string, patch: Partial<Pick<JeffChat, "name" | "subject" | "description">>) => void;
  /** The model/effort/harness of one Jeff in this conversation only. */
  updateChatJeff: (projectId: string, chatId: string, jeffId: string, patch: { model?: string; effort?: string; engine?: string }) => void;
  deleteConversation: (projectId: string, chatId: string) => void;
  setActiveChat: (projectId: string, chatId: string | null) => void;
  createJeff: (projectId: string, preset: JeffPreset) => ChatJeff | null;
  updateJeff: (projectId: string, jeffId: string, patch: Partial<ChatJeff>) => void;
  removeJeff: (projectId: string, jeffId: string) => void;
  addParticipant: (projectId: string, chatId: string, jeffId: string) => void;
  touchConversation: (projectId: string, chatId: string) => void;
  removeParticipant: (projectId: string, chatId: string, jeffId: string) => void;
  addMessage: (projectId: string, message: ChatMessage) => void;
  appendMessage: (projectId: string, messageId: string, text: string) => void;
  updateMessage: (projectId: string, messageId: string, patch: Partial<ChatMessage>) => void;
  removeMessage: (projectId: string, messageId: string) => void;
  mergeMessages: (projectId: string, messages: ChatMessage[]) => void;
  replaceChatMessages: (projectId: string, chatId: string, messages: ChatMessage[]) => void;
  pendingMessageWrites: (projectId: string) => ChatMessage[];
  acknowledgeMessageWrites: (projectId: string, messages: ChatMessage[]) => void;
  discardMessageWrites: (projectId: string, chatId: string) => void;
}

export const useChats = create<ChatStore>((set, get) => ({
  byProject: {},
  messageWrites: {},

  load: (projectId, chats) => {
    set((state) => ({ byProject: { ...state.byProject, [projectId]: sanitizeProject(chats) } }));
  },

  ensure: (projectId) => {
    const existing = get().byProject[projectId];
    if (existing) return existing;
    const next = emptyProject();
    set((state) => ({ byProject: { ...state.byProject, [projectId]: next } }));
    return next;
  },

  snapshot: (projectId) => {
    const project = get().byProject[projectId];
    if (!project) return null;
    return { version: 5, chats: project.chats, jeffs: project.jeffs, activeChatId: project.activeChatId };
  },

  unload: (projectId) =>
    set((state) => {
      const byProject = { ...state.byProject };
      delete byProject[projectId];
      return { byProject };
    }),

  forget: (projectId) =>
    set((state) => {
      const byProject = { ...state.byProject };
      const messageWrites = { ...state.messageWrites };
      delete byProject[projectId];
      delete messageWrites[projectId];
      return { byProject, messageWrites };
    }),

  createConversation: (projectId, participantIds, options = {}) => {
    const project = get().ensure(projectId);
    const unique = [...new Set(participantIds)].filter((id) => project.jeffs.some((jeff) => jeff.id === id));
    if (unique.length === 0) return null;
    const now = Math.max(Date.now(), ...project.chats.map((chat) => chat.updatedAt + 1));
    const chat: JeffChat = {
      id: newId("chat"),
      name: options.name?.trim() ?? "",
      subject: "",
      description: options.description?.trim() ?? "",
      participantIds: unique,
      jeffSettings: {},
      createdAt: now,
      updatedAt: now,
    };
    set((state) => ({
      byProject: {
        ...state.byProject,
        [projectId]: { ...project, chats: [...project.chats, chat], activeChatId: chat.id },
      },
    }));
    return chat;
  },

  updateChat: (projectId, chatId, patch) =>
    set((state) => {
      const project = state.byProject[projectId];
      if (!project) return state;
      return {
        byProject: {
          ...state.byProject,
          [projectId]: {
            ...project,
            chats: project.chats.map((chat) =>
              chat.id === chatId
                ? {
                    ...chat,
                    name: patch.name === undefined ? chat.name : patch.name.trim(),
                    subject: patch.subject === undefined ? chat.subject : patch.subject.trim(),
                    description: patch.description === undefined ? chat.description : patch.description.trim(),
                    updatedAt: Date.now(),
                  }
                : chat,
            ),
          },
        },
      };
    }),

  updateChatJeff: (projectId, chatId, jeffId, patch) =>
    set((state) => {
      const project = state.byProject[projectId];
      if (!project) return state;
      return {
        byProject: {
          ...state.byProject,
          [projectId]: {
            ...project,
            chats: project.chats.map((chat) => {
              if (chat.id !== chatId) return chat;
              const current = chat.jeffSettings?.[jeffId] ?? {};
              return {
                ...chat,
                jeffSettings: { ...(chat.jeffSettings ?? {}), [jeffId]: { ...current, ...patch } },
                updatedAt: Date.now(),
              };
            }),
          },
        },
      };
    }),

  deleteConversation: (projectId, chatId) =>
    set((state) => {
      const project = state.byProject[projectId];
      if (!project) return state;
      const chats = project.chats.filter((chat) => chat.id !== chatId);
      const messages = project.messages.filter((message) => message.chatId !== chatId);
      const activeChatId = project.activeChatId === chatId ? chats[0]?.id ?? null : project.activeChatId;
      return {
        byProject: { ...state.byProject, [projectId]: { ...project, chats, messages, activeChatId } },
        messageWrites: removeWritesForChat(state.messageWrites, projectId, chatId),
      };
    }),

  setActiveChat: (projectId, chatId) =>
    set((state) => {
      const project = state.byProject[projectId];
      if (!project) return state;
      const next = chatId && project.chats.some((chat) => chat.id === chatId) ? chatId : null;
      if (project.activeChatId === next) return state;
      return { byProject: { ...state.byProject, [projectId]: { ...project, activeChatId: next } } };
    }),

  createJeff: (projectId, preset) => {
    const project = get().ensure(projectId);
    const role = preset.role.trim() || "Jeff";
    const names = new Set(project.jeffs.map((jeff) => jeff.name.toLowerCase()));
    const handles = new Set(project.jeffs.map((jeff) => jeff.handle));
    const name = uniqueName(preset.name, names);
    const handle = uniqueHandle(name, handles);
    const jeff: ChatJeff = {
      id: newId("jeff"),
      name,
      handle,
      role,
      description: preset.description ?? "",
      personality: preset.personality ?? "",
      prompt: preset.prompt ?? "",
      model: preset.model ?? "",
      engine: preset.engine ?? "opencode",
      effort: preset.effort ?? "",
      agentMode: preset.agentMode === "plan" ? "plan" : "build",
      permissionMode: preset.permissionMode === "ask" || preset.permissionMode === "deny" ? preset.permissionMode : "yolo",
      mcpServers: [...(preset.mcpServers ?? [])],
      emailAccountIds: [...(preset.emailAccountIds ?? [])],
      language: preset.language ?? "auto",
      color: preset.color || DEFAULT_JEFF_COLOR,
      avatar: BOT_AVATARS.includes(preset.avatar) ? preset.avatar : "jeff-logo",
      notifications: true,
      createdAt: Date.now(),
    };
    set((state) => ({
      byProject: {
        ...state.byProject,
        [projectId]: { ...project, jeffs: [...project.jeffs, jeff] },
      },
    }));
    return jeff;
  },

  updateJeff: (projectId, jeffId, patch) =>
    set((state) => {
      const project = state.byProject[projectId];
      if (!project) return state;
      const target = project.jeffs.find((jeff) => jeff.id === jeffId);
      if (!target) return state;
      const name = patch.name?.trim() || target.name;
      const role = patch.role === undefined ? target.role : patch.role.trim() || "Jeff";
      const handles = new Set(project.jeffs.filter((jeff) => jeff.id !== jeffId).map((jeff) => jeff.handle));
      const handle = patch.name ? uniqueHandle(name, handles) : target.handle;
      return {
        byProject: {
          ...state.byProject,
          [projectId]: {
            ...project,
            jeffs: project.jeffs.map((jeff) =>
              jeff.id === jeffId ? { ...jeff, ...patch, name, handle, role } : jeff,
            ),
          },
        },
      };
    }),

  removeJeff: (projectId, jeffId) =>
    set((state) => {
      const project = state.byProject[projectId];
      if (!project) return state;
      const removedIds = new Set(
        project.messages.filter((message) => message.jeffId === jeffId).map((message) => message.id),
      );
      const pending = Object.fromEntries(
        Object.entries(state.messageWrites[projectId] ?? {}).filter(([id]) => !removedIds.has(id)),
      );
      const chats = project.chats
        .map((chat) => chat.participantIds.includes(jeffId)
          ? { ...chat, participantIds: chat.participantIds.filter((id) => id !== jeffId) }
          : chat)
        .filter((chat) => chat.participantIds.length > 0);
      const chatIds = new Set(chats.map((chat) => chat.id));
      return {
        byProject: {
          ...state.byProject,
          [projectId]: {
            ...project,
            jeffs: project.jeffs.filter((jeff) => jeff.id !== jeffId),
            chats,
            messages: project.messages.filter((message) => message.jeffId !== jeffId && chatIds.has(message.chatId)),
            activeChatId: project.activeChatId && chatIds.has(project.activeChatId) ? project.activeChatId : chats[0]?.id ?? null,
          },
        },
        messageWrites: { ...state.messageWrites, [projectId]: pending },
      };
    }),

  addParticipant: (projectId, chatId, jeffId) =>
    set((state) => {
      const project = state.byProject[projectId];
      if (!project || !project.jeffs.some((jeff) => jeff.id === jeffId)) return state;
      return {
        byProject: {
          ...state.byProject,
          [projectId]: {
            ...project,
            chats: project.chats.map((chat) =>
              chat.id === chatId && !chat.participantIds.includes(jeffId)
                ? { ...chat, participantIds: [...chat.participantIds, jeffId], updatedAt: Date.now() }
                : chat,
            ),
          },
        },
      };
    }),

  touchConversation: (projectId, chatId) =>
    set((state) => {
      const project = state.byProject[projectId];
      if (!project) return state;
      return {
        byProject: {
          ...state.byProject,
          [projectId]: {
            ...project,
            chats: project.chats.map((chat) => chat.id === chatId ? { ...chat, updatedAt: Date.now() } : chat),
          },
        },
      };
    }),

  removeParticipant: (projectId, chatId, jeffId) =>
    set((state) => {
      const project = state.byProject[projectId];
      if (!project) return state;
      const removedIds = new Set(
        project.messages
          .filter((message) => message.chatId === chatId && message.jeffId === jeffId)
          .map((message) => message.id),
      );
      const pending = Object.fromEntries(
        Object.entries(state.messageWrites[projectId] ?? {}).filter(([id]) => !removedIds.has(id)),
      );
      const chats = project.chats
        .map((chat) => chat.id === chatId
          ? { ...chat, participantIds: chat.participantIds.filter((id) => id !== jeffId), updatedAt: Date.now() }
          : chat)
        .filter((chat) => chat.participantIds.length > 0);
      const chatIds = new Set(chats.map((chat) => chat.id));
      return {
        byProject: {
          ...state.byProject,
          [projectId]: {
            ...project,
            chats,
            messages: project.messages.filter((message) => !removedIds.has(message.id) && chatIds.has(message.chatId)),
            activeChatId: project.activeChatId && chatIds.has(project.activeChatId) ? project.activeChatId : chats[0]?.id ?? null,
          },
        },
        messageWrites: { ...state.messageWrites, [projectId]: pending },
      };
    }),

  addMessage: (projectId, message) =>
    set((state) => {
      const project = state.byProject[projectId];
      if (!project || project.messages.some((item) => item.id === message.id)) return state;
      const next = cappedMessage(message);
      return {
        byProject: {
          ...state.byProject,
          [projectId]: {
            ...project,
            messages: [...project.messages, next].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)),
          },
        },
        messageWrites: queueWrite(state.messageWrites, projectId, next),
      };
    }),

  appendMessage: (projectId, messageId, text) =>
    set((state) => {
      const project = state.byProject[projectId];
      if (!project) return state;
      let changed: ChatMessage | null = null;
      const messages = project.messages.map((message) => {
        if (message.id !== messageId) return message;
        changed = cappedMessage({ ...message, content: `${message.content}${text}` });
        return changed;
      });
      return {
        byProject: { ...state.byProject, [projectId]: { ...project, messages } },
        messageWrites: changed ? queueWrite(state.messageWrites, projectId, changed) : state.messageWrites,
      };
    }),

  updateMessage: (projectId, messageId, patch) =>
    set((state) => {
      const project = state.byProject[projectId];
      if (!project) return state;
      let changed: ChatMessage | null = null;
      const messages = project.messages.map((message) => {
        if (message.id !== messageId) return message;
        changed = cappedMessage({ ...message, ...patch });
        return changed;
      });
      return {
        byProject: { ...state.byProject, [projectId]: { ...project, messages } },
        messageWrites: changed ? queueWrite(state.messageWrites, projectId, changed) : state.messageWrites,
      };
    }),

  removeMessage: (projectId, messageId) =>
    set((state) => {
      const project = state.byProject[projectId];
      if (!project) return state;
      const pending = { ...(state.messageWrites[projectId] ?? {}) };
      delete pending[messageId];
      return {
        byProject: {
          ...state.byProject,
          [projectId]: { ...project, messages: project.messages.filter((message) => message.id !== messageId) },
        },
        messageWrites: { ...state.messageWrites, [projectId]: pending },
      };
    }),

  mergeMessages: (projectId, incoming) =>
    set((state) => {
      const project = state.byProject[projectId];
      if (!project || incoming.length === 0) return state;
      const byId = new Map(project.messages.map((message) => [message.id, message]));
      for (const message of incoming) byId.set(message.id, message);
      return {
        byProject: {
          ...state.byProject,
          [projectId]: {
            ...project,
            messages: [...byId.values()].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)),
          },
        },
      };
    }),

  replaceChatMessages: (projectId, chatId, messages) =>
    set((state) => {
      const project = state.byProject[projectId];
      if (!project) return state;
      return {
        byProject: {
          ...state.byProject,
          [projectId]: {
            ...project,
            messages: [
              ...project.messages.filter((message) => message.chatId !== chatId),
              ...messages,
            ].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)),
          },
        },
        messageWrites: removeWritesForChat(state.messageWrites, projectId, chatId),
      };
    }),

  pendingMessageWrites: (projectId) => Object.values(get().messageWrites[projectId] ?? {}),

  acknowledgeMessageWrites: (projectId, messages) =>
    set((state) => {
      const pending = { ...(state.messageWrites[projectId] ?? {}) };
      for (const message of messages) {
        if (pending[message.id] === message) delete pending[message.id];
      }
      return { messageWrites: { ...state.messageWrites, [projectId]: pending } };
    }),

  discardMessageWrites: (projectId, chatId) =>
    set((state) => ({ messageWrites: removeWritesForChat(state.messageWrites, projectId, chatId) })),
}));

export function chatJeffs(project: ProjectChats | undefined, chatId: string | null | undefined): ChatJeff[] {
  if (!project || !chatId) return [];
  const chat = project.chats.find((item) => item.id === chatId);
  if (!chat) return [];
  const byId = new Map(project.jeffs.map((jeff) => [jeff.id, jeff]));
  return chat.participantIds.flatMap((id) => byId.get(id) ?? []);
}

export function conversations(project: ProjectChats | undefined): JeffChat[] {
  return project?.chats ?? [];
}

function chatsForJeff(project: ProjectChats | undefined, jeffId: string | null | undefined): JeffChat[] {
  if (!project || !jeffId) return [];
  return project.chats
    .filter((chat) => chat.participantIds.includes(jeffId))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function latestChatForJeff(project: ProjectChats | undefined, jeffId: string | null | undefined): JeffChat | null {
  return chatsForJeff(project, jeffId)[0] ?? null;
}

/** Visible conversation name: a custom title, or the participants' names. */
export function chatDisplayName(project: ProjectChats | undefined, chat: JeffChat | null | undefined, maxNames = 0): string {
  if (!chat) return "";
  const title = chat.name.trim();
  if (title) return title;
  const names = chatJeffs(project, chat.id).map((jeff) => jeff.name);
  // One Jeff is not a participant to name: a conversation without a subject is
  // just a new conversation, never "Jeff".
  if (names.length <= 1) return "Nova conversa";
  if (maxNames > 0 && names.length > maxNames) {
    return `${names.slice(0, maxNames).join(" + ")} +${names.length - maxNames}`;
  }
  return names.join(" + ");
}

function messagesForChat(project: ProjectChats | undefined, chatId: string | null | undefined): ChatMessage[] {
  if (!project || !chatId) return [];
  return project.messages.filter((message) => message.chatId === chatId);
}

/** First meaningful line of a message, used as the session subject. */
export function sessionSubject(text: string): string {
  const clean = text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#>*_`~]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return "";
  return clean.length > 72 ? `${clean.slice(0, 69).trimEnd()}…` : clean;
}

/**
 * What the conversation is about. Explicit titles win; sessions named after
 * their participants (`name = Jeff`) fall back to the first user message, then
 * to the task description, so the list never reads like a Jeff directory.
 */
export function chatSessionTitle(project: ProjectChats | undefined, chat: JeffChat | null | undefined, maxNames = 2): string {
  if (!chat) return "";
  const members = chatJeffs(project, chat.id);
  const participants = members.map((jeff) => jeff.name).join(" + ");
  const fallback = chatDisplayName(project, chat, maxNames);
  const explicit = chat.name.trim();
  const autoNamed = !explicit || explicit === participants || explicit === (members[0]?.name ?? "") || explicit === fallback;
  if (!autoNamed) return explicit;
  const stored = (chat.subject ?? "").trim();
  if (stored) return stored;
  const firstUser = messagesForChat(project, chat.id).find((message) => message.role === "user" && message.content.trim());
  if (firstUser) {
    const legacy = sessionSubject(firstUser.content);
    if (legacy) return legacy;
  }
  const description = sessionSubject(chat.description);
  if (description) return description;
  return fallback;
}
