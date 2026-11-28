import { useChats, type ChatJeff, type JeffPreset } from "../conversations/store";

/** The one Jeff a project has: the logo's mascot, ready for its first task. */
export const DEFAULT_JEFF: JeffPreset = {
  name: "Jeff",
  role: "Jeff",
  description: "",
  personality: "",
  prompt: "",
  color: "#0063D1",
  avatar: "jeff-logo",
  permissionMode: "yolo",
  mcpServers: [],
  emailAccountIds: [],
  language: "auto",
};

/** The project's Jeff, created with the defaults when the project has none. */
export function ensureJeff(projectId: string): ChatJeff | null {
  const project = useChats.getState().ensure(projectId);
  const existing = project.jeffs[0];
  if (existing) return existing;
  return useChats.getState().createJeff(projectId, DEFAULT_JEFF);
}

function fixedJeffPatch(jeff: ChatJeff): Partial<ChatJeff> {
  const patch: Partial<ChatJeff> = {};
  if (jeff.name !== DEFAULT_JEFF.name || jeff.handle !== "jeff") patch.name = DEFAULT_JEFF.name;
  if (jeff.role !== DEFAULT_JEFF.role) patch.role = DEFAULT_JEFF.role;
  if (jeff.description !== DEFAULT_JEFF.description) patch.description = DEFAULT_JEFF.description;
  if (jeff.personality !== DEFAULT_JEFF.personality) patch.personality = DEFAULT_JEFF.personality;
  if (jeff.prompt !== DEFAULT_JEFF.prompt) patch.prompt = DEFAULT_JEFF.prompt;
  if (jeff.model !== "") patch.model = "";
  if (jeff.effort !== "") patch.effort = "";
  if (jeff.mcpServers.length > 0) patch.mcpServers = [];
  if (jeff.emailAccountIds.length > 0) patch.emailAccountIds = [];
  if (jeff.color !== DEFAULT_JEFF.color) patch.color = DEFAULT_JEFF.color;
  if (jeff.avatar !== DEFAULT_JEFF.avatar) patch.avatar = DEFAULT_JEFF.avatar;
  return patch;
}

/**
 * Keeps exactly one Jeff per project: the logo's mascot. Extra Jeffs and the
 * tasks that belonged only to them are removed, and the kept Jeff is reset to
 * the fixed identity so the global model, MCP and email settings apply.
 */
export function ensureSingleJeff(projectId: string): { jeff: ChatJeff | null; removedIds: string[] } {
  const project = useChats.getState().ensure(projectId);
  if (!project.hydrated) return { jeff: project.jeffs[0] ?? null, removedIds: [] };

  const keep = project.jeffs.find((jeff) => jeff.avatar === DEFAULT_JEFF.avatar) ?? project.jeffs[0] ?? null;
  if (!keep) return { jeff: ensureJeff(projectId), removedIds: [] };

  const removedIds = project.jeffs.filter((jeff) => jeff.id !== keep.id).map((jeff) => jeff.id);
  for (const id of removedIds) useChats.getState().removeJeff(projectId, id);

  const patch = fixedJeffPatch(keep);
  if (Object.keys(patch).length > 0) useChats.getState().updateJeff(projectId, keep.id, patch);

  return {
    jeff: useChats.getState().byProject[projectId]?.jeffs.find((jeff) => jeff.id === keep.id) ?? null,
    removedIds,
  };
}
