import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Braces,
  Bug,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleDot,
  CornerDownRight,
  ListTree,
  LoaderCircle,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings2,
  Sparkles,
  Square,
  StepForward,
  Trash2,
  Variable,
  X,
} from "@toph/icons";
import {
  api,
  type AIMessage,
  type DebugBreakpoint,
  type DebugSessionInfo,
  type FileContent,
  type Project,
} from "../../../shared/api";
import { useAI } from "../../providers/store";
import { useDebug, type DebugTimelineItem } from "../store";
import { useApp } from "../../../app/store";
import { Button } from "@toph/ui/app";
import { Badge } from "@toph/ui/app";
import { Input } from "@toph/ui/app";
import { Modal } from "@toph/ui/app";
import { Select, SelectItem } from "@toph/ui/app";
import { TextareaBase } from "@toph/ui/app";
import { cx } from "@toph/ui";
import CodeEditor from "../../editor/components/CodeEditor";
import { languageFor } from "../../../shared/lib";
import {
  createEngine,
  type DebugEngine,
  type DebugFrame,
  type DebugRunConfig,
  type DebugScope,
  type DebugVariable,
  type EngineEvent,
} from "../engine";
import {
  actionBreakpointLabel,
  buildAiMessages,
  describeAction,
  parseDebugAiTurn,
  type DebugAiAction,
  type DebugObservation,
} from "../ai";

interface Props {
  project: Project;
  mobile?: boolean;
  headerControl?: ReactNode;
}

type ConsoleKind = "console" | "stderr" | "stdout" | "telemetry" | "input" | "result" | "note" | "error";
interface ConsoleLine {
  id: string;
  kind: ConsoleKind;
  text: string;
}
interface WatchValue {
  expression: string;
  value: string;
  error?: string;
}

const EMPTY_BREAKPOINTS: DebugBreakpoint[] = [];
const EMPTY_WATCHES: string[] = [];
const EMPTY_TIMELINE: DebugTimelineItem[] = [];
const MAX_AI_STEPS = 12;

function debugId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function statusLabel(connected: boolean, paused: boolean): string {
  if (!connected) return "parado";
  return paused ? "pausado" : "executando";
}

function statusTone(connected: boolean, paused: boolean): string {
  if (!connected) return "bg-text-tertiary";
  return paused ? "bg-status-yellow-text" : "bg-status-lime-text";
}

function variableReference(value: DebugVariable["reference"]): boolean {
  return value !== undefined && value !== null && value !== "" && value !== 0;
}

/** One expandable row: locals and object properties share the same tree. */
function VariableRows({
  variables,
  load,
  depth = 0,
}: {
  variables: DebugVariable[];
  load: (reference: DebugVariable["reference"]) => Promise<DebugVariable[]>;
  depth?: number;
}) {
  const [expanded, setExpanded] = useState<Record<string, DebugVariable[] | null>>({});
  async function toggle(variable: DebugVariable, key: string) {
    if (!variableReference(variable.reference)) return;
    if (expanded[key]) {
      setExpanded((current) => ({ ...current, [key]: null }));
      return;
    }
    const children = await load(variable.reference).catch(() => []);
    setExpanded((current) => ({ ...current, [key]: children }));
  }
  return (
    <>
      {variables.map((variable, index) => {
        const key = `${depth}:${variable.name}:${index}`;
        const children = expanded[key];
        const canExpand = variableReference(variable.reference);
        return (
          <div key={key}>
            <div
              className="flex min-w-0 items-center gap-1 rounded px-1 py-0.5 text-caption-2-regular hover:bg-background-primary-hover"
              style={{ paddingInlineStart: 4 + depth * 12 }}
            >
              <button
                type="button"
                onClick={() => void toggle(variable, key)}
                className={cx("flex size-3 shrink-0 items-center justify-center", canExpand ? "text-text-tertiary hover:text-text-primary" : "opacity-0")}
                aria-label={canExpand ? (children ? "Recolher" : "Expandir") : ""}
                tabIndex={canExpand ? 0 : -1}
              >
                {canExpand ? (children ? <ChevronDown size={11} /> : <ChevronRight size={11} />) : null}
              </button>
              <span className="shrink-0 text-accent-500" title={variable.name}>{variable.name}</span>
              <span className="min-w-0 flex-1 truncate text-text-secondary" title={variable.value}>{variable.value}</span>
              {variable.type ? <span className="shrink-0 text-text-tertiary">{variable.type}</span> : null}
            </div>
            {children?.length ? <VariableRows variables={children} load={load} depth={depth + 1} /> : null}
          </div>
        );
      })}
    </>
  );
}

function ScopeBlock({
  scope,
  index,
  load,
}: {
  scope: DebugScope;
  index: number;
  load: (reference: DebugVariable["reference"]) => Promise<DebugVariable[]>;
}) {
  const [open, setOpen] = useState(index === 0);
  return (
    <div className="mb-2">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-1 rounded px-1 py-0.5 text-start text-caption-2-medium text-text-secondary hover:bg-background-primary-hover"
      >
        {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        <span className="min-w-0 flex-1 truncate">{scope.name}</span>
        <span className="shrink-0 text-text-tertiary">{scope.variables.length}</span>
      </button>
      {open ? (
        scope.variables.length
          ? <VariableRows variables={scope.variables} load={load} />
          : <p className="px-1 text-caption-2-regular text-text-tertiary">vazio</p>
      ) : null}
    </div>
  );
}

function Section({
  title,
  icon,
  action,
  children,
}: {
  title: string;
  icon: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="border-b border-separator-border p-2">
      <div className="mb-1.5 flex items-center gap-1.5 text-caption-2-semibold uppercase tracking-[0.12em] text-text-tertiary">
        {icon}
        <span className="min-w-0 flex-1 truncate">{title}</span>
        {action}
      </div>
      {children}
    </section>
  );
}

function TimelineAction({ item, onAnswer }: { item: Extract<DebugTimelineItem, { kind: "action" }>; onAnswer?: () => void }) {
  const icon = item.status === "error" ? <CircleAlert size={13} className="text-status-rose-text" /> : item.status === "running" ? <LoaderCircle size={13} className="animate-spin text-accent-500" /> : <Check size={13} className="text-status-lime-text" />;
  const target = item.action.type === "set_breakpoints" ? actionBreakpointLabel(item.action) : item.action.type === "evaluate" ? item.action.expression : undefined;
  return (
    <div className="flex items-start gap-2 rounded-xl border border-border-button-default bg-background-primary-default px-2 py-1.5">
      <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-caption-1-medium text-text-primary">{describeAction(item.action)}{target ? ` · ${target}` : ""}</p>
        {item.detail ? <p className="mt-0.5 whitespace-pre-wrap break-words text-caption-2-regular text-text-tertiary">{item.detail}</p> : null}
      </div>
      {item.status === "running" && onAnswer ? <span className="shrink-0 text-[10px] text-text-tertiary">…</span> : null}
    </div>
  );
}

function QuestionCard({ item, onAnswer }: { item: Extract<DebugTimelineItem, { kind: "question" }>; onAnswer: (answer: string) => void }) {
  return (
    <div className="rounded-2xl border border-accent-500/30 bg-accent-500/[0.06] p-2.5">
      <p className="text-caption-1-medium text-text-primary">{item.question}</p>
      <div className="mt-1.5 flex flex-col gap-1">
        {item.options.map((option) => (
          <button
            key={option.label}
            type="button"
            disabled={Boolean(item.answer)}
            onClick={() => onAnswer(option.label)}
            className={cx(
              "flex w-full flex-col rounded-lg border border-border-button-default px-2 py-1.5 text-start transition-colors",
              item.answer === option.label ? "border-accent-500/40 bg-accent-500/10" : "hover:bg-background-primary-hover",
              item.answer && item.answer !== option.label ? "opacity-50" : "",
            )}
          >
            <span className="text-caption-1-medium text-text-primary">{option.label}</span>
            {option.description ? <span className="text-caption-2-regular text-text-tertiary">{option.description}</span> : null}
          </button>
        ))}
      </div>
      {item.answer ? <p className="mt-1.5 text-caption-2-regular text-text-tertiary">Você escolheu: {item.answer}</p> : null}
    </div>
  );
}

export default function DebugStudio({ project, mobile = false, headerControl }: Props) {
  const notify = useApp((state) => state.notify);
  const config = useDebug((state) => state.byProject[project.id]);
  const transcript = useDebug((state) => state.transcripts[project.id]) ?? EMPTY_TIMELINE;
  const loadConfig = useDebug((state) => state.load);
  const setConfig = useDebug((state) => state.setConfig);
  const addBreakpoint = useDebug((state) => state.addBreakpoint);
  const updateBreakpoint = useDebug((state) => state.updateBreakpoint);
  const removeBreakpoint = useDebug((state) => state.removeBreakpoint);
  const clearBreakpoints = useDebug((state) => state.clearBreakpoints);
  const toggleBreakpoint = useDebug((state) => state.toggleBreakpoint);
  const addWatch = useDebug((state) => state.addWatch);
  const removeWatch = useDebug((state) => state.removeWatch);
  const setLocation = useDebug((state) => state.setLocation);
  const appendTimeline = useDebug((state) => state.appendTimeline);
  const updateTimeline = useDebug((state) => state.updateTimeline);
  const clearTimeline = useDebug((state) => state.clearTimeline);
  const loadAI = useAI((state) => state.load);
  const aiConfig = useAI((state) => state.config);

  const [session, setSession] = useState<DebugSessionInfo | null>(null);
  const [starting, setStarting] = useState(false);
  const [connected, setConnected] = useState(false);
  const [paused, setPaused] = useState(false);
  const [pauseReason, setPauseReason] = useState("");
  const [frames, setFrames] = useState<DebugFrame[]>([]);
  const [selectedFrame, setSelectedFrame] = useState(0);
  const [scopes, setScopes] = useState<DebugScope[]>([]);
  const [watchResults, setWatchResults] = useState<WatchValue[]>([]);
  const [consoleLines, setConsoleLines] = useState<ConsoleLine[]>([]);
  const [consoleInput, setConsoleInput] = useState("");
  const [newWatch, setNewWatch] = useState("");
  const [statusError, setStatusError] = useState("");
  const [files, setFiles] = useState<string[]>([]);
  const [filesOpen, setFilesOpen] = useState(false);
  const [fileQuery, setFileQuery] = useState("");
  const [currentPath, setCurrentPath] = useState("");
  const [file, setFile] = useState<FileContent | null>(null);
  const [fileDirty, setFileDirty] = useState(false);
  const [cursorLine, setCursorLine] = useState(1);
  const [aiInput, setAiInput] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiStep, setAiStep] = useState(0);
  const [configOpen, setConfigOpen] = useState(false);
  const [breakpointEditing, setBreakpointEditing] = useState<DebugBreakpoint | null>(null);
  const [breakpointDraft, setBreakpointDraft] = useState({ condition: "", logMessage: "" });
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [mobileTab, setMobileTab] = useState<"ai" | "code">("ai");

  const engineRef = useRef<DebugEngine | null>(null);
  const sessionRef = useRef<DebugSessionInfo | null>(null);
  const configRef = useRef(config);
  const breakpointsRef = useRef<DebugBreakpoint[]>(EMPTY_BREAKPOINTS);
  const framesRef = useRef<DebugFrame[]>([]);
  const scopesRef = useRef<DebugScope[]>([]);
  const pausedRef = useRef(false);
  const selectedFrameRef = useRef(0);
  const currentPathRef = useRef("");
  const fileRef = useRef<FileContent | null>(null);
  const dirtyRef = useRef(false);
  const documentsRef = useRef<Map<string, string>>(new Map());
  const conversationRef = useRef<AIMessage[]>([]);
  const aiBusyRef = useRef(false);
  const stopRequestedRef = useRef(false);
  const stopWaiters = useRef<Array<{ resolve: () => void; timer: number }>>([]);
  const eventsUnsubRef = useRef<(() => void) | null>(null);
  const consoleRef = useRef<ConsoleLine[]>([]);
  const restoredRef = useRef<string | null>(null);
  const eventHandlerRef = useRef<(event: EngineEvent) => void>(() => undefined);
  const aiEndRef = useRef<HTMLDivElement>(null);

  const breakpoints = config?.breakpoints ?? EMPTY_BREAKPOINTS;
  const watches = config?.watches ?? EMPTY_WATCHES;
  const language = config?.language ?? "node";
  const mode = config?.mode ?? "launch";
  const bug = config?.bug ?? "";
  const reproduction = config?.reproduction ?? "";
  const breakpointKey = breakpoints.map((item) => `${item.path}:${item.line}:${item.condition ?? ""}:${item.logMessage ?? ""}:${item.enabled === false ? 0 : 1}`).join("|");
  const watchKey = watches.join("|");
  const currentBreakpoints = breakpoints.filter((item) => item.path === currentPath);
  const debugLine = frames[selectedFrame]?.path === currentPath ? frames[selectedFrame]?.line : undefined;
  const status = statusLabel(connected, paused);
  const configSummary = `${language === "python" ? "Python" : "Node"} · ${mode === "attach" ? (config?.address || "attach") : (config?.command || "escolher comando")}`;
  const filteredFiles = useMemo(() => {
    const query = fileQuery.trim().toLowerCase();
    const source = query ? files.filter((path) => path.toLowerCase().includes(query)) : files;
    return source.slice(0, 300);
  }, [fileQuery, files]);

  configRef.current = config;
  breakpointsRef.current = breakpoints;
  pausedRef.current = paused;
  selectedFrameRef.current = selectedFrame;
  currentPathRef.current = currentPath;
  fileRef.current = file;
  dirtyRef.current = fileDirty;

  function appendConsole(kind: ConsoleKind, text: string) {
    if (!text) return;
    const next = [...consoleRef.current.slice(-499), { id: debugId("console"), kind, text }];
    consoleRef.current = next;
    setConsoleLines(next);
  }

  function showStatus(message: string) {
    setStatusError(message);
    if (message) notify("error", message);
  }

  async function saveFile(): Promise<void> {
    const current = fileRef.current;
    if (!currentPathRef.current || !current) return;
    try {
      const saved = await api.saveFile(project.id, currentPathRef.current, current.content, current.hash);
      const next = { ...current, hash: saved.hash, modTime: saved.modTime };
      fileRef.current = next;
      dirtyRef.current = false;
      setFile(next);
      setFileDirty(false);
      notify("success", "Arquivo salvo.");
    } catch (error) {
      showStatus(error instanceof Error ? error.message : "Não foi possível salvar.");
    }
  }

  async function openFile(path: string, line?: number): Promise<void> {
    if (!path) return;
    if (dirtyRef.current && currentPathRef.current && currentPathRef.current !== path) {
      const content = fileRef.current?.content;
      if (content !== undefined) {
        await api.saveFile(project.id, currentPathRef.current, content, fileRef.current?.hash ?? "").catch(() => undefined);
      }
    }
    try {
      const value = await api.file(project.id, path);
      fileRef.current = value;
      currentPathRef.current = path;
      dirtyRef.current = false;
      setFile(value);
      setCurrentPath(path);
      setFileDirty(false);
      if (line && line > 0) setCursorLine(line);
    } catch (error) {
      showStatus(error instanceof Error ? error.message : "Não foi possível abrir o arquivo.");
    }
  }

  async function loadScopes(frame: DebugFrame): Promise<void> {
    const engine = engineRef.current;
    if (!engine) return;
    const values = await engine.scopes(frame).catch(() => []);
    scopesRef.current = values;
    setScopes(values);
    await evaluateWatches(frame);
  }

  async function evaluateWatches(frame: DebugFrame | undefined = framesRef.current[selectedFrameRef.current]): Promise<WatchValue[]> {
    const engine = engineRef.current;
    const current = configRef.current;
    if (!engine || !current || !frame || !current.watches.length) {
      setWatchResults([]);
      return [];
    }
    const results = await Promise.all(current.watches.map(async (expression) => {
      try {
        return { expression, value: await engine.evaluate(expression, frame) };
      } catch (error) {
        return { expression, value: "", error: error instanceof Error ? error.message : "Erro" };
      }
    }));
    setWatchResults(results);
    return results;
  }

  async function selectFrame(index: number): Promise<void> {
    const frame = framesRef.current[index];
    if (!frame) return;
    setSelectedFrame(index);
    selectedFrameRef.current = index;
    if (frame.path) {
      setLocation(project.id, { path: frame.path, line: frame.line });
      if (frame.path !== currentPathRef.current) await openFile(frame.path, frame.line);
    }
    await loadScopes(frame);
  }

  function waitForStop(timeoutMs = 8000): Promise<void> {
    return new Promise((resolve) => {
      const timer = window.setTimeout(() => {
        stopWaiters.current = stopWaiters.current.filter((item) => item.resolve !== resolve);
        resolve();
      }, timeoutMs);
      stopWaiters.current.push({ resolve, timer });
    });
  }

  function releaseStopWaiters(): void {
    const waiters = stopWaiters.current;
    stopWaiters.current = [];
    for (const waiter of waiters) {
      window.clearTimeout(waiter.timer);
      waiter.resolve();
    }
  }

  eventHandlerRef.current = (event: EngineEvent) => {
    if (event.type === "paused") {
      setPaused(true);
      pausedRef.current = true;
      setPauseReason(event.reason);
      setFrames(event.frames);
      framesRef.current = event.frames;
      setSelectedFrame(0);
      selectedFrameRef.current = 0;
      const first = event.frames[0];
      if (first) {
        if (first.path) {
          setLocation(project.id, { path: first.path, line: first.line });
          if (first.path !== currentPathRef.current) void openFile(first.path, first.line);
          else setCursorLine(first.line);
        }
        void loadScopes(first);
      } else {
        setScopes([]);
        scopesRef.current = [];
      }
      appendConsole("note", `Pausado em ${first?.name ?? "código"}${first?.line ? ` · linha ${first.line}` : ""}.`);
      releaseStopWaiters();
      return;
    }
    if (event.type === "resumed") {
      setPaused(false);
      pausedRef.current = false;
      setPauseReason("");
      setFrames([]);
      framesRef.current = [];
      setScopes([]);
      scopesRef.current = [];
      setWatchResults([]);
      setLocation(project.id, null);
      appendConsole("note", "Executando.");
      return;
    }
    if (event.type === "terminated") {
      setPaused(false);
      pausedRef.current = false;
      setConnected(false);
      setFrames([]);
      framesRef.current = [];
      setScopes([]);
      scopesRef.current = [];
      setSession(null);
      sessionRef.current = null;
      setLocation(project.id, null);
      appendConsole("note", "A sessão de debug terminou.");
      releaseStopWaiters();
      void api.debugStop(project.id).catch(() => undefined);
      return;
    }
    if (event.type === "output") {
      if (event.kind !== "telemetry") appendConsole(event.kind, event.text);
      return;
    }
    if (event.type === "breakpoint") {
      appendConsole("note", `Breakpoint ${event.verified ? "verificado" : "pendente"}${event.path ? ` em ${event.path}${event.line ? `:${event.line}` : ""}` : ""}.`);
    }
  };

  async function connectEngine(active: DebugSessionInfo, restore: boolean): Promise<void> {
    const current = configRef.current;
    if (!current) return;
    const engine = createEngine(active.language);
    eventsUnsubRef.current?.();
    await engineRef.current?.disconnect(false).catch(() => undefined);
    engineRef.current = engine;
    eventsUnsubRef.current = engine.on((event) => eventHandlerRef.current(event));
    const runConfig: DebugRunConfig = {
      language: current.language,
      mode: current.mode,
      command: current.command,
      address: current.address,
      cwd: current.cwd,
      projectRoot: project.root,
    };
    if (restore && active.language === "python" && engine.restore) {
      await engine.restore(active, project.root);
    } else {
      const latestBreakpoints = useDebug.getState().byProject[project.id]?.breakpoints ?? breakpointsRef.current;
      await engine.connect(active, runConfig, latestBreakpoints);
    }
    setConnected(true);
    setSession(active);
    sessionRef.current = active;
  }

  async function startSession(): Promise<boolean> {
    if (sessionRef.current) return true;
    const current = configRef.current;
    if (!current) return false;
    if (current.mode === "launch" && !current.command.trim()) {
      showStatus(current.language === "python"
        ? "Informe o script Python (ex.: app.py) antes de iniciar."
        : "Informe o comando Node (ex.: npm run dev) antes de iniciar.");
      return false;
    }
    setStarting(true);
    setStatusError("");
    try {
      const next = await api.debugStart(project.id, {
        language: current.language,
        mode: current.mode,
        command: current.command,
        address: current.address,
        cwd: current.cwd,
      });
      setSession(next);
      sessionRef.current = next;
      await connectEngine(next, false);
      appendConsole("note", `${next.language === "python" ? "Python" : "Node"} · sessão iniciada.`);
      return true;
    } catch (error) {
      showStatus(error instanceof Error ? error.message : "Não foi possível iniciar o debug.");
      setSession(null);
      sessionRef.current = null;
      setConnected(false);
      await api.debugStop(project.id).catch(() => undefined);
      return false;
    } finally {
      setStarting(false);
    }
  }

  async function stopSession(): Promise<void> {
    await engineRef.current?.disconnect(true).catch(() => undefined);
    engineRef.current = null;
    eventsUnsubRef.current?.();
    eventsUnsubRef.current = null;
    setConnected(false);
    setPaused(false);
    pausedRef.current = false;
    setFrames([]);
    framesRef.current = [];
    setScopes([]);
    scopesRef.current = [];
    setWatchResults([]);
    setSession(null);
    sessionRef.current = null;
    setLocation(project.id, null);
    releaseStopWaiters();
    await api.debugStop(project.id).catch(() => undefined);
    appendConsole("note", "Sessão encerrada.");
  }

  async function restartSession(): Promise<void> {
    await stopSession();
    await startSession();
  }

  async function togglePause(): Promise<void> {
    const engine = engineRef.current;
    if (!engine) return;
    if (pausedRef.current) {
      await engine.resume().catch((error) => showStatus(error instanceof Error ? error.message : "Não foi possível continuar."));
      return;
    }
    await engine.pause().catch((error) => showStatus(error instanceof Error ? error.message : "Não foi possível pausar."));
  }

  async function step(kind: "over" | "into" | "out"): Promise<void> {
    const engine = engineRef.current;
    if (!engine) return;
    const waiter = waitForStop(6000);
    await engine.step(kind).catch((error) => showStatus(error instanceof Error ? error.message : "Não foi possível avançar."));
    await waiter;
  }

  async function runConsole(): Promise<void> {
    const expression = consoleInput.trim();
    if (!expression) return;
    const engine = engineRef.current;
    if (!engine) return;
    setConsoleInput("");
    appendConsole("input", `> ${expression}`);
    try {
      const value = await engine.evaluate(expression, framesRef.current[selectedFrameRef.current]);
      appendConsole("result", value);
    } catch (error) {
      appendConsole("error", error instanceof Error ? error.message : "Falha ao avaliar.");
    }
  }

  async function detectCommand(): Promise<void> {
    const current = configRef.current;
    if (!current) return;
    if (current.language === "node") {
      try {
        const pkg = await api.file(project.id, "package.json");
        const parsed = JSON.parse(pkg.content) as { scripts?: Record<string, string> };
        const script = ["dev", "start", "serve", "build"].find((key) => parsed.scripts?.[key]);
        if (script) {
          setConfig(project.id, { command: `npm run ${script}` });
          return;
        }
      } catch {
        // No package.json.
      }
      const main = files.find((path) => /(^|\/)(index|main|server)\.(js|ts|mjs|cjs)$/.test(path));
      if (main) setConfig(project.id, { command: `node ${main}` });
      return;
    }
    const candidates = ["app.py", "main.py", "manage.py", "src/main.py"];
    const main = candidates.find((path) => files.includes(path)) ?? files.find((path) => path.endsWith(".py"));
    if (main) setConfig(project.id, { command: main });
  }

  async function buildObservation(): Promise<DebugObservation> {
    const engine = engineRef.current;
    let watchValues = watchResults;
    if (engine && pausedRef.current) {
      if (!framesRef.current.length) {
        const next = await engine.refreshFrames().catch(() => []);
        if (next.length) {
          setFrames(next);
          framesRef.current = next;
          setSelectedFrame(0);
          selectedFrameRef.current = 0;
        }
      }
      const first = framesRef.current[0];
      if (first && !scopesRef.current.length) await loadScopes(first);
      if (first) watchValues = await evaluateWatches(first);
    }
    const current = configRef.current;
    const selected = framesRef.current[selectedFrameRef.current];
    const latestBreakpoints = useDebug.getState().byProject[project.id]?.breakpoints ?? breakpointsRef.current;
    return {
      session: current ? {
        language: current.language,
        mode: current.mode,
        status: !sessionRef.current ? "parado" : pausedRef.current ? "pausado" : "executando",
        command: current.command,
        cwd: current.cwd,
        address: current.address,
      } : null,
      paused: pausedRef.current,
      reason: pauseReason,
      location: selected ? { path: selected.path, line: selected.line, name: selected.name } : null,
      callStack: framesRef.current.slice(0, 30).map((frame) => ({ name: frame.name, path: frame.path, line: frame.line })),
      scopes: scopesRef.current.map((scope) => ({
        name: scope.name,
        variables: scope.variables.slice(0, 80).map((variable) => ({ name: variable.name, value: variable.value, type: variable.type })),
      })),
      watches: watchValues,
      breakpoints: latestBreakpoints.map((breakpoint) => ({
        path: breakpoint.path,
        line: breakpoint.line,
        condition: breakpoint.condition,
        logMessage: breakpoint.logMessage,
        enabled: breakpoint.enabled,
      })),
      console: consoleRef.current.slice(-40).map((line) => `${line.kind}: ${line.text}`),
      files: files.slice(0, 400),
      currentFile: currentPathRef.current && fileRef.current
        ? { path: currentPathRef.current, content: fileRef.current.content.slice(0, 12_000) }
        : null,
      documents: [...documentsRef.current.entries()].slice(0, 3).map(([path, content]) => ({ path, content: content.slice(0, 12_000) })),
      bug,
      reproduction,
    };
  }

  async function askAi(observation: DebugObservation, guidance: string) {
    const conversation = conversationRef.current;
    const messages = buildAiMessages(conversation, observation, guidance);
    const result = await api.aiChat(messages, { model: aiConfig?.model });
    const userMessage = messages[messages.length - 1];
    const assistantMessage: AIMessage = { role: "assistant", content: result.text };
    conversationRef.current = [
      ...conversation,
      userMessage,
      assistantMessage,
    ].slice(-12);
    return parseDebugAiTurn(result.text);
  }

  function appendUser(text: string): void {
    appendTimeline(project.id, { id: debugId("user"), kind: "user", text, createdAt: Date.now() });
  }

  function appendAi(text: string): void {
    appendTimeline(project.id, { id: debugId("ai"), kind: "ai", text, createdAt: Date.now() });
  }

  function appendAction(action: DebugAiAction, status: "running" | "done" | "error", detail?: string): string {
    const id = debugId("action");
    appendTimeline(project.id, { id, kind: "action", action, status, detail, createdAt: Date.now() });
    return id;
  }

  function appendQuestion(action: DebugAiAction): void {
    const options = action.options?.length ? action.options : [{ label: "Continuar" }, { label: "Parar" }];
    appendTimeline(project.id, {
      id: debugId("question"),
      kind: "question",
      question: action.question || "Como devo continuar?",
      options,
      createdAt: Date.now(),
    });
  }

  async function executeAction(action: DebugAiAction): Promise<string> {
    const engine = engineRef.current;
    switch (action.type) {
      case "set_breakpoints": {
        const items = action.breakpoints ?? [];
        for (const breakpoint of items) {
          addBreakpoint(project.id, breakpoint.path, breakpoint.line, {
            condition: breakpoint.condition ?? "",
            logMessage: breakpoint.logMessage ?? "",
          });
          const existing = useDebug.getState().byProject[project.id]?.breakpoints.find((item) => item.path === breakpoint.path && item.line === breakpoint.line);
          if (existing && (breakpoint.condition || breakpoint.logMessage)) {
            updateBreakpoint(project.id, existing.id, {
              condition: breakpoint.condition ?? "",
              logMessage: breakpoint.logMessage ?? "",
            });
          }
        }
        await engine?.setBreakpoints(useDebug.getState().byProject[project.id]?.breakpoints ?? []);
        const first = items[0];
        if (first) {
          await openFile(first.path, first.line);
          setLocation(project.id, { path: first.path, line: first.line });
        }
        return items.length ? items.map((item) => `${item.path}:${item.line}`).join(", ") : "nenhum breakpoint informado";
      }
      case "remove_breakpoint": {
        const target = breakpointsRef.current.find((item) => item.path === action.path && item.line === action.line)
          ?? breakpointsRef.current.find((item) => item.path === action.path);
        if (target) {
          removeBreakpoint(project.id, target.id);
          await engine?.setBreakpoints(useDebug.getState().byProject[project.id]?.breakpoints ?? []);
          return `${target.path}:${target.line}`;
        }
        return "breakpoint não encontrado";
      }
      case "start": {
        const ok = await startSession();
        if (!ok) throw new Error("Não foi possível iniciar a sessão.");
        if (!pausedRef.current) await waitForStop(5000);
        return pausedRef.current ? "a execução pausou" : "a execução está rodando";
      }
      case "continue": {
        if (!engine) throw new Error("Nenhuma sessão ativa.");
        const waiter = waitForStop(action.timeoutMs ?? 8000);
        await engine.resume();
        await waiter;
        return pausedRef.current ? "pausou novamente" : "executando";
      }
      case "pause": {
        if (!engine) throw new Error("Nenhuma sessão ativa.");
        const waiter = waitForStop(5000);
        await engine.pause();
        await waiter;
        return "pausado";
      }
      case "step_over":
      case "step_into":
      case "step_out": {
        if (!engine) throw new Error("Nenhuma sessão ativa.");
        const waiter = waitForStop(5000);
        await engine.step(action.type === "step_over" ? "over" : action.type === "step_into" ? "into" : "out");
        await waiter;
        return pausedRef.current ? "a execução pausou no próximo ponto" : "executando";
      }
      case "evaluate": {
        if (!engine) throw new Error("Nenhuma sessão ativa.");
        const expression = action.expression || "";
        const value = await engine.evaluate(expression, framesRef.current[selectedFrameRef.current]);
        appendConsole("input", `> ${expression}`);
        appendConsole("result", value);
        return `${expression} = ${value}`;
      }
      case "read_file": {
        if (!action.path) throw new Error("Informe o caminho do arquivo.");
        const value = await api.file(project.id, action.path);
        documentsRef.current.set(action.path, value.content);
        appendConsole("note", `Leu ${action.path} (${value.content.length} caracteres).`);
        return `${action.path} · ${value.content.length} caracteres`;
      }
      case "wait": {
        if (pausedRef.current) return "já estava pausado";
        await waitForStop(action.timeoutMs ?? 8000);
        return pausedRef.current ? "a execução pausou" : "a execução segue rodando";
      }
      case "stop": {
        await stopSession();
        return "sessão encerrada";
      }
      case "ask_user":
      case "done":
        return "ok";
      default:
        return "ação não reconhecida";
    }
  }

  async function runAi(guidance = "", echo = true): Promise<void> {
    if (aiBusyRef.current) return;
    aiBusyRef.current = true;
    setAiBusy(true);
    stopRequestedRef.current = false;
    if (echo && guidance.trim()) appendUser(guidance.trim());
    let note = guidance.trim();
    try {
      for (let stepIndex = 0; stepIndex < MAX_AI_STEPS; stepIndex += 1) {
        if (stopRequestedRef.current) break;
        setAiStep(stepIndex + 1);
        const observation = await buildObservation();
        let turn;
        try {
          turn = await askAi(observation, note);
        } catch (error) {
          appendAi(`Não consegui falar com o modelo: ${error instanceof Error ? error.message : "erro desconhecido"}.`);
          break;
        }
        if (stopRequestedRef.current) break;
        appendAi(turn.say);
        const action = turn.action;
        if (!action) break;
        if (action.type === "done") {
          appendAction(action, "done", "Investigação encerrada.");
          break;
        }
        if (action.type === "ask_user") {
          appendAction(action, "done", "Aguardando sua resposta.");
          appendQuestion(action);
          break;
        }
        const cardId = appendAction(action, "running");
        try {
          const detail = await executeAction(action);
          updateTimeline(project.id, cardId, { status: "done", detail });
        } catch (error) {
          const message = error instanceof Error ? error.message : "A ação falhou.";
          updateTimeline(project.id, cardId, { status: "error", detail: message });
          appendConsole("error", message);
        }
        note = "";
        await new Promise((resolve) => window.setTimeout(resolve, 120));
      }
    } finally {
      aiBusyRef.current = false;
      setAiBusy(false);
      setAiStep(0);
    }
  }

  function answerQuestion(item: Extract<DebugTimelineItem, { kind: "question" }>, answer: string): void {
    if (item.answer) return;
    updateTimeline(project.id, item.id, { answer });
    void runAi(answer);
  }

  function runQuick(label: string, prompt: string): void {
    if (aiBusyRef.current) return;
    appendUser(label);
    void runAi(prompt, false);
  }

  function submitAi(): void {
    const text = aiInput.trim();
    if (!text || aiBusyRef.current) return;
    setAiInput("");
    void runAi(text);
  }

  function stopAi(): void {
    stopRequestedRef.current = true;
  }

  function resetInvestigation(): void {
    if (aiBusyRef.current) return;
    conversationRef.current = [];
    documentsRef.current.clear();
    clearTimeline(project.id);
  }

  function openBreakpointEditor(breakpoint: DebugBreakpoint): void {
    setBreakpointEditing(breakpoint);
    setBreakpointDraft({ condition: breakpoint.condition ?? "", logMessage: breakpoint.logMessage ?? "" });
  }

  function saveBreakpointEditor(): void {
    if (!breakpointEditing) return;
    updateBreakpoint(project.id, breakpointEditing.id, {
      condition: breakpointDraft.condition.trim(),
      logMessage: breakpointDraft.logMessage.trim(),
    });
    setBreakpointEditing(null);
  }

  useEffect(() => {
    void loadConfig(project.id);
    void loadAI();
    void api.files(project.id).then((items) => setFiles(items.sort((a, b) => a.localeCompare(b)))).catch(() => undefined);
  }, [project.id, loadConfig, loadAI]);

  useEffect(() => {
    aiEndRef.current?.scrollIntoView({ block: "end" });
  }, [transcript.length, aiBusy]);

  useEffect(() => {
    if (!config || restoredRef.current === project.id) return;
    restoredRef.current = project.id;
    let cancelled = false;
    void (async () => {
      try {
        const active = await api.debugSession(project.id);
        if (cancelled || !active) return;
        await connectEngine(active, true);
        if (active.status === "paused") {
          setPaused(true);
          pausedRef.current = true;
          setPauseReason("restaurado");
          const next = await engineRef.current?.refreshFrames().catch(() => []) ?? [];
          if (next.length) {
            setFrames(next);
            framesRef.current = next;
            const first = next[0];
            if (first.path) {
              setLocation(project.id, { path: first.path, line: first.line });
              if (first.path !== currentPathRef.current) void openFile(first.path, first.line);
            }
            void loadScopes(first);
          }
        }
        appendConsole("note", "Sessão de debug restaurada.");
      } catch {
        // No active session or the adapter no longer accepts clients.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [config, project.id]);

  useEffect(() => {
    if (!connected) return;
    const timer = window.setTimeout(() => {
      void engineRef.current?.setBreakpoints(breakpointsRef.current);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [breakpointKey, connected]);

  useEffect(() => {
    if (paused) void evaluateWatches();
  }, [watchKey, paused, selectedFrame]);

  useEffect(() => {
    return () => {
      stopRequestedRef.current = true;
      eventsUnsubRef.current?.();
      eventsUnsubRef.current = null;
      void engineRef.current?.disconnect(false).catch(() => undefined);
      engineRef.current = null;
      releaseStopWaiters();
      // The server keeps the session alive: switching the sidebar or a page
      // reload must not kill the project's debugger.
    };
  }, []);

  if (!config) {
    return <div className="flex h-full items-center justify-center text-caption-1-regular text-text-secondary">Carregando debug...</div>;
  }

  const aiPane = (
    <div className="flex min-h-0 flex-1 flex-col bg-background-primary-default">
      <div className="flex shrink-0 items-center gap-2 border-b border-separator-border px-2 py-1.5">
        <span className="flex size-6 items-center justify-center rounded-lg bg-accent-500/10 text-accent-500"><Sparkles size={14} /></span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-caption-1-semibold text-text-primary">Investigação do Toph</p>
          <p className="truncate text-caption-2-regular text-text-tertiary">{aiBusy ? `passo ${aiStep} · trabalhando` : "seu par de programação no debugger"}</p>
        </div>
        {aiBusy ? (
          <Button variant="ghost" size="xs" onClick={stopAi}>Parar</Button>
        ) : transcript.length ? (
          <Button variant="ghost" size="xs" iconOnly leadingIcon={Trash2} aria-label="Nova investigação" title="Nova investigação" onClick={resetInvestigation} />
        ) : null}
      </div>
      <div className="shrink-0 border-b border-separator-border p-2">
        <div className="rounded-xl border border-border-button-default bg-background-secondary-default/40 p-2">
          <p className="mb-1.5 flex items-center gap-1.5 text-caption-2-semibold uppercase tracking-[0.12em] text-text-tertiary">
            <CircleAlert size={11} /> Relato do problema
          </p>
          <div className="flex flex-col gap-1.5">
            <Input value={bug} onChange={(value) => setConfig(project.id, { bug: value })} placeholder="O que está quebrado?" fieldClassName="h-7 text-caption-1" aria-label="Qual é o bug" />
            <Input value={reproduction} onChange={(value) => setConfig(project.id, { reproduction: value })} placeholder="Como reproduzir? (passos, comando, URL)" fieldClassName="h-7 text-caption-1" aria-label="Como reproduzir" />
            <Button variant="primary" size="xs" leadingIcon={Sparkles} disabled={aiBusy} onClick={() => runQuick("Investigar agora", "Investigue o problema descrito. Comece lendo o código relevante, defina breakpoints e inicie a sessão.")}>
              Investigar
            </Button>
          </div>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {transcript.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border-button-default p-3 text-caption-1-regular text-text-secondary">
            <p className="mb-1 flex items-center gap-1.5 font-medium text-text-primary"><Sparkles size={13} className="text-accent-500" /> Eu conduzo a investigação</p>
            <p>Descreva o problema acima e clique em Investigar. Eu leio o código, defino breakpoints, inicio a sessão e explico cada passo.</p>
            <div className="mt-2 flex flex-wrap gap-1">
              <Button variant="ghost" size="xs" disabled={aiBusy} onClick={() => runQuick("Começar pelo arquivo aberto", "Comece a investigar o arquivo aberto. Se não houver breakpoint, defina um provável antes de iniciar.")}>Começar pelo arquivo</Button>
              <Button variant="ghost" size="xs" disabled={aiBusy || !paused} onClick={() => runQuick("Explique esta pausa", "Explique onde estamos, o que esta pausa significa e quais variáveis importam.")}>Explique a pausa</Button>
            </div>
          </div>
        ) : transcript.map((item) => {
          if (item.kind === "ai") {
            return (
              <div key={item.id} className="mb-2 flex items-start gap-2">
                <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-lg bg-accent-500/10 text-accent-500"><Sparkles size={12} /></span>
                <p className="min-w-0 flex-1 whitespace-pre-wrap break-words rounded-2xl bg-background-secondary-default px-2.5 py-1.5 text-caption-1-regular text-text-secondary">{item.text}</p>
              </div>
            );
          }
          if (item.kind === "user") {
            return (
              <div key={item.id} className="mb-2 ms-5 rounded-2xl bg-accent-500/10 px-2.5 py-1.5 text-caption-1-regular text-text-primary whitespace-pre-wrap break-words">{item.text}</div>
            );
          }
          if (item.kind === "action") {
            return <div key={item.id} className="mb-2"><TimelineAction item={item} /></div>;
          }
          return <div key={item.id} className="mb-2"><QuestionCard item={item} onAnswer={(answer) => answerQuestion(item, answer)} /></div>;
        })}
        {aiBusy ? (
          <div className="flex items-center gap-2 px-1 py-2 text-caption-2-regular text-text-tertiary">
            <LoaderCircle size={13} className="animate-spin text-accent-500" /> O Toph está olhando o estado do debugger…
          </div>
        ) : null}
        <div ref={aiEndRef} />
      </div>
      <div className="shrink-0 border-t border-separator-border p-2">
        <div className="mb-1 flex flex-wrap gap-1">
          <button type="button" disabled={aiBusy} onClick={() => runQuick("Continue a investigação", "Continue a investigação a partir do estado atual.")} className="rounded-full bg-background-tertiary-default px-2 py-0.5 text-caption-2-regular text-text-secondary transition-colors hover:bg-background-primary-hover disabled:opacity-50">Continuar</button>
          <button type="button" disabled={aiBusy || !paused} onClick={() => runQuick("Explique esta pausa", "Explique esta pausa em linguagem simples e o que devo olhar.")} className="rounded-full bg-background-tertiary-default px-2 py-0.5 text-caption-2-regular text-text-secondary transition-colors hover:bg-background-primary-hover disabled:opacity-50">Explicar pausa</button>
          <button type="button" disabled={aiBusy || !paused} onClick={() => runQuick("Sugira uma correção", "Com base no estado atual, sugira uma causa provável e uma correção. Não escreva arquivos.")} className="rounded-full bg-background-tertiary-default px-2 py-0.5 text-caption-2-regular text-text-secondary transition-colors hover:bg-background-primary-hover disabled:opacity-50">Sugerir correção</button>
        </div>
        <div className="flex items-end gap-1.5">
          <TextareaBase
            value={aiInput}
            onChange={(event) => setAiInput(event.target.value)}
            placeholder="Guie o Toph: “olhe o payload”, “volte um passo”…"
            rows={2}
            autoResize
            maxRows={5}
            resize="none"
            fieldClassName="min-h-9 min-w-0 flex-1"
            className="text-caption-1-regular"
            onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); submitAi(); } }}
          />
          <Button variant="primary" size="small" iconOnly leadingIcon={aiBusy ? LoaderCircle : Send} aria-label="Enviar orientação" disabled={aiBusy || !aiInput.trim()} onClick={submitAi} className="size-9" />
        </div>
      </div>
    </div>
  );

  const statePane = (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-separator-border p-2.5">
        <div className="flex items-center gap-2">
          <span className={cx("size-2 shrink-0 rounded-full", statusTone(connected, paused))} />
          <p className="min-w-0 flex-1 truncate text-caption-1-semibold text-text-primary">
            {language === "python" ? "Python" : "Node"} · {mode === "attach" ? "attach" : "launch"}
          </p>
          <Button variant="ghost" size="xs" iconOnly leadingIcon={Settings2} aria-label="Configurar debug" title="Configurar debug" onClick={() => setConfigOpen(true)} />
        </div>
        <p className="mt-1 truncate font-mono text-[11px] text-text-tertiary" title={session?.address || config.command}>
          {session?.address || config.command || "configure o comando"}
        </p>
        <p className="mt-1 truncate text-caption-2-regular text-text-tertiary">
          {!session ? "Sessão parada" : paused ? `Pausado${pauseReason ? ` · ${pauseReason}` : ""}` : "Executando"}
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {paused ? (
          <>
            <Section title="Call stack" icon={<ListTree size={13} />}>
              {frames.length ? frames.slice(0, 30).map((frame, index) => (
                <button
                  key={`${frame.id}-${index}`}
                  type="button"
                  onClick={() => void selectFrame(index)}
                  className={cx(
                    "flex w-full items-center gap-1.5 rounded-lg px-1.5 py-1 text-start text-caption-1-regular",
                    index === selectedFrame ? "bg-accent-500/10 text-text-primary" : "text-text-secondary hover:bg-background-primary-hover",
                  )}
                >
                  <CornerDownRight size={12} className="shrink-0 text-text-tertiary" />
                  <span className="min-w-0 flex-1 truncate">{frame.name || "(anonymous)"}</span>
                  <span className="shrink-0 text-caption-2-regular text-text-tertiary">{frame.path.split("/").pop()}:{frame.line}</span>
                </button>
              )) : <p className="text-caption-2-regular text-text-tertiary">A stack ainda está carregando.</p>}
            </Section>
            <Section title="Variáveis" icon={<Variable size={13} />}>
              {scopes.length ? scopes.map((scope, index) => (
                <ScopeBlock
                  key={`${scope.name}-${index}`}
                  scope={scope}
                  index={index}
                  load={(reference) => reference !== undefined && reference !== null && reference !== ""
                    ? (engineRef.current?.variables(reference) ?? Promise.resolve([]))
                    : Promise.resolve([])}
                />
              )) : <p className="text-caption-2-regular text-text-tertiary">Nenhuma variável neste ponto.</p>}
            </Section>
            <Section title="Watches" icon={<CircleDot size={13} />}>
              <div className="flex flex-col gap-1">
                {watches.map((watch, index) => {
                  const result = watchResults.find((item) => item.expression === watch);
                  return (
                    <div key={`${watch}-${index}`} className="flex items-center gap-1.5 text-caption-2-regular">
                      <span className="min-w-0 flex-1 truncate text-accent-500" title={watch}>{watch}</span>
                      <span className={cx("min-w-0 max-w-[45%] truncate", result?.error ? "text-status-rose-text" : "text-text-secondary")} title={result?.value || result?.error || ""}>{result?.value || result?.error || "—"}</span>
                      <button type="button" aria-label="Remover watch" onClick={() => removeWatch(project.id, index)} className="text-text-tertiary hover:text-status-rose-text"><X size={11} /></button>
                    </div>
                  );
                })}
                <div className="flex items-center gap-1.5">
                  <Input value={newWatch} onChange={setNewWatch} placeholder="expressão" fieldClassName="h-7 text-caption-1" onKeyDown={(event) => { if (event.key === "Enter" && newWatch.trim()) { addWatch(project.id, newWatch); setNewWatch(""); } }} />
                  <Button variant="ghost" size="xs" iconOnly leadingIcon={Plus} aria-label="Adicionar watch" onClick={() => { if (newWatch.trim()) { addWatch(project.id, newWatch); setNewWatch(""); } }} className="size-7" />
                </div>
              </div>
            </Section>
          </>
        ) : (
          <p className="border-b border-separator-border px-3 py-2.5 text-caption-2-regular text-text-tertiary">
            {session ? "A execução está rodando. Pare em um breakpoint para ver a stack e as variáveis." : "Inicie o debug e pare em um breakpoint para inspecionar a execução."}
          </p>
        )}

        <Section
          title="Breakpoints"
          icon={<Braces size={13} />}
          action={breakpoints.length ? (
            <span className="flex items-center gap-1.5">
              <Badge color="neutral">{breakpoints.length}</Badge>
              <button type="button" onClick={() => clearBreakpoints(project.id)} className="text-caption-2-regular text-text-tertiary hover:text-status-rose-text">Limpar</button>
            </span>
          ) : undefined}
        >
          <div className="flex flex-col gap-0.5">
            {breakpoints.length ? breakpoints.slice(0, 80).map((breakpoint) => (
              <div key={breakpoint.id} className="group flex items-center gap-1 rounded-lg px-1 py-0.5 text-caption-2-regular">
                <button
                  type="button"
                  onClick={() => updateBreakpoint(project.id, breakpoint.id, { enabled: breakpoint.enabled === false })}
                  className={cx("size-2.5 shrink-0 rounded-full", breakpoint.enabled === false ? "bg-text-tertiary" : breakpoint.logMessage ? "bg-status-yellow-text" : breakpoint.condition ? "bg-status-blue-text" : "bg-status-rose-text")}
                  aria-label={breakpoint.enabled === false ? "Ativar breakpoint" : "Desativar breakpoint"}
                />
                <button type="button" onClick={() => void openFile(breakpoint.path, breakpoint.line)} className="min-w-0 flex-1 truncate text-start text-text-secondary hover:text-text-primary" title={breakpoint.path}>
                  {breakpoint.path.split("/").pop()}:{breakpoint.line}
                </button>
                {breakpoint.condition ? <span className="max-w-24 truncate text-status-blue-text" title={breakpoint.condition}>if</span> : null}
                {breakpoint.logMessage ? <span className="max-w-24 truncate text-status-yellow-text" title={breakpoint.logMessage}>log</span> : null}
                <button type="button" onClick={() => openBreakpointEditor(breakpoint)} className="text-text-tertiary opacity-0 hover:text-text-primary group-hover:opacity-100" aria-label="Editar breakpoint">✎</button>
                <button type="button" onClick={() => removeBreakpoint(project.id, breakpoint.id)} className="text-text-tertiary opacity-0 hover:text-status-rose-text group-hover:opacity-100" aria-label="Remover breakpoint"><X size={11} /></button>
              </div>
            )) : <p className="text-caption-2-regular text-text-tertiary">Clique na gutter do editor para marcar uma linha.</p>}
          </div>
        </Section>
      </div>
    </div>
  );

  const editorPane = (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background-primary-default">
      <div className="flex shrink-0 items-center gap-1.5 border-b border-separator-border px-2 py-1.5">
        <Button variant="ghost" size="xs" iconOnly leadingIcon={Search} aria-label="Arquivos" title="Arquivos" onClick={() => setFilesOpen(true)} />
        <span className="min-w-0 flex-1 truncate font-mono text-caption-1-regular text-text-secondary" title={currentPath}>{currentPath || "Abra um arquivo"}</span>
        {fileDirty ? <Badge color="primary">modificado</Badge> : null}
        {currentPath ? <span className="flex items-center gap-1 text-caption-2-regular text-status-rose-text"><CircleDot size={11} /> {currentBreakpoints.length}</span> : null}
        <Button variant="ghost" size="xs" leadingIcon={Plus} onClick={() => currentPath && toggleBreakpoint(project.id, currentPath, cursorLine)} disabled={!currentPath}>Breakpoint</Button>
        <Button variant="ghost" size="xs" iconOnly leadingIcon={Braces} aria-label="Alternar console" title="Alternar console" onClick={() => setConsoleOpen((value) => !value)} />
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {file ? (
          <CodeEditor
            path={currentPath}
            value={file.content}
            language={languageFor(currentPath)}
            projectId={project.id}
            projectRoot={project.root}
            breakpoints={currentBreakpoints}
            debugLine={debugLine}
            onToggleBreakpoint={(line) => toggleBreakpoint(project.id, currentPath, line)}
            onCursorLine={setCursorLine}
            onCursorPosition={(line) => setCursorLine(line)}
            onChange={(content) => { setFile((current) => current ? { ...current, content } : current); setFileDirty(true); }}
            onSave={() => void saveFile()}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
            <span className="flex size-11 items-center justify-center rounded-2xl bg-accent-500/10 text-accent-500"><Bug size={20} /></span>
            <strong className="text-body-medium text-text-primary">Comece pelo relato do problema</strong>
            <p className="max-w-sm text-caption-1-regular text-text-secondary">
              Descreva à direita o que está quebrado e como reproduzir. O Toph abre o código, marca breakpoints e conduz a sessão; você acompanha e guia.
            </p>
            <div className="mt-1 flex flex-wrap justify-center gap-2">
              <Button variant="secondary" size="small" leadingIcon={Search} onClick={() => setFilesOpen(true)}>Buscar arquivo</Button>
              <Button variant="primary" size="small" leadingIcon={Sparkles} disabled={aiBusy} onClick={() => runQuick("Investigar agora", "Investigue o problema descrito. Comece lendo o código relevante, defina breakpoints e inicie a sessão.")}>Investigar agora</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  const consolePane = (
    <div className="flex h-full min-h-0 flex-col bg-background-primary-default">
      <div className="flex shrink-0 items-center gap-2 border-b border-separator-border px-2 py-1">
        <Braces size={13} className="text-accent-500" />
        <span className="text-caption-2-semibold uppercase tracking-[0.12em] text-text-tertiary">Debug Console</span>
        <span className="min-w-0 flex-1" />
        <Button variant="ghost" size="xs" onClick={() => { consoleRef.current = []; setConsoleLines([]); }}>Limpar</Button>
        <Button variant="ghost" size="xs" iconOnly leadingIcon={X} aria-label="Fechar console" onClick={() => setConsoleOpen(false)} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5 font-mono text-[10.5px] leading-relaxed">
        {consoleLines.length ? consoleLines.map((line) => (
          <div
            key={line.id}
            className={cx(
              "whitespace-pre-wrap break-words",
              line.kind === "error" || line.kind === "stderr" ? "text-status-rose-text" : line.kind === "input" ? "text-accent-500" : line.kind === "result" ? "text-status-lime-text" : line.kind === "note" ? "text-text-tertiary" : "text-text-secondary",
            )}
          >
            {line.text}
          </div>
        )) : <span className="text-text-tertiary">Console vazio. Avalie uma expressão abaixo.</span>}
      </div>
      <div className="flex shrink-0 items-center gap-1 border-t border-separator-border p-1.5">
        <Input value={consoleInput} onChange={setConsoleInput} placeholder="$ expressão" fieldClassName="h-7 font-mono text-caption-1" onKeyDown={(event) => { if (event.key === "Enter") void runConsole(); }} />
        <Button variant="ghost" size="xs" iconOnly leadingIcon={CornerDownRight} aria-label="Executar" onClick={() => void runConsole()} className="size-7" />
      </div>
    </div>
  );

  const header = (
    <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-separator-border p-2">
      {headerControl}
      <span className="flex items-center gap-1.5 text-body-2-medium text-text-primary">
        <span className="flex size-7 items-center justify-center rounded-xl bg-accent-500/10 text-accent-500"><Bug size={15} /></span>
        Debug Toph
      </span>
      <span className="flex items-center gap-1.5 rounded-full bg-background-secondary-default px-2 py-0.5 text-caption-2-regular text-text-secondary">
        <span className={cx("size-2 rounded-full", statusTone(connected, paused))} />
        {status}
      </span>
      <Button variant="ghost" size="small" leadingIcon={Settings2} onClick={() => setConfigOpen(true)} className="max-w-[240px] justify-start" title="Configurar linguagem, comando e modo">
        <span className="min-w-0 flex-1 truncate text-start">{configSummary}</span>
      </Button>
      <span className="min-w-0 flex-1" />
      {session ? (
        <>
          <Button variant="ghost" size="small" iconOnly leadingIcon={paused ? Play : Pause} aria-label={paused ? "Continuar" : "Pausar"} title={paused ? "Continuar" : "Pausar"} onClick={() => void togglePause()} className="size-8" />
          <Button variant="ghost" size="small" iconOnly leadingIcon={StepOverIcon} aria-label="Step over" title="Step over" onClick={() => void step("over")} disabled={!paused} className="size-8" />
          <Button variant="ghost" size="small" iconOnly leadingIcon={StepIntoIcon} aria-label="Step into" title="Step into" onClick={() => void step("into")} disabled={!paused} className="size-8" />
          <Button variant="ghost" size="small" iconOnly leadingIcon={StepOutIcon} aria-label="Step out" title="Step out" onClick={() => void step("out")} disabled={!paused} className="size-8" />
          <Button variant="ghost" size="small" iconOnly leadingIcon={RefreshCw} aria-label="Reiniciar debug" title="Reiniciar debug" onClick={() => void restartSession()} className="size-8" />
        </>
      ) : null}
      <Button
        variant={session ? "secondary" : "primary"}
        size="small"
        leadingIcon={session ? Square : Play}
        aria-label={session ? "Parar debug" : "Iniciar debug"}
        onClick={() => void (session ? stopSession() : startSession())}
        disabled={starting}
      >
        {starting ? "Iniciando..." : session ? "Parar" : "Debug"}
      </Button>
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-background-primary-default">
      {header}
      {statusError ? <div className="shrink-0 border-b border-status-rose-text/20 bg-status-rose-text/10 px-3 py-1.5 text-caption-1-regular text-status-rose-text">{statusError}</div> : null}
      {mobile ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex shrink-0 gap-1 border-b border-separator-border p-1.5">
            <Button variant={mobileTab === "ai" ? "secondary" : "ghost"} size="small" onClick={() => setMobileTab("ai")}>Toph</Button>
            <Button variant={mobileTab === "code" ? "secondary" : "ghost"} size="small" onClick={() => setMobileTab("code")}>Código e estado</Button>
          </div>
          {mobileTab === "ai" ? aiPane : (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex min-h-0 flex-1 flex-col">{editorPane}</div>
              <div className="max-h-[45%] shrink-0 overflow-y-auto border-t border-separator-border">{statePane}</div>
              {consoleOpen ? <div className="h-36 shrink-0 border-t border-separator-border">{consolePane}</div> : null}
            </div>
          )}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <aside className="flex w-64 shrink-0 flex-col overflow-hidden border-e border-separator-border bg-background-secondary-default">{statePane}</aside>
          <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
            {editorPane}
            {consoleOpen ? <div className="h-36 shrink-0 border-t border-separator-border">{consolePane}</div> : null}
          </div>
          <aside className="flex w-[22rem] shrink-0 flex-col overflow-hidden border-s border-separator-border bg-background-secondary-default">{aiPane}</aside>
        </div>
      )}
      <Modal isOpen={filesOpen} onClose={() => setFilesOpen(false)} title="Abrir arquivo" description={project.name} placement="bottom" size="lg" bodyClassName="p-3" swipeToClose>
        <Input value={fileQuery} onChange={setFileQuery} placeholder="Filtrar arquivos" leadingIcon={Search} fieldClassName="h-9" />
        <div className="mt-2 max-h-[50dvh] overflow-y-auto">
          {filteredFiles.map((path) => (
            <button key={path} type="button" onClick={() => { setFilesOpen(false); void openFile(path); }} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-start text-caption-1-regular text-text-secondary hover:bg-background-primary-hover">
              <span className="min-w-0 flex-1 truncate">{path}</span>
              {breakpoints.some((item) => item.path === path) ? <CircleDot size={12} className="shrink-0 text-status-rose-text" /> : null}
            </button>
          ))}
          {filteredFiles.length === 0 ? <p className="px-2 py-4 text-center text-caption-1-regular text-text-tertiary">Nenhum arquivo encontrado.</p> : null}
        </div>
      </Modal>
      <Modal isOpen={configOpen} onClose={() => setConfigOpen(false)} title="Configuração do debug" description="O Toph usa esta configuração para iniciar ou anexar a sessão." size="sm">
        <div className="flex flex-col gap-2">
          <label className="text-caption-1-regular text-text-secondary">Linguagem</label>
          <Select
            size="sm"
            aria-label="Linguagem de debug"
            selectedKey={language}
            isDisabled={Boolean(session)}
            onSelectionChange={(key) => setConfig(project.id, { language: String(key) as "node" | "python", ...(String(key) === "python" && mode === "attach" ? { mode: "launch" as const } : {}) })}
          >
            <SelectItem id="node">Node.js</SelectItem>
            <SelectItem id="python">Python (debugpy)</SelectItem>
          </Select>
          <label className="text-caption-1-regular text-text-secondary">Modo</label>
          <Select size="sm" aria-label="Modo de debug" selectedKey={mode} isDisabled={Boolean(session)} onSelectionChange={(key) => setConfig(project.id, { mode: String(key) as "launch" | "attach" })}>
            <SelectItem id="launch">Iniciar</SelectItem>
            <SelectItem id="attach">Anexar</SelectItem>
          </Select>
          {mode === "attach" ? (
            <>
              <label className="text-caption-1-regular text-text-secondary">Endereço</label>
              <Input value={config.address} onChange={(value) => setConfig(project.id, { address: value })} placeholder="127.0.0.1:9229 ou 5678" fieldClassName="h-9 font-mono text-caption-1" />
            </>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <label className="text-caption-1-regular text-text-secondary">{language === "python" ? "Script Python" : "Comando"}</label>
                <Button variant="ghost" size="xs" onClick={() => void detectCommand()}>Detectar</Button>
              </div>
              <Input value={config.command} onChange={(value) => setConfig(project.id, { command: value })} placeholder={language === "python" ? "app.py" : "npm run dev"} fieldClassName="h-9 font-mono text-caption-1" />
            </>
          )}
          <label className="text-caption-1-regular text-text-secondary">Diretório de trabalho (opcional)</label>
          <Input value={config.cwd} onChange={(value) => setConfig(project.id, { cwd: value })} placeholder={project.root} fieldClassName="h-9 font-mono text-caption-1" />
          <p className="text-caption-2-regular text-text-tertiary">
            {language === "python" ? "Python usa debugpy, empacotado no build." : "Node usa o inspector nativo."} A sessão continua viva ao trocar de painel; use Parar para encerrar.
          </p>
          <Button className="w-full justify-center" onClick={() => setConfigOpen(false)}>Concluir</Button>
        </div>
      </Modal>
      <Modal isOpen={Boolean(breakpointEditing)} onClose={() => setBreakpointEditing(null)} title="Editar breakpoint" description={breakpointEditing ? `${breakpointEditing.path}:${breakpointEditing.line}` : ""} placement="bottom" size="sm" bodyClassName="p-3" swipeToClose>
        <div className="flex flex-col gap-2">
          <label className="text-caption-1-regular text-text-secondary">Condição (opcional)</label>
          <Input value={breakpointDraft.condition} onChange={(value) => setBreakpointDraft((current) => ({ ...current, condition: value }))} placeholder="ex.: user.id === 42" fieldClassName="h-9 font-mono text-caption-1" />
          <label className="text-caption-1-regular text-text-secondary">Logpoint (opcional)</label>
          <Input value={breakpointDraft.logMessage} onChange={(value) => setBreakpointDraft((current) => ({ ...current, logMessage: value }))} placeholder="ex.: user carregado" fieldClassName="h-9 text-caption-1" />
          <p className="text-caption-2-regular text-text-tertiary">Use condição ou logpoint. Logpoint imprime e continua a execução.</p>
          <Button className="w-full" onClick={saveBreakpointEditor}>Salvar</Button>
        </div>
      </Modal>
    </div>
  );
}

function StepOverIcon({ className }: { className?: string }) {
  return <StepForward className={className} />;
}
function StepIntoIcon({ className }: { className?: string }) {
  return <ArrowDownToLine className={className} />;
}
function StepOutIcon({ className }: { className?: string }) {
  return <ArrowUpFromLine className={className} />;
}
