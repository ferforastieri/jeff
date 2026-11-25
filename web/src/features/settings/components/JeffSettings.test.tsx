import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import JeffSettings from "./JeffSettings";
import { useApp } from "../../../app/store";
import { defaultWorkspaceFeatures, useSettings } from "../store";
import { api } from "../../../shared/api";

vi.mock("./WorkspaceSettings", () => ({
  default: () => <div data-testid="workspace-settings">Workspace</div>,
}));
vi.mock("./HarnessSettings", () => ({
  default: () => <div data-testid="engine-settings">Motores</div>,
}));
vi.mock("./ConnectorsSettings", () => ({
  default: () => <div data-testid="connectors-settings">Conectores</div>,
}));

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  });
});

beforeEach(() => {
  useApp.setState({ setUser: vi.fn(), notify: vi.fn() });
  useSettings.setState({
    workspaceFeatures: defaultWorkspaceFeatures,
    update: vi.fn(),
  });
  vi.spyOn(api, "version").mockResolvedValue({ name: "jeff", version: "0.85.0", buildId: "test-build" });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("JeffSettings", () => {
  it("keeps harness and connectors in their own tabs", async () => {
    render(<JeffSettings user={{ id: 1, username: "admin", createdAt: "" }} />);

    fireEvent.click(screen.getByRole("button", { name: "Abrir configurações" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Configurações" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Harness" }));
    expect(await screen.findByTestId("engine-settings")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "MCPs" }));
    expect(await screen.findByTestId("connectors-settings")).toBeInTheDocument();

    expect(screen.queryByRole("button", { name: "Layout e ferramentas" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Jeff" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("jeff-config")).not.toBeInTheDocument();
  });

  it("keeps the installation facts and the sign-out in General", async () => {
    render(<JeffSettings user={{ id: 1, username: "admin", createdAt: "" }} />);

    fireEvent.click(screen.getByRole("button", { name: "Abrir configurações" }));

    expect(await screen.findByText("v0.85.0")).toBeInTheDocument();
    expect(screen.getByText("test-build")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sair" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sobre" })).not.toBeInTheDocument();
  });
});
