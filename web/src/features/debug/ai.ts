import type { AIMessage } from "../../shared/api";

export type DebugActionType =
  | "start"
  | "stop"
  | "continue"
  | "pause"
  | "step_over"
  | "step_into"
  | "step_out"
  | "set_breakpoints"
  | "remove_breakpoint"
  | "read_file"
  | "evaluate"
  | "wait"
  | "ask_user"
  | "done";

export interface DebugActionBreakpoint {
  path: string;
  line: number;
  condition?: string;
  logMessage?: string;
}

export interface DebugAiAction {
  type: DebugActionType;
  breakpoints?: DebugActionBreakpoint[];
  path?: string;
  line?: number;
  expression?: string;
  question?: string;
  options?: Array<{ label: string; description?: string }>;
  timeoutMs?: number;
}

export interface DebugAiTurn {
  say: string;
  action?: DebugAiAction | null;
}

export interface DebugObservation {
  session: {
    language: string;
    mode: string;
    status: string;
    command: string;
    cwd: string;
    address: string;
  } | null;
  paused: boolean;
  reason: string;
  location: { path: string; line: number; name: string } | null;
  callStack: Array<{ name: string; path: string; line: number }>;
  scopes: Array<{ name: string; variables: Array<{ name: string; value: string; type?: string }> }>;
  watches: Array<{ expression: string; value: string; error?: string }>;
  breakpoints: Array<{ path: string; line: number; condition?: string; logMessage?: string; enabled?: boolean }>;
  console: string[];
  files: string[];
  currentFile: { path: string; content: string } | null;
  documents: Array<{ path: string; content: string }>;
  bug: string;
  reproduction: string;
}

export const DEBUG_AI_SYSTEM = `Você é o Debug Toph, um engenheiro sênior que investiga bugs usando um debugger real.
Você fala com o usuário em português, de forma curta, simples e direta. O usuário está te assistindo: ele vê cada breakpoint que você cria, cada pausa e cada variável que você lê. Explique o que está fazendo como um par de programação.

Responda SEMPRE com um único objeto JSON válido, sem markdown, sem texto fora do JSON:
{
  "say": "o que você está pensando/fazendo, em 1 a 3 frases curtas",
  "action": {
    "type": "start" | "stop" | "continue" | "pause" | "step_over" | "step_into" | "step_out" | "set_breakpoints" | "remove_breakpoint" | "read_file" | "evaluate" | "wait" | "ask_user" | "done",
    "breakpoints": [{"path": "src/arquivo.ts", "line": 42, "condition": "", "logMessage": ""}],
    "path": "src/arquivo.ts",
    "line": 42,
    "expression": "req.body",
    "question": "pergunta curta",
    "options": [{"label": "Opção", "description": "detalhe"}],
    "timeoutMs": 8000
  }
}

Regras:
- Você NÃO escreve nem altera arquivos. Pode ler arquivos. Se tiver certeza da correção, descreva a proposta no "say" e encerre com "done".
- Antes de iniciar, defina pelo menos um breakpoint provável. Use "read_file" para olhar o código se precisar escolher a linha.
- Uma ação por resposta. O sistema executa, devolve o novo estado e você decide o próximo passo.
- Depois de "start" ou "continue", aguarde a execução parar. Se não houver breakpoint atingido, o estado virá "running" e você pode ajustar breakpoints.
- Quando estiver pausado, leia as variáveis relevantes com "evaluate" antes de concluir a causa. Não peça ao usuário para fazer o que você pode fazer.
- O campo "say" deve ensinar: diga o que encontrou e por que aquilo importa, sem jargão desnecessário.
- Se faltar uma decisão que só o usuário pode tomar (ex.: qual comando usar, qual caminho seguir), use "ask_user" com 2 a 4 opções curtas.
- Quando terminar a investigação, use "done" e resuma a causa provável e o próximo passo.
- Se o comando da sessão estiver vazio, peça ao usuário com "ask_user" antes de iniciar.`;

export function buildObservationPrompt(observation: DebugObservation, guidance: string): string {
  return [
    "Estado atual da sessão de debug (JSON):",
    JSON.stringify(observation),
    guidance.trim() ? `\nOrientação do usuário: ${guidance.trim()}` : "",
    "\nQual é a próxima ação? Responda somente com o JSON.",
  ].join("\n");
}

export function buildAiMessages(conversation: AIMessage[], observation: DebugObservation, guidance: string): AIMessage[] {
  return [
    { role: "system", content: DEBUG_AI_SYSTEM },
    ...conversation.slice(-12),
    { role: "user", content: buildObservationPrompt(observation, guidance) },
  ];
}

const ACTION_TYPES = new Set<DebugActionType>([
  "start",
  "stop",
  "continue",
  "pause",
  "step_over",
  "step_into",
  "step_out",
  "set_breakpoints",
  "remove_breakpoint",
  "read_file",
  "evaluate",
  "wait",
  "ask_user",
  "done",
]);

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function cleanBreakpoints(value: unknown): DebugActionBreakpoint[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const breakpoints = value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const raw = item as Record<string, unknown>;
    const path = cleanText(raw.path);
    const line = Number(raw.line);
    if (!path || !Number.isFinite(line) || line < 1) return [];
    return [{
      path,
      line: Math.round(line),
      condition: cleanText(raw.condition) || undefined,
      logMessage: cleanText(raw.logMessage) || undefined,
    }];
  });
  return breakpoints.length ? breakpoints : undefined;
}

/** Reads the model's answer even when it wraps the JSON in a code fence. */
export function parseDebugAiTurn(text: string): DebugAiTurn {
  const source = text.trim();
  const start = source.indexOf("{");
  const end = source.lastIndexOf("}");
  const raw = start >= 0 && end > start ? source.slice(start, end + 1) : "";
  if (!raw) return { say: source || "Não recebi uma resposta do modelo.", action: null };
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return { say: source || "Não consegui entender a resposta do modelo.", action: null };
  }
  const say = cleanText(parsed.say) || "Continuando a investigação.";
  const rawAction = parsed.action;
  if (!rawAction || typeof rawAction !== "object") return { say, action: null };
  const action = rawAction as Record<string, unknown>;
  const type = cleanText(action.type) as DebugActionType;
  if (!ACTION_TYPES.has(type)) return { say, action: null };
  const turn: DebugAiAction = { type };
  const breakpoints = cleanBreakpoints(action.breakpoints);
  if (breakpoints) turn.breakpoints = breakpoints;
  const path = cleanText(action.path);
  if (path) turn.path = path;
  const line = Number(action.line);
  if (Number.isFinite(line) && line > 0) turn.line = Math.round(line);
  const expression = cleanText(action.expression);
  if (expression) turn.expression = expression;
  const question = cleanText(action.question);
  if (question) turn.question = question;
  if (Array.isArray(action.options)) {
    const options = action.options.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const rawOption = item as Record<string, unknown>;
      const label = cleanText(rawOption.label);
      if (!label) return [];
      return [{ label, description: cleanText(rawOption.description) || undefined }];
    });
    if (options.length) turn.options = options;
  }
  const timeout = Number(action.timeoutMs);
  if (Number.isFinite(timeout) && timeout > 0) turn.timeoutMs = Math.min(30_000, Math.round(timeout));
  return { say, action: turn };
}

export function describeAction(action: DebugAiAction): string {
  switch (action.type) {
    case "start": return "Iniciando a sessão";
    case "stop": return "Encerrando a sessão";
    case "continue": return "Continuando a execução";
    case "pause": return "Pausando a execução";
    case "step_over": return "Passando para a próxima linha";
    case "step_into": return "Entrando na função";
    case "step_out": return "Saindo da função";
    case "set_breakpoints": return action.breakpoints?.length
      ? `Definindo ${action.breakpoints.length} breakpoint${action.breakpoints.length === 1 ? "" : "s"}`
      : "Definindo breakpoints";
    case "remove_breakpoint": return "Removendo breakpoint";
    case "read_file": return `Lendo ${action.path ?? "arquivo"}`;
    case "evaluate": return `Avaliando ${action.expression ?? "expressão"}`;
    case "wait": return "Aguardando a execução parar";
    case "ask_user": return "Preciso da sua decisão";
    case "done": return "Encerrando a investigação";
    default: return "Ação";
  }
}

export function actionBreakpointLabel(action: DebugAiAction): string | undefined {
  const first = action.breakpoints?.[0];
  if (!first) return undefined;
  const suffix = action.breakpoints && action.breakpoints.length > 1 ? ` +${action.breakpoints.length - 1}` : "";
  return `${first.path}:${first.line}${suffix}`;
}
