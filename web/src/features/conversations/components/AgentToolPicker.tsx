import { useState } from "react";
import { ChevronDown, Globe2, TerminalSquare } from "@jeff/icons";
import ComposerMenu from "./ComposerMenu";

interface Props {
  tool: "browser" | "terminal";
  onOpen: () => void;
  disabled?: boolean;
}

/** A browser/terminal control in the composer, shaped like the old mode picker. */
export default function AgentToolPicker({ tool, onOpen, disabled = false }: Props) {
  const [open, setOpen] = useState(false);
  const browser = tool === "browser";
  const label = browser ? "Navegador" : "Terminal";
  const hint = browser
    ? "A página que o agente está usando, ao vivo"
    : "O terminal que o agente está usando, ao vivo";

  return (
    <ComposerMenu
      label={label}
      isOpen={open}
      onOpenChange={setOpen}
      trigger={
        <>
          {browser ? <Globe2 size={13} className="size-3.5 shrink-0" /> : <TerminalSquare size={13} className="size-3.5 shrink-0" />}
          <span className="truncate">{label}</span>
          <ChevronDown size={12} className="size-3 shrink-0 text-text-tertiary" />
        </>
      }
      triggerClassName="max-w-[168px]"
      popoverClassName="w-[248px] p-1"
    >
      {(close) => (
        <div className="flex flex-col gap-0.5">
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              onOpen();
              close();
            }}
            className="flex items-start gap-2 rounded-lg px-2 py-1.5 text-start transition-colors hover:bg-background-primary-hover disabled:opacity-50"
          >
            <span className="min-w-0 flex-1">
              <span className="block text-caption-1-medium text-text-primary">Abrir e controlar</span>
              <span className="block text-[10px] leading-snug text-text-tertiary">{hint}</span>
            </span>
          </button>
        </div>
      )}
    </ComposerMenu>
  );
}
