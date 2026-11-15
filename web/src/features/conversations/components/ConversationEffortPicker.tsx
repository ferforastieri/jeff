import { useState } from "react";
import { Check, ChevronDown } from "@toph/icons";
import { cx } from "@toph/ui";
import { defaultModel, findModel, useAI } from "../../providers/store";
import { effortLabel } from "../../providers/components/ModelPicker";
import { useChats, type ChatToph, type TophChat } from "../store";
import ComposerMenu from "./ComposerMenu";

interface Props {
  projectId: string;
  chat: TophChat;
  tophs: ChatToph[];
}

/** The conversation's reasoning effort, always beside the model's ring. */
export default function ConversationEffortPicker({ projectId, chat, tophs }: Props) {
  const models = useAI((state) => state.models);
  const config = useAI((state) => state.config);
  const updateChatToph = useChats((state) => state.updateChatToph);
  const [open, setOpen] = useState(false);
  const member = tophs[0] ?? null;
  if (!member) return null;

  const override = chat.tophSettings?.[member.id] ?? {};
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
      popoverClassName="w-[168px] p-1"
    >
      {(close) => (
        <div className="flex flex-col gap-0.5">
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
                  updateChatToph(projectId, chat.id, member.id, { effort: variant });
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
