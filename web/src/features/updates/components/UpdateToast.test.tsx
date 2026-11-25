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
  Object.defineProperty(navigator, "platform", {
    configurable: true,
    value: "Linux x86_64",
  });
  Object.defineProperty(navigator, "userAgent", {
    configurable: true,
    value: "Mozilla/5.0 (X11; Linux x86_64)",
  });
  localStorage.removeItem("jeff_update_dismissed");
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
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

  it("offers the desktop installer when the server cannot self-update", async () => {
    const invoke = vi.fn().mockResolvedValue("/tmp/Jeff.AppImage");
    (window as unknown as { __TAURI_INTERNALS__?: { invoke: typeof invoke } }).__TAURI_INTERNALS__ = {
      invoke,
    };
    vi.spyOn(api, "updateStatus").mockResolvedValue({
      ...status("0.9.2"),
      supported: false,
      installers: [
        {
          kind: "linux-appimage",
          name: "Jeff.AppImage",
          url: "https://example.test/Jeff.AppImage",
        },
      ],
    });
    const startUpdate = vi.spyOn(api, "startUpdate");

    render(<UpdateToast />);
    fireEvent.click(await screen.findByRole("button", { name: "Atualizar agora" }));

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        "download_update",
        expect.objectContaining({ filename: "Jeff.AppImage" }),
      ),
    );
    await waitFor(() =>
      expect(screen.queryByText("Jeff v0.9.2 disponível")).not.toBeInTheDocument(),
    );
    expect(startUpdate).not.toHaveBeenCalled();
  });
});
