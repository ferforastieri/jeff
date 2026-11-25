import { create } from "zustand";
import { api } from "./api";

/** What follows the person across browsers and the phone (stored in SQLite). */
export interface WorkspacePreferences {
  navOrder?: string[];
  devToolOrder?: string[];
  homeWidgets?: unknown;
  userStatus?: string;
  taskLayout?: "board" | "list";
  driveView?: "grid" | "list";
  sidebarSections?: Partial<Record<"channels" | "agents" | "dms", boolean>>;
  sidebarCategories?: Record<string, boolean>;
  sidebarSectionOrder?: ("channels" | "agents" | "dms")[];
}

const DEFAULTS: WorkspacePreferences = {
  navOrder: ["home", "tasks", "calendar", "drive", "wiki"],
  devToolOrder: ["files", "bots", "scm", "db", "web"],
  homeWidgets: null,
  userStatus: "online",
  sidebarSectionOrder: ["channels", "agents", "dms"],
  taskLayout: "board",
  driveView: "grid",
};

let saveTimer: number | undefined;

interface PrefsStore {
  prefs: WorkspacePreferences;
  loaded: boolean;
  loading: boolean;
  load: () => Promise<void>;
  update: (patch: Partial<WorkspacePreferences>) => void;
}

function saveSoon(prefs: WorkspacePreferences) {
  if (saveTimer) window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    void api.savePreferences(prefs as Record<string, unknown>).catch(() => undefined);
  }, 350);
}

export const usePrefs = create<PrefsStore>((set, get) => ({
  prefs: DEFAULTS,
  loaded: false,
  loading: false,
  async load() {
    if (get().loading || get().loaded) return;
    set({ loading: true });
    try {
      const result = await api.preferences();
      const saved = result.preferences as WorkspacePreferences;
      set({
        prefs: {
          ...DEFAULTS,
          ...saved,
          navOrder: Array.isArray(saved.navOrder) ? saved.navOrder : DEFAULTS.navOrder,
          devToolOrder: Array.isArray(saved.devToolOrder) ? saved.devToolOrder : DEFAULTS.devToolOrder,
          taskLayout: saved.taskLayout === "list" ? "list" : "board",
          driveView: saved.driveView === "list" ? "list" : "grid",
          userStatus:
            saved.userStatus === "away" ||
            saved.userStatus === "busy" ||
            saved.userStatus === "offline" ||
            saved.userStatus === "online"
              ? saved.userStatus
              : "online",
        },
        loaded: true,
        loading: false,
      });
    } catch {
      set({ loaded: true, loading: false });
    }
  },
  update(patch) {
    const next = { ...get().prefs, ...patch };
    set({ prefs: next });
    saveSoon(next);
  },
}));
