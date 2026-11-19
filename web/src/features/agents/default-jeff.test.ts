import { beforeEach, describe, expect, it } from "vitest";
import { useChats } from "../conversations/store";
import { DEFAULT_JEFF, ensureSingleJeff } from "./default-jeff";

beforeEach(() => {
  useChats.setState({ byProject: {}, messageWrites: {} });
  useChats.getState().load("p");
});

describe("ensureSingleJeff", () => {
  it("creates the fixed logo Jeff when the project has none", () => {
    const { jeff, removedIds } = ensureSingleJeff("p");

    expect(removedIds).toEqual([]);
    expect(jeff).not.toBeNull();
    expect(jeff?.name).toBe("Jeff");
    expect(jeff?.handle).toBe("jeff");
    expect(jeff?.avatar).toBe("jeff-logo");
    expect(useChats.getState().byProject.p.jeffs).toHaveLength(1);
  });

  it("keeps one Jeff, drops the extras and resets it to the fixed identity", () => {
    const first = useChats.getState().createJeff("p", {
      ...DEFAULT_JEFF,
      name: "Leo",
      role: "Dev",
      prompt: "custom",
      model: "openai::gpt",
      mcpServers: ["chrome"],
      emailAccountIds: ["work"],
    })!;
    const second = useChats.getState().createJeff("p", { ...DEFAULT_JEFF, name: "Nico" })!;
    const solo = useChats.getState().createConversation("p", [first.id])!;
    const extra = useChats.getState().createConversation("p", [second.id])!;
    const group = useChats.getState().createConversation("p", [first.id, second.id])!;

    const { jeff, removedIds } = ensureSingleJeff("p");
    const project = useChats.getState().byProject.p;

    expect(removedIds).toEqual([second.id]);
    expect(project.jeffs).toHaveLength(1);
    expect(project.jeffs[0].id).toBe(first.id);
    expect(project.jeffs[0].name).toBe("Jeff");
    expect(project.jeffs[0].handle).toBe("jeff");
    expect(project.jeffs[0].role).toBe("Jeff");
    expect(project.jeffs[0].prompt).toBe("");
    expect(project.jeffs[0].model).toBe("");
    expect(project.jeffs[0].mcpServers).toEqual([]);
    expect(project.jeffs[0].emailAccountIds).toEqual([]);
    expect(jeff?.id).toBe(first.id);
    expect(project.chats.map((chat) => chat.id)).toEqual([solo.id, group.id]);
    expect(project.chats.find((chat) => chat.id === group.id)?.participantIds).toEqual([first.id]);
    expect(project.chats.some((chat) => chat.id === extra.id)).toBe(false);
  });
});
