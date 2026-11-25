import { create } from "zustand";

interface JeffDraftStore {
  drafts: Record<string, string>;
  setDraft: (key: string, value: string) => void;
  clearDraft: (key: string) => void;
  clearProject: (projectId: string) => void;
}

const STORAGE_PREFIX = "jeff.draft.";

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    // Private mode and hardened browser contexts can deny storage entirely.
    return null;
  }
}

/** Reads only the draft keys, so the store never grows from unrelated storage. */
function readDrafts(): Record<string, string> {
  const store = storage();
  if (!store) return {};
  const drafts: Record<string, string> = {};
  for (let index = 0; index < store.length; index += 1) {
    const storedKey = store.key(index);
    if (!storedKey?.startsWith(STORAGE_PREFIX)) continue;
    const value = store.getItem(storedKey);
    if (value) drafts[storedKey.slice(STORAGE_PREFIX.length)] = value;
  }
  return drafts;
}

/** One write per keystroke: the changed draft only, never the whole map. */
function writeDraft(key: string, value: string): void {
  const store = storage();
  if (!store) return;
  try {
    if (value) store.setItem(`${STORAGE_PREFIX}${key}`, value);
    else store.removeItem(`${STORAGE_PREFIX}${key}`);
  } catch {
    // A full quota must not break typing; the in-memory draft still works.
  }
}

/**
 * Draft text is kept per project, mode and conversation. It lives in the
 * in-memory store while the app is open and in localStorage across the full
 * reload that switches between the dev and Slack surfaces.
 */
export const useJeffDrafts = create<JeffDraftStore>((set, get) => ({
  drafts: readDrafts(),
  setDraft: (key, value) => {
    if ((get().drafts[key] ?? "") === value) return;
    set((state) => {
      const drafts = { ...state.drafts };
      if (value) drafts[key] = value;
      else delete drafts[key];
      return { drafts };
    });
    writeDraft(key, value);
  },
  clearDraft: (key) => {
    writeDraft(key, "");
    if (!(key in get().drafts)) return;
    set((state) => {
      const drafts = { ...state.drafts };
      delete drafts[key];
      return { drafts };
    });
  },
  clearProject: (projectId) => {
    const prefix = `${projectId}:`;
    const keys = Object.keys(get().drafts).filter((key) => key.startsWith(prefix));
    if (keys.length === 0) return;
    for (const key of keys) writeDraft(key, "");
    set((state) => {
      const drafts = { ...state.drafts };
      for (const key of keys) delete drafts[key];
      return { drafts };
    });
  },
}));
