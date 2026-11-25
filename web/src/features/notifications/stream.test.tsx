import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../conversations/sound", () => ({
  playBotResponseSound: vi.fn(),
  playQuestionSound: vi.fn(),
  unlockBotSound: vi.fn(),
}));

import { useApp } from "../../app/store";
import { useNotificationStream } from "./stream";

type Listener = (event: MessageEvent) => void;

class FakeEventSource {
  static instances: FakeEventSource[] = [];

  readonly url: string;
  readonly withCredentials: boolean;
  readonly close = vi.fn();
  private listeners = new Map<string, Set<Listener>>();

  constructor(url: string, init?: { withCredentials?: boolean }) {
    this.url = url;
    this.withCredentials = init?.withCredentials ?? false;
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: Listener): void {
    const set = this.listeners.get(type) ?? new Set<Listener>();
    set.add(listener);
    this.listeners.set(type, set);
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type: string, payload: unknown): void {
    const event = { data: JSON.stringify(payload) } as MessageEvent;
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  useApp.setState({
    notifications: [],
    projects: [],
    activeProjectId: "p1",
    tabs: [],
    activeTabId: null,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useNotificationStream", () => {
  it("turns ai.done into an unread completion notification", () => {
    renderHook(() => useNotificationStream());
    const stream = FakeEventSource.instances[0];

    act(() => {
      stream.emit("ai.done", {
        type: "ai.done",
        title: "Leo respondeu em Alpha",
        body: "feito",
        projectId: "p1",
        projectName: "Alpha",
        chatId: "c1",
        botId: "bot1",
        botName: "Leo",
        notificationId: "n1",
      });
    });

    expect(useApp.getState().notifications).toHaveLength(1);
    expect(useApp.getState().notifications[0]).toMatchObject({
      kind: "ai",
      projectId: "p1",
      chatId: "c1",
      notificationId: "n1",
      title: "Leo respondeu em Alpha",
    });
  });

  it("keeps room notices as system notifications", () => {
    renderHook(() => useNotificationStream());
    const stream = FakeEventSource.instances[0];

    act(() => {
      stream.emit("room", {
        type: "room",
        title: "Beto respondeu em #eng",
        body: "abri o PR",
        projectId: "p1",
        roomId: "r1",
        notificationId: "n2",
      });
    });

    expect(useApp.getState().notifications).toHaveLength(1);
    expect(useApp.getState().notifications[0]).toMatchObject({
      kind: "system",
      roomId: "r1",
      notificationId: "n2",
      title: "Beto respondeu em #eng",
    });
  });

  it("closes the stream when the shell unmounts", () => {
    const { unmount } = renderHook(() => useNotificationStream());
    const stream = FakeEventSource.instances[0];

    unmount();

    expect(stream.close).toHaveBeenCalledOnce();
  });
});
