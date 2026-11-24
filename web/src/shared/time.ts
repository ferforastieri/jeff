import { useApp } from "../app/store";

type Value = string | number | Date;

function zone(): string | undefined {
  return useApp.getState().workspaceTimezone || undefined;
}

/** A clock time in the workspace's time zone. */
export function formatTime(
  value: Value,
  options: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit" },
): string {
  return new Date(value).toLocaleTimeString("pt-BR", { ...options, timeZone: zone() });
}

/** A date in the workspace's time zone. */
export function formatDate(
  value: Value,
  options: Intl.DateTimeFormatOptions = {},
): string {
  return new Date(value).toLocaleDateString("pt-BR", { ...options, timeZone: zone() });
}

/** A date and a time in the workspace's time zone. */
export function formatDateTime(
  value: Value,
  options: Intl.DateTimeFormatOptions = {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  },
): string {
  return new Date(value).toLocaleString("pt-BR", { ...options, timeZone: zone() });
}
