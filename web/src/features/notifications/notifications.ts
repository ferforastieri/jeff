interface NotificationBridge {
  requestPermission?: () => void;
  token?: () => string;
}

export function nativePushToken(): string {
  const bridge = (window as unknown as { JeffNotifications?: NotificationBridge }).JeffNotifications;
  try {
    return bridge?.token?.()?.trim() ?? "";
  } catch {
    return "";
  }
}

export function requestMobileNotificationPermission(): void {
  const bridge = (window as unknown as { JeffNotifications?: NotificationBridge }).JeffNotifications;
  if (bridge?.requestPermission) {
    try {
      bridge.requestPermission();
      return;
    } catch {
      // Fall back to the browser API.
    }
  }
  if (!("Notification" in window)) return;
  if (Notification.permission !== "default") return;
  void Notification.requestPermission().catch(() => undefined);
}
