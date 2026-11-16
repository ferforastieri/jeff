import type { DebugSessionInfo } from "../../shared/api";

export interface DebugFrame {
  id: number | string;
  name: string;
  path: string;
  line: number;
  column?: number;
  /** Node: the scope chain used to read locals. */
  scopeChain?: Array<{ type: string; object: { objectId?: string } }>;
}

export interface DebugVariable {
  name: string;
  value: string;
  type?: string;
  /** Node: CDP object id. Python: DAP variablesReference. */
  reference?: number | string;
}

export interface DebugScope {
  name: string;
  variablesReference: number | string;
  variables: DebugVariable[];
}

export interface BreakpointSpec {
  id?: string;
  path: string;
  line: number;
  condition?: string;
  logMessage?: string;
  enabled?: boolean;
}

export interface DebugRunConfig {
  language: "node" | "python";
  mode: "launch" | "attach";
  command: string;
  address: string;
  cwd: string;
  projectRoot: string;
}

export type EngineEvent =
  | { type: "paused"; reason: string; frames: DebugFrame[]; threadId?: number }
  | { type: "resumed" }
  | { type: "output"; kind: "console" | "stderr" | "stdout" | "telemetry"; text: string }
  | { type: "terminated"; reason?: string }
  | { type: "breakpoint"; verified: boolean; path?: string; line?: number; message?: string };

export interface DebugEngine {
  connect(session: DebugSessionInfo, config: DebugRunConfig, breakpoints: BreakpointSpec[]): Promise<void>;
  /** Reattach to an adapter that already survived a page reload. */
  restore?(session: DebugSessionInfo, projectRoot: string): Promise<void>;
  disconnect(terminate: boolean): Promise<void>;
  setBreakpoints(breakpoints: BreakpointSpec[]): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  step(kind: "over" | "into" | "out"): Promise<void>;
  refreshFrames(): Promise<DebugFrame[]>;
  scopes(frame: DebugFrame): Promise<DebugScope[]>;
  variables(reference: DebugScope["variablesReference"]): Promise<DebugVariable[]>;
  evaluate(expression: string, frame?: DebugFrame): Promise<string>;
  on(listener: (event: EngineEvent) => void): () => void;
}

export function valueText(value: unknown): string {
  if (!value || typeof value !== "object") return String(value ?? "undefined");
  const item = value as {
    value?: unknown;
    description?: string;
    type?: string;
    unserializableValue?: string;
  };
  if (item.unserializableValue) return item.unserializableValue;
  if (item.value !== undefined) {
    return typeof item.value === "string" ? `"${item.value}"` : String(item.value);
  }
  return item.description ?? item.type ?? "undefined";
}

export function relativePath(projectRoot: string, url: string): string {
  let path = url;
  try {
    if (path.startsWith("file://")) path = decodeURIComponent(new URL(path).pathname);
  } catch {
    // Keep the raw value.
  }
  const root = projectRoot.replace(/\/+$/, "");
  if (path.startsWith(root + "/")) return path.slice(root.length + 1);
  return path;
}

export function absolutePath(projectRoot: string, path: string): string {
  if (path.startsWith("/")) return path;
  return `${projectRoot.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function fileUrl(projectRoot: string, path: string): string {
  return `file://${encodeURI(absolutePath(projectRoot, path)).replace(/#/g, "%23")}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

class CdpClient {
  private socket: WebSocket;
  private nextId = 1;
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  private handlers = new Set<(message: Record<string, unknown>) => void>();

  constructor(url: string) {
    this.socket = new WebSocket(url);
  }

  open(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket.onopen = () => resolve();
      this.socket.onerror = () => reject(new Error("Falha ao conectar ao inspector."));
    });
  }

  bind() {
    this.socket.onmessage = (event) => {
      let message: Record<string, unknown>;
      try {
        message = JSON.parse(String(event.data)) as Record<string, unknown>;
      } catch {
        return;
      }
      const messageId = typeof message.id === "number" ? message.id : null;
      if (messageId) {
        const request = this.pending.get(messageId);
        if (request) {
          this.pending.delete(messageId);
          if (message.error) {
            request.reject(new Error((message.error as { message?: string }).message ?? "Erro do debugger."));
          } else {
            request.resolve(message.result);
          }
        }
        return;
      }
      for (const handler of this.handlers) handler(message);
    };
    this.socket.onclose = () => {
      for (const request of this.pending.values()) request.reject(new Error("Sessão de debug encerrada."));
      this.pending.clear();
    };
  }

  send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    if (this.socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error("Debugger desconectado."));
    const requestId = this.nextId++;
    this.socket.send(JSON.stringify({ id: requestId, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      window.setTimeout(() => {
        if (this.pending.delete(requestId)) reject(new Error(`Timeout em ${method}.`));
      }, 15_000);
    });
  }

  on(handler: (message: Record<string, unknown>) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  close() {
    try {
      this.socket.close();
    } catch {
      // Already closed.
    }
    this.handlers.clear();
    this.pending.clear();
  }
}

interface NodeFrame extends DebugFrame {
  scopeChain: Array<{ type: string; object: { objectId?: string } }>;
}

class NodeEngine implements DebugEngine {
  private client: CdpClient | null = null;
  private listeners = new Set<(event: EngineEvent) => void>();
  private root = "";
  private scriptUrls = new Map<string, string>();
  private sentBreakpoints = new Map<string, string>();
  private frames: NodeFrame[] = [];
  private lastConfig: DebugRunConfig | null = null;

  async connect(session: DebugSessionInfo, config: DebugRunConfig, breakpoints: BreakpointSpec[]): Promise<void> {
    this.root = config.projectRoot;
    this.lastConfig = config;
    const client = new CdpClient(session.wsUrl);
    this.client = client;
    await client.open();
    client.bind();
    client.on((message) => this.handle(message));
    await client.send("Runtime.enable");
    await client.send("Debugger.enable");
    await client.send("Debugger.setPauseOnExceptions", { state: "uncaught" });
    await this.setBreakpoints(breakpoints);
    if (config.mode === "launch") {
      await client.send("Runtime.runIfWaitingForDebugger").catch(() => undefined);
    }
  }

  private handle(message: Record<string, unknown>): void {
    const method = message.method;
    const params = (message.params ?? {}) as Record<string, unknown>;
    if (method === "Debugger.scriptParsed") {
      const scriptId = String(params.scriptId ?? "");
      const url = String(params.url ?? "");
      if (scriptId && url) this.scriptUrls.set(scriptId, url);
      return;
    }
    if (method === "Debugger.paused") {
      const rawFrames = Array.isArray(params.callFrames) ? params.callFrames as Array<Record<string, unknown>> : [];
      const frames: NodeFrame[] = rawFrames.map((frame) => {
        const location = (frame.location ?? {}) as { scriptId?: string; lineNumber?: number; columnNumber?: number };
        const url = String((frame.url as string | undefined) || this.scriptUrls.get(String(location.scriptId ?? "")) || "");
        return {
          id: String(frame.callFrameId ?? ""),
          name: String(frame.functionName ?? "(anonymous)"),
          path: relativePath(this.root, url),
          line: Number(location.lineNumber ?? 0) + 1,
          column: Number(location.columnNumber ?? 0) + 1,
          scopeChain: Array.isArray(frame.scopeChain) ? frame.scopeChain as NodeFrame["scopeChain"] : [],
        };
      });
      this.frames = frames;
      const reason = String(params.reason ?? "paused");
      if (reason === "Break on start" && !Array.isArray(params.hitBreakpoints)) {
        // The inspector always starts paused with --inspect-brk. Run to the
        // first breakpoint; that is what a Debug button should do.
        void this.client?.send("Debugger.resume").catch(() => undefined);
        return;
      }
      this.emit({ type: "paused", reason, frames, threadId: 0 });
      return;
    }
    if (method === "Debugger.resumed") {
      this.frames = [];
      this.emit({ type: "resumed" });
      return;
    }
    if (method === "Runtime.consoleAPICalled") {
      const type = String(params.type ?? "log");
      const text = (Array.isArray(params.args) ? params.args : []).map(valueText).join(" ");
      this.emit({ type: "output", kind: type === "error" || type === "assert" ? "stderr" : "console", text });
      return;
    }
    if (method === "Runtime.exceptionThrown") {
      const details = (params.exceptionDetails ?? {}) as { text?: string; exception?: unknown };
      this.emit({
        type: "output",
        kind: "stderr",
        text: `${details.text ?? "Exceção"} ${details.exception ? valueText(details.exception) : ""}`.trim(),
      });
      return;
    }
  }

  private emit(event: EngineEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  on(listener: (event: EngineEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async disconnect(): Promise<void> {
    this.client?.close();
    this.client = null;
    this.frames = [];
    this.sentBreakpoints.clear();
  }

  async setBreakpoints(breakpoints: BreakpointSpec[]): Promise<void> {
    const client = this.client;
    if (!client) return;
    for (const breakpointId of this.sentBreakpoints.values()) {
      await client.send("Debugger.removeBreakpoint", { breakpointId }).catch(() => undefined);
    }
    this.sentBreakpoints.clear();
    for (const breakpoint of breakpoints) {
      if (breakpoint.enabled === false) continue;
      const condition = breakpoint.logMessage
        ? `console.log(${JSON.stringify(breakpoint.logMessage)}), false`
        : breakpoint.condition || undefined;
      try {
        const result = await client.send("Debugger.setBreakpointByUrl", {
          lineNumber: Math.max(0, breakpoint.line - 1),
          url: fileUrl(this.root, breakpoint.path),
          condition,
        }) as { breakpointId?: string };
        if (result?.breakpointId) this.sentBreakpoints.set(breakpoint.id ?? `${breakpoint.path}:${breakpoint.line}`, result.breakpointId);
      } catch {
        // The runtime has not loaded this file yet.
      }
    }
  }

  async pause(): Promise<void> {
    await this.client?.send("Debugger.pause");
  }

  async resume(): Promise<void> {
    await this.client?.send("Debugger.resume");
  }

  async step(kind: "over" | "into" | "out"): Promise<void> {
    await this.client?.send(kind === "over" ? "Debugger.stepOver" : kind === "into" ? "Debugger.stepInto" : "Debugger.stepOut");
  }

  async refreshFrames(): Promise<DebugFrame[]> {
    return this.frames;
  }

  async scopes(frame: DebugFrame): Promise<DebugScope[]> {
    const client = this.client;
    const nodeFrame = this.frames.find((item) => item.id === frame.id);
    if (!client || !nodeFrame) return [];
    const scopes = await Promise.all(nodeFrame.scopeChain.map(async (scope) => {
      if (!scope.object.objectId) return { name: scope.type, variablesReference: "", variables: [] };
      try {
        const result = await client.send("Runtime.getProperties", {
          objectId: scope.object.objectId,
          ownProperties: true,
          generatePreview: false,
        }) as { result?: Array<{ name: string; value?: unknown }> };
        const variables = (result.result ?? [])
          .filter((item) => item.name !== "this" || scope.type === "local")
          .slice(0, 120)
          .map((item) => {
            const value = item.value as { type?: string; objectId?: string } | undefined;
            return {
              name: item.name,
              value: valueText(item.value),
              type: value?.type ?? "",
              reference: value?.objectId,
            };
          });
        return { name: scope.type, variablesReference: scope.object.objectId, variables };
      } catch {
        return { name: scope.type, variablesReference: scope.object.objectId, variables: [] };
      }
    }));
    return scopes;
  }

  async variables(reference: DebugScope["variablesReference"]): Promise<DebugVariable[]> {
    const client = this.client;
    if (!client || typeof reference !== "string" || !reference) return [];
    const result = await client.send("Runtime.getProperties", {
      objectId: reference,
      ownProperties: true,
      generatePreview: false,
    }) as { result?: Array<{ name: string; value?: unknown }> };
    return (result.result ?? []).slice(0, 200).map((item) => {
      const value = item.value as { type?: string; objectId?: string } | undefined;
      return {
        name: item.name,
        value: valueText(item.value),
        type: value?.type ?? "",
        reference: value?.objectId,
      };
    });
  }

  async evaluate(expression: string, frame?: DebugFrame): Promise<string> {
    const client = this.client;
    if (!client) throw new Error("Debugger desconectado.");
    const result = frame
      ? await client.send("Debugger.evaluateOnCallFrame", { callFrameId: frame.id, expression, returnByValue: false })
      : await client.send("Runtime.evaluate", { expression, returnByValue: false, awaitPromise: true });
    const parsed = result as { result?: unknown; exceptionDetails?: { text?: string } };
    if (parsed.exceptionDetails) throw new Error(parsed.exceptionDetails.text ?? "Exceção");
    return valueText(parsed.result);
  }

  config(): DebugRunConfig | null {
    return this.lastConfig;
  }
}

interface DapMessage {
  seq?: number;
  type?: string;
  command?: string;
  event?: string;
  request_seq?: number;
  success?: boolean;
  message?: string;
  body?: Record<string, unknown>;
  arguments?: Record<string, unknown>;
}

class DapClient {
  private socket: WebSocket;
  private nextId = 1;
  private pending = new Map<number, { resolve: (value: DapMessage) => void; reject: (error: Error) => void }>();
  private handlers = new Set<(message: DapMessage) => void>();

  constructor(url: string) {
    this.socket = new WebSocket(url);
  }

  open(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket.onopen = () => resolve();
      this.socket.onerror = () => reject(new Error("Falha ao conectar ao adapter de debug."));
    });
  }

  bind() {
    this.socket.onmessage = (event) => {
      let message: DapMessage;
      try {
        message = JSON.parse(String(event.data)) as DapMessage;
      } catch {
        return;
      }
      if (message.type === "response" && typeof message.request_seq === "number") {
        const request = this.pending.get(message.request_seq);
        if (request) {
          this.pending.delete(message.request_seq);
          if (message.success === false) request.reject(new Error(message.message || "Erro do debugger."));
          else request.resolve(message);
        }
        return;
      }
      for (const handler of this.handlers) handler(message);
    };
    this.socket.onclose = () => {
      for (const request of this.pending.values()) request.reject(new Error("Sessão de debug encerrada."));
      this.pending.clear();
    };
  }

  send(command: string, args: Record<string, unknown> = {}): Promise<DapMessage> {
    if (this.socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error("Debugger desconectado."));
    const seq = this.nextId++;
    this.socket.send(JSON.stringify({ seq, type: "request", command, arguments: args }));
    return new Promise((resolve, reject) => {
      this.pending.set(seq, { resolve, reject });
      window.setTimeout(() => {
        if (this.pending.delete(seq)) reject(new Error(`Timeout em ${command}.`));
      }, 20_000);
    });
  }

  on(handler: (message: DapMessage) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  respond(message: DapMessage, success: boolean, body: Record<string, unknown> = {}, text = ""): void {
    if (this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify({
      seq: this.nextId++,
      type: "response",
      request_seq: message.seq,
      success,
      command: message.command,
      body,
      message: text,
    }));
  }

  close() {
    try {
      this.socket.close();
    } catch {
      // Already closed.
    }
    this.handlers.clear();
    this.pending.clear();
  }
}

class PythonEngine implements DebugEngine {
  private client: DapClient | null = null;
  private listeners = new Set<(event: EngineEvent) => void>();
  private root = "";
  private frames: DebugFrame[] = [];
  private lastThreadId: number | undefined;
  private configurationDone = false;
  private initialized = false;

  async connect(session: DebugSessionInfo, config: DebugRunConfig, breakpoints: BreakpointSpec[]): Promise<void> {
    this.root = config.projectRoot;
    const client = new DapClient(session.wsUrl);
    this.client = client;
    await client.open();
    client.bind();
    client.on((message) => this.handle(message));
    const initialized = new Promise<void>((resolve) => {
      const timer = window.setTimeout(() => {
        unsubscribe();
        resolve();
      }, 3000);
      const unsubscribe = client.on((message) => {
        if (message.type === "event" && message.event === "initialized") {
          window.clearTimeout(timer);
          unsubscribe();
          resolve();
        }
      });
    });
    await client.send("initialize", {
      adapterID: "python",
      clientID: "toph",
      clientName: "Toph",
      linesStartAt1: true,
      columnsStartAt1: true,
      pathFormat: "path",
      supportsConfigurationDoneRequest: true,
      supportsConditionalBreakpoints: true,
      supportsHitConditionalBreakpoints: true,
      supportsLogPoints: true,
      supportsEvaluateForHovers: true,
      supportsSetVariable: true,
      supportsTerminateRequest: true,
      supportsRestartRequest: true,
      supportsExceptionInfoRequest: true,
      supportsDelayedStackTraceLoading: true,
    });
    await initialized;
    const launch = this.launchArguments(config);
    const launchPromise = client.send(config.mode === "attach" ? "attach" : "launch", launch);
    await this.setBreakpoints(breakpoints);
    await client.send("configurationDone", {});
    this.configurationDone = true;
    await launchPromise;
  }

  /** The adapter already lives on the server after a page reload: reuse it. */
  async restore(session: DebugSessionInfo, projectRoot: string): Promise<void> {
    this.root = projectRoot;
    const client = new DapClient(session.wsUrl);
    this.client = client;
    await client.open();
    client.bind();
    client.on((message) => this.handle(message));
    this.initialized = true;
    this.configurationDone = true;
  }

  private launchArguments(config: DebugRunConfig): Record<string, unknown> {
    if (config.language !== "python") return {};
    const cwd = config.cwd.trim()
      ? (config.cwd.startsWith("/") ? config.cwd : `${config.projectRoot.replace(/\/+$/, "")}/${config.cwd.replace(/^\/+/, "")}`)
      : config.projectRoot;
    if (config.mode === "attach") {
      const [host, port] = config.address.split(":");
      return {
        connect: { host: host || "127.0.0.1", port: Number(port) || 5678 },
        justMyCode: false,
        pathMappings: [{ localRoot: config.projectRoot, remoteRoot: config.projectRoot }],
      };
    }
    const command = config.command.trim();
    const parts = command.split(/\s+/).filter(Boolean);
    if (parts[0] === "-m" && parts[1]) {
      return {
        module: parts[1],
        args: parts.slice(2),
        cwd,
        justMyCode: false,
        console: "internalConsole",
        stopOnEntry: false,
      };
    }
    const script = parts[0] || "main.py";
    return {
      program: script.startsWith("/") ? script : `${cwd.replace(/\/+$/, "")}/${script}`,
      args: parts.slice(1),
      cwd,
      justMyCode: false,
      console: "internalConsole",
      stopOnEntry: false,
    };
  }

  private handle(message: DapMessage): void {
    if (message.type === "event") {
      if (message.event === "initialized") {
        this.initialized = true;
        return;
      }
      if (message.event === "stopped") {
        const body = message.body ?? {};
        const threadId = Number(body.threadId ?? 0);
        this.lastThreadId = threadId;
        void this.loadFrames(threadId).then((frames) => {
          this.frames = frames;
          this.emit({ type: "paused", reason: String(body.reason ?? "paused"), frames, threadId });
        }).catch(() => {
          this.emit({ type: "paused", reason: String(body.reason ?? "paused"), frames: [], threadId });
        });
        return;
      }
      if (message.event === "continued") {
        this.frames = [];
        this.emit({ type: "resumed" });
        return;
      }
      if (message.event === "output") {
        const body = message.body ?? {};
        const category = String(body.category ?? "console");
        const text = String(body.output ?? "");
        if (text) {
          this.emit({
            type: "output",
            kind: category === "stderr" ? "stderr" : category === "telemetry" ? "telemetry" : category === "stdout" ? "stdout" : "console",
            text,
          });
        }
        return;
      }
      if (message.event === "terminated" || message.event === "exited") {
        this.frames = [];
        this.emit({ type: "terminated", reason: String(message.body?.exitCode ?? "") });
        return;
      }
      if (message.event === "breakpoint") {
        const body = message.body ?? {};
        const breakpoint = (body.breakpoint ?? {}) as { verified?: boolean; source?: { path?: string }; line?: number; message?: string };
        this.emit({
          type: "breakpoint",
          verified: Boolean(breakpoint.verified),
          path: breakpoint.source?.path ? relativePath(this.root, breakpoint.source.path) : undefined,
          line: breakpoint.line,
          message: breakpoint.message,
        });
        return;
      }
    }
    // A DAP reverse request we do not use (runInTerminal, startDebugging).
    if (message.type === "request" && message.command) {
      this.client?.respond(message, false, {}, "Reverse request not supported in this client.");
    }
  }

  private async loadFrames(threadId: number): Promise<DebugFrame[]> {
    const client = this.client;
    if (!client) return [];
    const stack = await client.send("stackTrace", { threadId, startFrame: 0, levels: 50 });
    const frames = (stack.body?.stackFrames ?? []) as Array<Record<string, unknown>>;
    return frames.map((frame) => {
      const source = (frame.source ?? {}) as { path?: string };
      return {
        id: Number(frame.id ?? 0),
        name: String(frame.name ?? "(anonymous)"),
        path: source.path ? relativePath(this.root, source.path) : "",
        line: Number(frame.line ?? 1),
        column: Number(frame.column ?? 1),
      };
    });
  }

  private emit(event: EngineEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  on(listener: (event: EngineEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async disconnect(terminate: boolean): Promise<void> {
    if (terminate) {
      try {
        await this.client?.send("disconnect", { terminateDebuggee: true });
      } catch {
        // The adapter may already be gone.
      }
    }
    this.client?.close();
    this.client = null;
    this.frames = [];
  }

  async setBreakpoints(breakpoints: BreakpointSpec[]): Promise<void> {
    const client = this.client;
    if (!client) return;
    const byPath = new Map<string, BreakpointSpec[]>();
    for (const breakpoint of breakpoints) {
      if (breakpoint.enabled === false) continue;
      byPath.set(breakpoint.path, [...(byPath.get(breakpoint.path) ?? []), breakpoint]);
    }
    await Promise.all([...byPath.entries()].map(async ([path, items]) => {
      const absolute = path.startsWith("/") ? path : `${this.root.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
      await client.send("setBreakpoints", {
        source: { path: absolute },
        breakpoints: items.map((item) => ({
          line: item.line,
          condition: item.condition || undefined,
          logMessage: item.logMessage || undefined,
        })),
      }).catch(() => undefined);
    }));
  }

  async pause(): Promise<void> {
    await this.client?.send("pause", { threadId: this.lastThreadId });
  }

  async resume(): Promise<void> {
    await this.client?.send("continue", { threadId: this.lastThreadId });
  }

  async step(kind: "over" | "into" | "out"): Promise<void> {
    await this.client?.send(kind === "over" ? "next" : kind === "into" ? "stepIn" : "stepOut", { threadId: this.lastThreadId });
  }

  async refreshFrames(): Promise<DebugFrame[]> {
    if (this.frames.length) return this.frames;
    if (!this.client) return [];
    const threads = await this.client.send("threads", {});
    const first = (threads.body?.threads ?? []) as Array<{ id?: number }>;
    const threadId = Number(first[0]?.id ?? this.lastThreadId ?? 0);
    if (!threadId) return [];
    this.lastThreadId = threadId;
    this.frames = await this.loadFrames(threadId);
    return this.frames;
  }

  async scopes(frame: DebugFrame): Promise<DebugScope[]> {
    const client = this.client;
    if (!client) return [];
    const result = await client.send("scopes", { frameId: frame.id });
    const raw = (result.body?.scopes ?? []) as Array<{ name?: string; variablesReference?: number }>;
    return Promise.all(raw.map(async (scope) => {
      const reference = Number(scope.variablesReference ?? 0);
      const variables = reference
        ? await this.variables(reference)
        : [];
      return { name: String(scope.name ?? "Scope"), variablesReference: reference, variables };
    }));
  }

  async variables(reference: DebugScope["variablesReference"]): Promise<DebugVariable[]> {
    const client = this.client;
    if (!client || typeof reference !== "number" || !reference) return [];
    const result = await client.send("variables", { variablesReference: reference });
    const raw = (result.body?.variables ?? []) as Array<{ name?: string; value?: string; type?: string; variablesReference?: number }>;
    return raw.slice(0, 200).map((item) => ({
      name: String(item.name ?? ""),
      value: String(item.value ?? ""),
      type: item.type,
      reference: item.variablesReference || undefined,
    }));
  }

  async evaluate(expression: string, frame?: DebugFrame): Promise<string> {
    const client = this.client;
    if (!client) throw new Error("Debugger desconectado.");
    const result = await client.send("evaluate", {
      expression,
      frameId: frame?.id,
      context: frame ? "watch" : "repl",
    });
    return String(result.body?.result ?? "");
  }

  get ready(): boolean {
    return this.initialized && this.configurationDone;
  }
}

export function createEngine(language: "node" | "python"): DebugEngine & { config?: () => DebugRunConfig | null } {
  return language === "python" ? new PythonEngine() : new NodeEngine();
}

export { sleep };
