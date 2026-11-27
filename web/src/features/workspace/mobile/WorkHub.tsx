import {
  BookOpen,
  ChevronRight,
  HardDrive,
  MenuBars,
  Rows3,
  Search,
  Timer,
} from "@jeff/icons";
import type { ComponentType } from "react";
import MobileScreenHeader from "../../../app/layouts/mobile/components/MobileScreenHeader";
import MobileIconButton from "../../../app/layouts/mobile/components/MobileIconButton";

type WorkView = "tasks" | "calendar" | "drive" | "wiki";

interface Props {
  workspaceName: string;
  onOpenView: (view: WorkView) => void;
  onOpenSearch: () => void;
  onMenu: () => void;
}

const TOOLS: Array<{ id: WorkView; label: string; hint: string; icon: ComponentType<{ className?: string }> }> = [
  { id: "tasks", label: "Tarefas", hint: "O quadro do workspace", icon: Rows3 },
  { id: "calendar", label: "Calendário", hint: "Rotinas e eventos", icon: Timer },
  { id: "drive", label: "Drive", hint: "Arquivos do servidor", icon: HardDrive },
  { id: "wiki", label: "Wiki", hint: "Documentação do time", icon: BookOpen },
];

/** Trabalho: the workspace tools (tasks, calendar, drive and wiki). */
export default function WorkHub({ workspaceName, onOpenView, onOpenSearch, onMenu }: Props) {
  return (
    <div className="m-screen">
      <MobileScreenHeader
        variant="title"
        title="Trabalho"
        subtitle={workspaceName}
        lead={<MobileIconButton icon={MenuBars} label="Abrir navegação" onClick={onMenu} />}
        actions={<MobileIconButton icon={Search} label="Buscar" onClick={onOpenSearch} />}
      />
      <div className="m-scroll">
        <div className="m-toolgrid m-toolgrid--workspace">
          {TOOLS.map((tool) => {
            const Icon = tool.icon;
            return (
              <button key={tool.id} type="button" className="m-tool" onClick={() => onOpenView(tool.id)}>
                <span className="m-tool__icon"><Icon className="m-tool__glyph" /></span>
                <span className="m-tool__copy">
                  <strong>{tool.label}</strong>
                  <small>{tool.hint}</small>
                </span>
                <ChevronRight className="m-tool__chevron" />
              </button>
            );
          })}
        </div>

        <div className="m-scroll__end" />
      </div>
    </div>
  );
}
