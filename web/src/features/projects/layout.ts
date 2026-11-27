import type { Tab } from "../../app/store";
import type { WorkspaceFeature } from "../settings/store";

/** The workspace feature a tab depends on, or null when it has none. */
export function tabFeature(tab: Tab): WorkspaceFeature | null {
  switch (tab.kind) {
    case "editor":
    case "diff": return "files";
    case "db": return "databases";
    case "web": return "webApps";
    case "ai": return "bots";
    default: return null;
  }
}

/** Sanitizes the tabs saved in a project layout before restoring them. */
export function restoredLayoutTabs(
  saved: unknown,
  enabled: (feature: WorkspaceFeature) => boolean,
): Tab[] {
  return (Array.isArray(saved) ? (saved as Tab[]) : []).filter(
    (tab) =>
      tab &&
      typeof tab.id === "string" &&
      (tab.kind === "ai" ? typeof tab.chatId === "string" : enabled("tabs")) &&
      ["editor", "db", "web", "diff", "ai"].includes(tab.kind) &&
      (!tabFeature(tab) || enabled(tabFeature(tab)!)),
  );
}
