import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useApp } from "../../../app/store";
import { api } from "../../../shared/api";
import ProjectSwitcher from "./ProjectSwitcher";

vi.mock("../../../shared/api", () => {
  class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.name = "ApiError";
      this.status = status;
    }
  }
  return {
    ApiError,
    api: {
      repos: vi.fn(async () => []),
      projects: vi.fn(async () => []),
      workspaceRoots: vi.fn(async () => ({ roots: ["/work/repos"] })),
      createRepo: vi.fn(),
      createProject: vi.fn(),
    },
  };
});

const created = {
  id: "p1",
  name: "novo",
  root: "/work/repos/novo",
  color: "#F01F31",
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
};

beforeEach(() => {
  useApp.setState({
    projects: [],
    openProjectIds: [],
    activeProjectId: null,
    notifications: [],
  });
  vi.mocked(api.repos).mockResolvedValue([]);
  vi.mocked(api.workspaceRoots).mockResolvedValue({ roots: ["/work/repos"] });
  vi.mocked(api.createRepo).mockResolvedValue({
    name: "novo",
    path: "/work/repos/novo",
    root: "/work/repos",
    relative: "novo",
  });
  vi.mocked(api.createProject).mockResolvedValue(created);
  vi.mocked(api.projects).mockResolvedValue([created]);
});

afterEach(cleanup);

describe("ProjectSwitcher", () => {
  it("creates a new folder under the allowed root and opens it", async () => {
    const onSelect = vi.fn();
    render(<ProjectSwitcher onSelect={onSelect} />);

    fireEvent.click(screen.getByRole("button", { name: "Novo repositório" }));
    const name = await screen.findByLabelText("Nome da pasta");
    fireEvent.change(name, { target: { value: "novo" } });

    const submit = screen.getByRole("button", { name: "Criar e abrir" });
    await waitFor(() => expect(submit).toBeEnabled());
    fireEvent.click(submit);

    await waitFor(() => expect(api.createRepo).toHaveBeenCalledWith("/work/repos", "novo", true));
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith("p1"));
  });

  it("can create a plain folder without git", async () => {
    const onSelect = vi.fn();
    render(<ProjectSwitcher onSelect={onSelect} />);

    fireEvent.click(screen.getByRole("button", { name: "Novo repositório" }));
    const name = await screen.findByLabelText("Nome da pasta");
    fireEvent.change(name, { target: { value: "solto" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Inicializar com Git" }));

    const submit = screen.getByRole("button", { name: "Criar e abrir" });
    await waitFor(() => expect(submit).toBeEnabled());
    fireEvent.click(submit);

    await waitFor(() => expect(api.createRepo).toHaveBeenCalledWith("/work/repos", "solto", false));
  });
});
