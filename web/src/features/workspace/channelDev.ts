import type { IconName } from "faang-ui";
import type { WorkspaceFeature } from "../settings/store";

/** The dev tool ids a channel can expose; they match the workbench sidebar. */
export type ChannelDevTool = "files" | "scm" | "db" | "terminal";

export const CHANNEL_DEV_TOOLS: Array<{
  id: ChannelDevTool;
  label: string;
  icon: IconName;
  feature?: WorkspaceFeature;
}> = [
  { id: "files", label: "Explorer", icon: "file", feature: "files" },
  { id: "scm", label: "Source Control", icon: "gitPull", feature: "sourceControl" },
  { id: "db", label: "Databases", icon: "database", feature: "databases" },
  { id: "terminal", label: "Terminal", icon: "code", feature: "terminal" },
];
