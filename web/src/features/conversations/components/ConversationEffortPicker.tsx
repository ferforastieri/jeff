import { useState } from "react";
import { Check, ChevronDown } from "@jeff/icons";
import { cx } from "@jeff/ui";
import { defaultModel, findModel, useAI } from "../../providers/store";
import { effortLabel } from "../../providers/components/ModelPicker";
import { useChats, type ChatJeff, type JeffChat } from "../store";
import ComposerMenu from "./ComposerMenu";

interface Props {
  projectId: string;
  chat: JeffChat;
  jeffs: ChatJeff[];
  /** Outside a stored chat (an agent in a room), save the pick here instead. */
  onChange?: (effort: string) => void;
}

/** The conversation's reasoning effort, always beside the model's ring. */
export default function ConversationEffortPicker({ projectId, chat, jeffs, onChange }: Props) {
  const models = useAI((state) => state.models);
  const config = useAI((state) => state.config);
  const updateChatJeff = useChats((state) => state.updateChatJeff);
  const [open, setOpen] = useState(false);
  const member = jeffs[0] ?? null;
  if (!member) return null;

  const override = chat.jeffSettings?.[member.id] ?? {};
  const model = override.model || member.model || defaultModel(models, config);
  const effort = override.effort ?? member.effort ?? "";
  const variants = findModel(models, model)?.variants ?? [];

  return (
    <ComposerMenu
      label="Esforço"
      isOpen={open}
      onOpenChange={setOpen}
      trigger={
        <>
          <span className="truncate text-text-tertiary">{effortLabel(effort)}</span>
          <ChevronDown size={12} className="size-3 shrink-0 text-text-tertiary" />
        </>
      }
      triggerClassName="max-w-[110px]"
      popoverClassName="w-[236px] p-1"
    >
      {(close) => (
        <div className="flex flex-col gap-0.5">
          <p className="px-2 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">Esforço</p>
          {variants.length === 0 ? (
            <p className="px-2 py-2 text-caption-1-regular text-text-tertiary">
              Este modelo não oferece níveis de esforço.
            </p>
          ) : variants.map((variant) => {
            const active = variant === effort;
            return (
              <button
                key={variant}
                type="button"
                onClick={() => {
                  if (onChange) onChange(variant);
                  else updateChatJeff(projectId, chat.id, member.id, { effort: variant });
                  close();
                }}
                className={cx(
                  "flex items-center gap-2 rounded-lg px-2 py-1.5 text-start text-caption-1-medium transition-colors",
                  active ? "bg-background-primary-hover text-text-primary" : "text-text-secondary hover:bg-background-primary-hover hover:text-text-primary",
                )}
              >
                <span className="min-w-0 flex-1 truncate">{effortLabel(variant)}</span>
                {active ? <Check size={13} className="shrink-0 text-accent-500" /> : null}
              </button>
            );
          })}
        </div>
      )}
    </ComposerMenu>
  );
}
