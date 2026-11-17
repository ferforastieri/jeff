import { useEffect, useState } from "react";
import { LoaderCircle, TerminalSquare } from "@toph/icons";
import { Group, Panel, Separator } from "react-resizable-panels";
import { api, type Project } from "../../../shared/api";
import { useChats } from "../../conversations/store";
import { ensureToph } from "../../agents/default-toph";
import BotStudioTab from "../../conversations/components/BotStudioTab";
import { TerminalView } from "../../terminal/components/TerminalPanel";
import { useSettings } from "../../settings/store";

interface Props {
  project: Project;
  mobile?: boolean;
  onOpenFile?: (path: string, line?: number) => void;
}

const debugChatKey = (projectId: string) => `toph-debug-chat:${projectId}`;

/**
 * Debug is just a conversation plus the terminal the agent drives. The user
 * describes the symptom; the agent instruments the code, runs commands and
 * reads their output in the same visible PTY. No breakpoint UI is involved.
 */
export default function DebugPanel({ project, mobile = false, onOpenFile }: Props) {
  const projectChats = useChats((state) => state.byProject[project.id]);
  const theme = useSettings((state) => state.theme);
  const [chatId, setChatId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(debugChatKey(project.id));
    } catch {
      return null;
    }
  });
  const [terminal, setTerminal] = useState<{ id: string; shell: string } | null>(null);
  const [terminalError, setTerminalError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setTerminal(null);
    setTerminalError("");
    api
      .debugTerminal(project.id)
      .then((info) => {
        if (!cancelled) setTerminal({ id: info.id, shell: info.shell });
      })
      .catch((error) => {
        if (!cancelled) {
          setTerminalError(error instanceof Error ? error.message : "Não foi possível abrir o terminal de debug");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [project.id]);

  useEffect(() => {
    if (!projectChats?.hydrated) return;
    if (chatId && projectChats.chats.some((chat) => chat.id === chatId)) return;
    const toph = projectChats.tophs[0] ?? ensureToph(project.id);
    if (!toph) return;
    const previousActive = projectChats.activeChatId;
    const chat = useChats.getState().createConversation(project.id, [toph.id], { name: "Debug" });
    if (!chat) return;
    setChatId(chat.id);
    if (previousActive) useChats.getState().setActiveChat(project.id, previousActive);
    try {
      localStorage.setItem(debugChatKey(project.id), chat.id);
    } catch {
      /* storage may be unavailable; the chat still lives in the store */
    }
  }, [project.id, projectChats?.hydrated, projectChats?.chats, projectChats?.tophs, chatId]);

  const ready = Boolean(chatId && terminal);

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-background-full">
      {!ready ? (
        <div className="flex h-full items-center justify-center gap-2 text-caption-1-regular text-text-tertiary">
          <LoaderCircle size={16} className="animate-spin" /> Preparando o terminal de debug…
        </div>
      ) : (
        <Group orientation="vertical" className="h-full min-h-0 w-full">
          <Panel defaultSize={mobile ? "58" : "64"} minSize="25">
            <div className="h-full min-h-0">
              <BotStudioTab
                project={project}
                conversationId={chatId!}
                debug
                compact
                embedded
                mobile={mobile}
              />
            </div>
          </Panel>
          <Separator className="group relative h-px bg-separator-border after:absolute after:inset-x-0 after:top-1/2 after:h-2 after:-translate-y-1/2 after:content-[''] hover:after:bg-ring/50" />
          <Panel defaultSize={mobile ? "42" : "36"} minSize="15">
            <section className="flex h-full min-h-0 flex-col overflow-hidden bg-background-full">
              <div className="flex h-8 shrink-0 items-center gap-2 border-b border-separator-border px-3 text-caption-2-medium text-text-secondary">
                <TerminalSquare size={13} />
                <span>Terminal de debug</span>
                <span className="text-text-tertiary">— comandos e saída em tempo real</span>
              </div>
              <div className="min-h-0 flex-1 p-1">
                {terminalError ? (
                  <p role="alert" className="p-3 text-caption-1-regular text-text-error-primary">{terminalError}</p>
                ) : (
                  <TerminalView
                    session={{ id: terminal!.id, shell: terminal!.shell, title: "Debug" }}
                    theme={theme}
                    clearNonce={0}
                    focusNonce={0}
                    mobile={mobile}
                    onOutput={() => undefined}
                    onOpenFile={(path, line) => onOpenFile?.(path, line)}
                  />
                )}
              </div>
            </section>
          </Panel>
        </Group>
      )}
    </div>
  );
}
