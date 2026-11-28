import { useMemo, useState } from "react";
import type { AIModel } from "../../shared/api";
import { roomsApi, type Principal } from "../rooms/api";
import type { ChatJeff, JeffChat } from "../conversations/store";
import ChatModelUsage from "../conversations/components/ChatModelUsage";
import ConversationEffortPicker from "../conversations/components/ConversationEffortPicker";

interface Props {
  agent: Principal;
  models: AIModel[];
  onUpdated: (agent: Principal) => void;
  onConnect: () => void;
}

/** The same model, effort and usage controls the dev composer uses. */
export default function AgentComposerControls({ agent, models, onUpdated, onConnect }: Props) {
  const bot = agent.bot ?? {};
  const [error, setError] = useState("");

  // The dev controls are bound to a chat/participant. A room's agent has the
  // same fields, so these lightweight views let both surfaces share the same
  // modals instead of growing a second set of pickers.
  const member = useMemo(() => ({
    id: agent.id,
    name: agent.name,
    handle: agent.handle,
    role: bot.title ?? "",
    description: "",
    personality: "",
    prompt: "",
    model: bot.model ?? "",
    engine: bot.engine ?? "opencode",
    effort: bot.effort ?? "",
    permissionMode: "ask",
    mcpServers: [],
    emailAccountIds: [],
    language: "pt-BR",
    color: "",
    avatar: agent.avatar,
    notifications: false,
    createdAt: agent.createdAt,
  }) as unknown as ChatJeff, [agent, bot.effort, bot.engine, bot.model, bot.title]);

  const chat = useMemo(() => ({
    id: agent.id,
    name: "",
    subject: "",
    description: "",
    participantIds: [agent.id],
    jeffSettings: {},
    createdAt: 0,
    updatedAt: 0,
  }) as JeffChat, [agent.id]);

  async function save(patch: { model?: string; effort?: string; engine?: string }) {
    setError("");
    try {
      const nextModel = patch.model ?? bot.model ?? "";
      const found = models.find((item) => item.id === nextModel);
      const nextEngine = patch.engine ?? found?.engine ?? bot.engine ?? "opencode";
      const currentEffort = patch.effort ?? bot.effort ?? "";
      const nextEffort = found && !found.variants?.includes(currentEffort) && patch.model !== undefined
        ? ""
        : currentEffort;
      const updated = await roomsApi.updateBot(agent.id, {
        name: agent.name,
        handle: agent.handle,
        title: bot.title ?? "",
        persona: bot.persona ?? "",
        engine: nextEngine,
        model: nextModel,
        effort: nextEffort,
      });
      onUpdated(updated);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível salvar o modelo.");
    }
  }

  if (models.length === 0) {
    return (
      <button type="button" className="ac-composer__pill" onClick={onConnect}>
        Conectar IA
      </button>
    );
  }

  return (
    <>
      <ChatModelUsage
        projectId={agent.id}
        chat={chat}
        jeffs={[member]}
        chatName={agent.name}
        onChange={(patch) => void save(patch)}
      />
      <ConversationEffortPicker
        projectId={agent.id}
        chat={chat}
        jeffs={[member]}
        onChange={(effort) => void save({ effort })}
      />
      {error ? <span className="text-caption-2-regular text-status-rose-text">{error}</span> : null}
    </>
  );
}
