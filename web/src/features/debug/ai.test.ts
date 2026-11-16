import { describe, expect, it } from "vitest";
import { describeAction, parseDebugAiTurn, type DebugObservation } from "./ai";
import { buildObservationPrompt } from "./ai";

const observation: DebugObservation = {
  session: { language: "python", mode: "launch", status: "pausado", command: "app.py", cwd: "", address: "debugpy" },
  paused: true,
  reason: "breakpoint",
  location: { path: "app.py", line: 2, name: "compute" },
  callStack: [{ name: "compute", path: "app.py", line: 2 }],
  scopes: [{ name: "Locals", variables: [{ name: "value", value: "0", type: "int" }] }],
  watches: [{ expression: "value", value: "0" }],
  breakpoints: [{ path: "app.py", line: 2 }],
  console: ["Pausado em compute · linha 2."],
  files: ["app.py"],
  currentFile: { path: "app.py", content: "def compute(value):\n    return value\n" },
  documents: [],
  bug: "",
  reproduction: "",
};

describe("debug AI protocol", () => {
  it("reads a JSON turn wrapped in a code fence", () => {
    const turn = parseDebugAiTurn('```json\n{"say":"Vou olhar o payload.","action":{"type":"evaluate","expression":"value"}}\n```');
    expect(turn.say).toBe("Vou olhar o payload.");
    expect(turn.action).toMatchObject({ type: "evaluate", expression: "value" });
  });

  it("keeps breakpoints and drops malformed lines", () => {
    const turn = parseDebugAiTurn(JSON.stringify({
      say: "Breakpoints.",
      action: {
        type: "set_breakpoints",
        breakpoints: [
          { path: "app.py", line: 2, condition: "value > 0" },
          { path: "app.py", line: 0 },
          { line: 4 },
        ],
      },
    }));
    expect(turn.action?.breakpoints).toEqual([{ path: "app.py", line: 2, condition: "value > 0" }]);
  });

  it("falls back to prose when the model does not answer JSON", () => {
    const turn = parseDebugAiTurn("Vou verificar o valor de value.");
    expect(turn.say).toBe("Vou verificar o valor de value.");
    expect(turn.action).toBeNull();
  });

  it("describes actions for the timeline", () => {
    expect(describeAction({ type: "step_over" })).toContain("próxima linha");
    expect(describeAction({ type: "set_breakpoints", breakpoints: [{ path: "a.py", line: 1 }] })).toContain("1 breakpoint");
  });

  it("sends the observation and the user's guidance to the model", () => {
    const prompt = buildObservationPrompt(observation, "Olhe a variável value.");
    expect(prompt).toContain('"status":"pausado"');
    expect(prompt).toContain("Orientação do usuário: Olhe a variável value.");
    expect(prompt).toContain("Responda somente com o JSON");
  });
});
