import { afterEach, describe, expect, it } from "vitest";
import type { AIModel } from "../../shared/api";
import { defaultModel, modelDisplay, modelGroup, rememberModel } from "./store";

describe("provider connection labels", () => {
  it("shows the real connection name instead of the protocol", () => {
    const model = { id: "default::deepseek-v4.1-flash", label: "deepseek-v4.1-flash", provider: "custom", connectionLabel: "OpenCode Go" };
    expect(modelGroup(model)).toBe("OpenCode Go");
    expect(modelDisplay(model)).toBe("OpenCode Go · deepseek-v4.1-flash");
  });

  it("falls back to the protocol only when no connection name exists", () => {
    expect(modelDisplay({ id: "openai::gpt-6-astra", label: "gpt-6-astra", provider: "openai" })).toBe("OpenAI · gpt-6-astra");
  });
});

const models: AIModel[] = [
  { id: "opencode-go/deepseek-v4.1-flash", label: "DeepSeek V4.1 Flash", provider: "custom" },
  { id: "openai/gpt", label: "GPT", provider: "openai" },
];

afterEach(() => localStorage.removeItem("jeff_preferred_model"));

describe("defaultModel", () => {
  it("starts on the harness default when nothing was picked yet", () => {
    expect(defaultModel(models, null)).toBe("opencode-go/deepseek-v4.1-flash");
  });

  it("remembers the last model picked in a task", () => {
    rememberModel("openai/gpt");
    expect(defaultModel(models, null)).toBe("openai/gpt");
  });

  it("falls back when the remembered model is no longer offered", () => {
    rememberModel("removed/model");
    expect(defaultModel(models, null)).toBe("opencode-go/deepseek-v4.1-flash");
  });
});
