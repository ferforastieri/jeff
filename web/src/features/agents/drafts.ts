import { create } from "zustand";

interface JeffDraftStore {
  drafts: Record<string, string>;
  setDraft: (key: string, value: string) => void;
  clearDraft: (key: string) => void;
  clearProject: (projectId: string) => void;
}

/** Draft text is kept per project, mode, Jeff and session while the app is open. */
export const useJeffDrafts = create<JeffDraftStore>((set) => ({
  drafts: {},
  setDraft: (key, value) =>
    set((state) => ({ drafts: { ...state.drafts, [key]: value } })),
  clearDraft: (key) =>
    set((state) => {
      const drafts = { ...state.drafts };
      delete drafts[key];
      return { drafts };
    }),
  clearProject: (projectId) =>
    set((state) => {
      const prefix = `${projectId}:`;
      const drafts = Object.fromEntries(
        Object.entries(state.drafts).filter(([key]) => !key.startsWith(prefix)),
      );
      return { drafts };
    }),
}));
