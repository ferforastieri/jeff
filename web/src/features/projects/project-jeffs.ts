import { create } from "zustand";
import { api } from "../../shared/api";
import { useChats, type ChatJeff, type ProjectChats } from "../conversations/store";
import type { BotAvatar } from "../agents/avatars";

export interface ProjectJeffSummary {
  id: string;
  name: string;
  role: string;
  color: string;
  avatar: BotAvatar;
}

const CACHE_KEY = "jeff_project_jeffs";

function isSummary(value: unknown): value is ProjectJeffSummary {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<ProjectJeffSummary>;
  return typeof item.id === "string"
    && typeof item.name === "string"
    && typeof item.avatar === "string";
}

function readCache(): Record<string, ProjectJeffSummary> {
  try {
    const raw = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "{}") as unknown;
    if (!raw || typeof raw !== "object") return {};
    return Object.fromEntries(
      Object.entries(raw).filter((entry): entry is [string, ProjectJeffSummary] => isSummary(entry[1])),
    );
  } catch {
    return {};
  }
}

function persistCache(summaries: Record<string, ProjectJeffSummary>): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(summaries));
  } catch {
    // The cache is a convenience; ignore storage failures.
  }
}

/** The Jeff that owns the project's current task. Groups fall back to their first member. */
export function activeJeffFromChats(chats: ProjectChats | undefined | null): ChatJeff | null {
  if (!chats?.jeffs?.length) return null;
  const active = chats.chats.find((chat) => chat.id === chats.activeChatId);
  const latest = [...(chats.chats ?? [])].sort((a, b) => b.updatedAt - a.updatedAt)[0];
  const chat = active ?? latest;
  const participant = chat?.participantIds[0];
  return chats.jeffs.find((jeff) => jeff.id === participant) ?? chats.jeffs[0] ?? null;
}

function summaryOf(jeff: ChatJeff): ProjectJeffSummary {
  return {
    id: jeff.id,
    name: jeff.name,
    role: jeff.role,
    color: jeff.color,
    avatar: jeff.avatar,
  };
}

interface ProjectJeffState {
  summaries: Record<string, ProjectJeffSummary>;
  attempted: Record<string, boolean>;
  remember: (projectId: string, chats: ProjectChats | undefined | null) => void;
  ensure: (projectId: string) => Promise<void>;
}

const inflight = new Set<string>();

export const useProjectJeffs = create<ProjectJeffState>((set, get) => ({
  summaries: readCache(),
  attempted: {},

  remember: (projectId, chats) => {
    if (!chats) return;
    const ready = chats.hydrated === true || (chats.jeffs?.length ?? 0) > 0;
    if (!ready) return;
    const jeff = activeJeffFromChats(chats);
    if (!jeff) {
      if (!get().attempted[projectId]) {
        set((state) => ({ attempted: { ...state.attempted, [projectId]: true } }));
      }
      return;
    }
    const summary = summaryOf(jeff);
    const current = get().summaries[projectId];
    const same = current
      && current.id === summary.id
      && current.name === summary.name
      && current.role === summary.role
      && current.color === summary.color
      && current.avatar === summary.avatar;
    if (same) return;
    const summaries = { ...get().summaries, [projectId]: summary };
    persistCache(summaries);
    set((state) => ({
      summaries,
      attempted: { ...state.attempted, [projectId]: true },
    }));
  },

  ensure: async (projectId) => {
    if (get().attempted[projectId] || inflight.has(projectId)) return;
    const loaded = useChats.getState().byProject[projectId];
    if (loaded?.hydrated) {
      get().remember(projectId, loaded);
      return;
    }
    inflight.add(projectId);
    try {
      const layout = await api.layout(projectId);
      const chats = layout.chats as ProjectChats | undefined | null;
      get().remember(projectId, chats);
      if (!chats?.jeffs?.length) {
        set((state) => ({ attempted: { ...state.attempted, [projectId]: true } }));
      }
    } catch {
      // Keep the cached summary and allow a retry on the next mount.
    } finally {
      inflight.delete(projectId);
    }
  },
}));

