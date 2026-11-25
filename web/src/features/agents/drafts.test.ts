import { beforeEach, describe, expect, it, vi } from "vitest";
import { useJeffDrafts } from "./drafts";

const PREFIX = "jeff.draft.";

function clearDraftStorage(): void {
  for (let index = localStorage.length - 1; index >= 0; index -= 1) {
    const key = localStorage.key(index);
    if (key?.startsWith(PREFIX)) localStorage.removeItem(key);
  }
}

describe("useJeffDrafts", () => {
  beforeEach(() => {
    clearDraftStorage();
    useJeffDrafts.setState({ drafts: {} });
  });

  it("writes only the changed draft and keeps the modes separate", () => {
    const drafts = useJeffDrafts.getState();
    drafts.setDraft("p1:dev:c1", "conserta o login");
    drafts.setDraft("p1:slack:r1", "manda no canal");

    expect(useJeffDrafts.getState().drafts).toEqual({
      "p1:dev:c1": "conserta o login",
      "p1:slack:r1": "manda no canal",
    });
    expect(localStorage.getItem(`${PREFIX}p1:dev:c1`)).toBe("conserta o login");
    expect(localStorage.getItem(`${PREFIX}p1:slack:r1`)).toBe("manda no canal");
  });

  it("clears a draft from memory and from storage", () => {
    const drafts = useJeffDrafts.getState();
    drafts.setDraft("p1:dev:c1", "texto");
    drafts.clearDraft("p1:dev:c1");

    expect(useJeffDrafts.getState().drafts["p1:dev:c1"]).toBeUndefined();
    expect(localStorage.getItem(`${PREFIX}p1:dev:c1`)).toBeNull();
  });

  it("clears every mode of a project without touching the others", () => {
    const drafts = useJeffDrafts.getState();
    drafts.setDraft("p1:dev:c1", "dev");
    drafts.setDraft("p1:slack:r1", "slack");
    drafts.setDraft("p2:dev:c2", "outro");

    drafts.clearProject("p1");

    expect(useJeffDrafts.getState().drafts).toEqual({ "p2:dev:c2": "outro" });
    expect(localStorage.getItem(`${PREFIX}p1:dev:c1`)).toBeNull();
    expect(localStorage.getItem(`${PREFIX}p1:slack:r1`)).toBeNull();
    expect(localStorage.getItem(`${PREFIX}p2:dev:c2`)).toBe("outro");
  });

  it("hydrates the saved drafts when the store is created", async () => {
    localStorage.setItem(`${PREFIX}p1:slack:r1`, "rascunho salvo");
    vi.resetModules();

    const fresh = await import("./drafts");

    expect(fresh.useJeffDrafts.getState().drafts).toEqual({
      "p1:slack:r1": "rascunho salvo",
    });
  });
});
