import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { api, type UpdateStatus } from "../../../shared/api";
import UpdateToast from "./UpdateToast";

const status = (latestVersion: string): UpdateStatus => ({
  currentVersion: "0.8.0",
  latestVersion,
  available: true,
  supported: true,
  busy: false,
});

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
});

beforeEach(() => {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "visible",
  });
  localStorage.removeItem("jeff_update_dismissed");
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("UpdateToast", () => {
  it("stays dismissed for the same release after a reload", async () => {
    vi.spyOn(api, "updateStatus").mockResolvedValue(status("0.9.0"));

    const first = render(<UpdateToast />);
    expect(await screen.findByText("Jeff v0.9.0 disponível")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Atualizar depois" }));
    expect(localStorage.getItem("jeff_update_dismissed")).toBe("0.9.0");
    expect(screen.queryByText("Jeff v0.9.0 disponível")).not.toBeInTheDocument();

    first.unmount();
    render(<UpdateToast />);
    await waitFor(() => expect(api.updateStatus).toHaveBeenCalledTimes(2));
    expect(screen.queryByText("Jeff v0.9.0 disponível")).not.toBeInTheDocument();
  });

  it("shows the toast again when a newer release ships", async () => {
    localStorage.setItem("jeff_update_dismissed", "0.9.0");
    vi.spyOn(api, "updateStatus").mockResolvedValue(status("0.9.1"));

    render(<UpdateToast />);

    expect(await screen.findByText("Jeff v0.9.1 disponível")).toBeVisible();
  });
});
