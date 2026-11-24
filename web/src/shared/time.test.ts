import { afterEach, describe, expect, it } from "vitest";
import { useApp } from "../app/store";
import { formatDate, formatDateTime, formatTime } from "./time";

const evening = "2026-11-24T01:30:00.000Z";

afterEach(() => {
  useApp.setState({ workspaceTimezone: "UTC" });
});

describe("workspace time", () => {
  it("uses the workspace zone for clocks, dates and date-times", () => {
    useApp.setState({ workspaceTimezone: "America/Sao_Paulo" });
    expect(formatTime(evening)).toBe("22:30");
    expect(formatDate(evening, { day: "2-digit", month: "2-digit" })).toBe("23/11");
    expect(
      formatDateTime(evening, {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }),
    ).toBe("23/11, 22:30");

    useApp.setState({ workspaceTimezone: "Europe/Lisbon" });
    expect(formatTime(evening)).toBe("01:30");
    expect(formatDate(evening, { day: "2-digit", month: "2-digit" })).toBe("24/11");
  });
});
