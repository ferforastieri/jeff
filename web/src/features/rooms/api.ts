import { request } from "../../shared/api";

export interface Principal {
  id: string;
  kind: "human" | "bot";
  userId: number | null;
  name: string;
  handle: string;
  avatar: Record<string, unknown>;
  bot: {
    engine?: string;
    model?: string;
    effort?: string;
    title?: string;
    persona?: string;
    folders?: string[];
  } | null;
  createdAt: number;
}

export interface Room {
  id: string;
  projectId: string;
  kind: "room" | "dm";
  name: string;
  title: string;
  instructions: string;
  leadId: string | null;
  isolated: boolean;
  archived: boolean;
  createdAt: number;
  updatedAt: number;
  members: Principal[];
  repos: string[];
  categoryId: string | null;
  visibility: "public" | "private";
}

export interface ChannelCategory {
  id: string;
  name: string;
  position: number;
  createdAt: number;
  updatedAt: number;
}

export interface AgentActivity {
  agentId: string;
  agentName: string;
  roomId: string;
  roomName: string;
  status: string;
}

export interface RoomMessage {
  seq: number;
  id: string;
  roomId: string;
  author: { id: string; name: string; handle: string; kind: string };
  text: string;
  kind: string;
  replyTo: string | null;
  taskId: string | null;
  createdAt: number;
}

export interface CreateRoomBody {
  name: string;
  title?: string;
  instructions?: string;
  leadId?: string | null;
  memberIds?: string[];
  categoryId?: string | null;
  visibility?: "public" | "private";
}

export interface CreateBotBody {
  name: string;
  handle?: string;
  title?: string;
  persona?: string;
  engine?: string;
  model?: string;
  effort?: string;
  proxy?: string;
}

export interface Card {
  id: string;
  projectId: string;
  roomId: string | null;
  messageId: string | null;
  taskId: string | null;
  title: string;
  description: string;
  ownerId: string | null;
  owner: { id: string; name: string; handle: string; kind: string } | null;
  dueAt: number | null;
  priority: string;
  attachments: unknown;
  column: string;
  createdBy: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface CreateCardBody {
  title: string;
  description?: string;
  ownerId?: string | null;
  dueAt?: number | null;
  priority?: string;
  roomId?: string | null;
  messageId?: string | null;
}

export type Schedule =
  | { kind: "hourly"; minute: number }
  | { kind: "daily"; time: string }
  | { kind: "weekdays"; time: string }
  | { kind: "weekly"; weekday: number; time: string }
  | { kind: "monthly"; day: number; time: string }
  | { kind: "interval"; amount: number; unit: "minutes" | "hours" | "days"; anchorAt: number }
  | { kind: "advanced"; months: number[]; days: unknown; time: unknown }
  | { kind: "custom"; expression: string }
  | { kind: "once"; date: string; time: string };

export interface Routine {
  id: string;
  projectId: string;
  roomId: string;
  agentId: string;
  name: string;
  instruction: string;
  active: boolean;
  timezone: string;
  limitPolicy: string;
  missedPolicy: string;
  trigger: { id: string; schedule: Schedule; nextRunAt: number | null };
  createdAt: number;
  updatedAt: number;
}

export interface RoutineRun {
  id: string;
  routineId: string;
  triggerId: string | null;
  agentId: string;
  roomId: string;
  kind: string;
  source: string | null;
  scheduledFor: number;
  routineName: string;
  instruction: string;
  status: string;
  error: string;
  deliveryId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface CreateRoutineBody {
  agentId: string;
  name: string;
  instruction: string;
  schedule: Schedule;
  timezone: string;
  active?: boolean;
}

export interface Memory {
  id: string;
  agentId: string;
  text: string;
  origin: string;
  sourceMessageId: string | null;
  site: string | null;
  inclusion: "essential" | "searchable";
  userControlled: boolean;
  revision: number;
  createdAt: number;
  updatedAt: number;
}

const base = (project: string) => `/projects/${encodeURIComponent(project)}/rooms`;
const channels = "/channels";
const json = (body: unknown) => ({
  method: "POST",
  body: JSON.stringify(body),
});

export const channelsApi = {
  list: () => request<{ rooms: Room[] }>(channels),
  create: (body: CreateRoomBody) => request<Room>(channels, json(body)),
  messages: (roomId: string, before?: number) =>
    request<{ messages: RoomMessage[] }>(
      `${channels}/${encodeURIComponent(roomId)}/messages${before ? `?before=${before}` : ""}`,
    ),
  send: (roomId: string, body: { text: string; recipientIds?: string[] }) =>
    request<{ message: RoomMessage; deliveries: number }>(
      `${channels}/${encodeURIComponent(roomId)}/messages`,
      json(body),
    ),
  setRepos: (roomId: string, repos: string[]) =>
    request<Room>(`${channels}/${encodeURIComponent(roomId)}/repos`, {
      method: "PUT",
      body: JSON.stringify({ repos }),
    }),
  setAgents: (roomId: string, agentIds: string[]) =>
    request<Room>(`${channels}/${encodeURIComponent(roomId)}/agents`, {
      method: "PUT",
      body: JSON.stringify({ agentIds }),
    }),
  addAgent: (roomId: string, agentId: string) =>
    request<{ ok: boolean }>(`${channels}/${encodeURIComponent(roomId)}/agents`, json({ agentId })),
  categories: () => request<{ categories: ChannelCategory[] }>("/channel-categories"),
  createCategory: (name: string) => request<ChannelCategory>("/channel-categories", json({ name })),
  renameCategory: (id: string, name: string) =>
    request<ChannelCategory>(`/channel-categories/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ name }),
    }),
  deleteCategory: (id: string) =>
    request<{ ok: boolean }>(`/channel-categories/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
  remove: (roomId: string) =>
    request<{ ok: boolean }>(`${channels}/${encodeURIComponent(roomId)}`, {
      method: "DELETE",
    }),
  setCategory: (roomId: string, categoryId: string | null) =>
    request<Room>(`${channels}/${encodeURIComponent(roomId)}/category`, {
      method: "PUT",
      body: JSON.stringify({ categoryId }),
    }),
  openDm: (botId: string) =>
    request<Room>(`${channels}/dm`, json({ botId })),
  setAccess: (roomId: string, userId: number, allowed: boolean) =>
    request<{ ok: boolean; allowed: boolean }>(
      `${channels}/${encodeURIComponent(roomId)}/access`,
      { method: "PUT", body: JSON.stringify({ userId, allowed }) },
    ),
};

export const roomsApi = {
  principals: () => request<{ me: Principal; bots: Principal[] }>("/principals"),
  activity: () => request<{ agents: AgentActivity[] }>("/agent-activity"),
  createBot: (body: CreateBotBody) => request<Principal>("/principals", json(body)),
  updateBot: (id: string, body: CreateBotBody) =>
    request<Principal>(`/principals/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  list: (project: string) => request<{ rooms: Room[] }>(base(project)),
  create: (project: string, body: CreateRoomBody) =>
    request<Room>(base(project), json(body)),
  get: (project: string, roomId: string) =>
    request<Room>(`${base(project)}/${encodeURIComponent(roomId)}`),
  messages: (project: string, roomId: string, before?: number) =>
    request<{ messages: RoomMessage[] }>(
      `${base(project)}/${encodeURIComponent(roomId)}/messages${before ? `?before=${before}` : ""}`,
    ),
  send: (project: string, roomId: string, body: { text: string; recipientIds?: string[] }) =>
    request<{ message: RoomMessage; deliveries: number }>(
      `${base(project)}/${encodeURIComponent(roomId)}/messages`,
      json(body),
    ),
  addMember: (project: string, roomId: string, principalId: string) =>
    request<Principal>(`${base(project)}/${encodeURIComponent(roomId)}/members`, json({ principalId })),
  setRepos: (project: string, roomId: string, repos: string[]) =>
    request<Room>(`${base(project)}/${encodeURIComponent(roomId)}/repos`, {
      method: "PUT",
      body: JSON.stringify({ repos }),
    }),
  setQueue: (project: string, roomId: string, paused: boolean) =>
    request<{ ok: boolean; paused: boolean }>(
      `${base(project)}/${encodeURIComponent(roomId)}/queue`,
      json({ paused }),
    ),
  cards: (project: string) =>
    request<{ cards: Card[] }>(`/projects/${encodeURIComponent(project)}/cards`),
  createCard: (project: string, body: CreateCardBody) =>
    request<Card>(`/projects/${encodeURIComponent(project)}/cards`, json(body)),
  moveCard: (project: string, cardId: string, column: string) =>
    request<Card>(
      `/projects/${encodeURIComponent(project)}/cards/${encodeURIComponent(cardId)}/move`,
      json({ column }),
    ),
  updateCard: (
    project: string,
    cardId: string,
    body: Partial<Omit<CreateCardBody, "roomId" | "messageId">> & { column?: string },
  ) =>
    request<Card>(`/projects/${encodeURIComponent(project)}/cards/${encodeURIComponent(cardId)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deleteCard: (project: string, cardId: string) =>
    request<{ ok: boolean }>(
      `/projects/${encodeURIComponent(project)}/cards/${encodeURIComponent(cardId)}`,
      { method: "DELETE" },
    ),
  routines: (project: string, roomId: string) =>
    request<{ routines: Routine[] }>(
      `${base(project)}/${encodeURIComponent(roomId)}/routines`,
    ),
  projectRoutines: (project: string) =>
    request<{ routines: Routine[] }>(`/projects/${encodeURIComponent(project)}/routines`),
  createRoutine: (project: string, roomId: string, body: CreateRoutineBody) =>
    request<Routine>(`${base(project)}/${encodeURIComponent(roomId)}/routines`, json(body)),
  updateRoutine: (
    project: string,
    routineId: string,
    body: Partial<Omit<CreateRoutineBody, "agentId">>,
  ) =>
    request<Routine>(
      `/projects/${encodeURIComponent(project)}/routines/${encodeURIComponent(routineId)}`,
      { method: "PATCH", body: JSON.stringify(body) },
    ),
  deleteRoutine: (project: string, routineId: string) =>
    request<{ ok: boolean }>(
      `/projects/${encodeURIComponent(project)}/routines/${encodeURIComponent(routineId)}`,
      { method: "DELETE" },
    ),
  testRoutine: (project: string, routineId: string) =>
    request<RoutineRun>(
      `/projects/${encodeURIComponent(project)}/routines/${encodeURIComponent(routineId)}/test`,
      { method: "POST" },
    ),
  routineRuns: (project: string, routineId: string) =>
    request<{ runs: RoutineRun[] }>(
      `/projects/${encodeURIComponent(project)}/routines/${encodeURIComponent(routineId)}/runs`,
    ),
  memories: (agentId: string, query?: string) =>
    request<{ memories: Memory[] }>(
      `/principals/${encodeURIComponent(agentId)}/memories${
        query ? `?q=${encodeURIComponent(query)}` : ""
      }`,
    ),
  createMemory: (
    agentId: string,
    body: { text: string; inclusion?: "essential" | "searchable"; site?: string },
  ) =>
    request<Memory>(`/principals/${encodeURIComponent(agentId)}/memories`, json(body)),
  updateMemory: (
    memoryId: string,
    body: { text?: string; inclusion?: "essential" | "searchable" },
  ) =>
    request<Memory>(`/memories/${encodeURIComponent(memoryId)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deleteMemory: (memoryId: string) =>
    request<{ ok: boolean }>(`/memories/${encodeURIComponent(memoryId)}`, {
      method: "DELETE",
    }),
};
