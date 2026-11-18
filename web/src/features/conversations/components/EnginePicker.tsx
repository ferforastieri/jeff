import { useEffect, useState } from "react";
import { Check, ChevronDown, TerminalSquare } from "@toph/icons";
import { cx } from "@toph/ui";
import { engineApi, type EngineInfo } from "../../agents/api";
import { useAI } from "../../providers/store";
import { useChats, type ChatToph, type TophChat } from "../store";
import ComposerMenu from "./ComposerMenu";

interface Props {
  projectId: string;
  chat: TophChat;
  tophs: ChatToph[];
}

/** Picks which installed CLI drives this conversation. OpenCode stays the default. */
export default function EnginePicker({ projectId, chat, tophs }: Props) {
  const [engines, setEngines] = useState<EngineInfo[]>([]);
  const [open, setOpen] = useState(false);
  const updateChatToph = useChats((state) => state.updateChatToph);

  useEffect(() => {
    let cancelled = false;
    void engineApi
      .list()
      .then((all) => {
        if (!cancelled) setEngines(all.filter((item) => item.supported && item.installed));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const member = tophs[0] ?? null;
  if (!member) return null;
  const override = chat.tophSettings?.[member.id] ?? {};
  const engine = override.engine || member.engine || "opencode";
  const current = engines.find((item) => item.id === engine);
  const label = current?.label ?? (engine === "opencode" ? "OpenCode" : engine);

  async function choose(next: EngineInfo) {
    const toph = member!;
    updateChatToph(projectId, chat.id, toph.id, { engine: next.id, model: "", effort: "" });
    // A different CLI has a different catalogue: load it and pick its first model.
    await useAI.getState().loadModels(next.id);
    const models = useAI.getState().models;
    if (models.length > 0) {
      updateChatToph(projectId, chat.id, toph.id, { model: models[0]!.id });
    }
    setOpen(false);
  }

  return (
    <ComposerMenu
      label="Motor do agente"
      isOpen={open}
      onOpenChange={setOpen}
      trigger={
        <>
          <TerminalSquare size={12} className="size-3 shrink-0 text-text-tertiary" />
          <span className="max-w-[90px] truncate">{label}</span>
          <ChevronDown size={12} className="size-3 shrink-0 text-text-tertiary" />
        </>
      }
      triggerClassName="max-w-[130px]"
      popoverClassName="w-[210px] p-1"
    >
      {(close) => (
        <div className="flex flex-col gap-0.5">
          {engines.length === 0 ? (
            <p className="px-2 py-2 text-caption-1-regular text-text-tertiary">
              Nenhum motor instalado. Instale um CLI em Configurações → Harness.
            </p>
          ) : engines.map((item) => {
            const active = item.id === engine;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => { void choose(item); close(); }}
                className={cx(
                  "flex items-center gap-2 rounded-lg px-2 py-1.5 text-start text-caption-1-medium transition-colors",
                  active ? "bg-background-primary-hover text-text-primary" : "text-text-secondary hover:bg-background-primary-hover hover:text-text-primary",
                )}
              >
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {active ? <Check size={13} className="shrink-0 text-accent-500" /> : null}
              </button>
            );
          })}
        </div>
      )}
    </ComposerMenu>
  );
}
