import { useState } from "react";
import { Check, ChevronDown } from "@jeff/icons";
import { cx } from "@jeff/ui";
import { useChats, type ChatJeff, type JeffChat, type JeffChatMode } from "../store";
import ComposerMenu from "./ComposerMenu";

interface Props {
  projectId: string;
  chat: JeffChat;
  jeffs: ChatJeff[];
}

const MODES: Array<{ id: JeffChatMode; label: string; hint: string }> = [
  { id: "plan", label: "Plano", hint: "Investiga e propõe antes de mexer" },
  { id: "build", label: "Construção", hint: "Implementa e verifica no projeto" },
  { id: "debug", label: "Debug", hint: "Investiga com terminal e browser visíveis" },
];

/** Plan, build or debug: what this conversation asks the Jeff to do. */
export default function ConversationModePicker({ projectId, chat, jeffs }: Props) {
  const updateChat = useChats((state) => state.updateChat);
  const [open, setOpen] = useState(false);
  const member = jeffs[0] ?? null;
  if (!member) return null;
  const current: JeffChatMode = chat.mode ?? member.agentMode ?? "build";
  const selected = MODES.find((mode) => mode.id === current) ?? MODES[1];

  return (
    <ComposerMenu
      label="Modo da conversa"
      isOpen={open}
      onOpenChange={setOpen}
      trigger={
        <>
          <span className="truncate text-text-tertiary">{selected.label}</span>
          <ChevronDown size={12} className="size-3 shrink-0 text-text-tertiary" />
        </>
      }
      triggerClassName="max-w-[118px]"
      popoverClassName="w-[236px] p-1"
    >
      {(close) => (
        <div className="flex flex-col gap-0.5">
          <p className="px-2 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">Modo</p>
          {MODES.map((mode) => {
            const active = mode.id === current;
            return (
              <button
                key={mode.id}
                type="button"
                onClick={() => {
                  updateChat(projectId, chat.id, { mode: mode.id });
                  close();
                }}
                className={cx(
                  "flex items-start gap-2 rounded-lg px-2 py-1.5 text-start transition-colors",
                  active ? "bg-background-primary-hover" : "hover:bg-background-primary-hover",
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className={cx("block text-caption-1-medium", active ? "text-text-primary" : "text-text-secondary")}>{mode.label}</span>
                  <span className="block text-[10px] leading-snug text-text-tertiary">{mode.hint}</span>
                </span>
                {active ? <Check size={13} className="mt-1 shrink-0 text-accent-500" /> : null}
              </button>
            );
          })}
        </div>
      )}
    </ComposerMenu>
  );
}
