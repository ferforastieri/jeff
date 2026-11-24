import { useEffect, useMemo, useState } from "react";
import { Icon, Popover } from "@jeff/ui";
import { cx } from "@jeff/ui";
import { useApp, type AppNotification } from "../../../app/store";
import { api } from "../../../shared/api";
import { formatTime } from "../../../shared/time";
import NotificationSoundSettings from "./NotificationSoundSettings";

interface Props {
  className?: string;
  /** Where a row goes in the shell that owns it (Slack rooms, dev conversations). */
  onOpenNotification?: (notification: AppNotification) => void;
}

/**
 * The bell of a sidebar: the inbox as an animated popover, with the sound
 * configuration behind its gear instead of in Configurações.
 */
export default function NotificationBell({ className, onOpenNotification }: Props) {
  const notifications = useApp((state) => state.notifications);
  const hydrate = useApp((state) => state.hydrateNotifications);
  const markRead = useApp((state) => state.markNotificationRead);
  const markAll = useApp((state) => state.markAllNotificationsRead);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"list" | "sound">("list");

  const unread = notifications.filter((notification) => !notification.read).length;
  const sorted = useMemo(
    () => [...notifications].sort((a, b) => b.createdAt - a.createdAt).slice(0, 20),
    [notifications],
  );

  // The Slack shell has no notification stream of its own; either way, opening
  // the inbox asks the server once, then the shared store is the source.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void api
      .notifications()
      .then((items) => {
        if (!cancelled) hydrate(items);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [open, hydrate]);

  function show(next: boolean) {
    setOpen(next);
    if (!next) setView("list");
  }

  function openNotification(notification: AppNotification) {
    markRead(notification.id);
    setOpen(false);
    if (onOpenNotification) {
      onOpenNotification(notification);
      return;
    }
    if (notification.projectId && notification.chatId) {
      window.dispatchEvent(
        new CustomEvent("jeff:open-chat", {
          detail: {
            projectId: notification.projectId,
            chatId: notification.chatId,
            title: notification.title,
          },
        }),
      );
    } else if (notification.projectId && notification.botId) {
      window.dispatchEvent(
        new CustomEvent("jeff:open-bot", {
          detail: {
            projectId: notification.projectId,
            botId: notification.botId,
            chatId: notification.chatId,
            notificationId: notification.notificationId,
          },
        }),
      );
    }
  }

  const trigger = (
    <button
      type="button"
      className={cx("notification-bell", open && "is-open", className)}
      aria-label={unread > 0 ? `Notificações, ${unread} não lidas` : "Notificações"}
      title="Notificações"
    >
      <Icon name="bell" size={16} />
      {unread > 0 ? (
        <span className="notification-bell__badge" aria-hidden="true">
          {unread > 99 ? "99+" : unread}
        </span>
      ) : null}
    </button>
  );

  return (
    <Popover
      trigger={trigger}
      label="Notificações"
      side="top"
      align="end"
      open={open}
      onOpenChange={show}
      className="notification-menu"
    >
      <header className="notification-menu__head">
        <strong>{view === "sound" ? "Som das notificações" : "Notificações"}</strong>
        {view === "list" && unread > 0 ? (
          <span className="notification-menu__count" aria-label={`${unread} não lidas`}>
            {unread > 99 ? "99+" : unread}
          </span>
        ) : null}
        <button
          type="button"
          className="notification-menu__tool"
          aria-label={view === "sound" ? "Voltar às notificações" : "Configurar o som"}
          title={view === "sound" ? "Voltar" : "Configurar o som"}
          onClick={() => setView((current) => (current === "list" ? "sound" : "list"))}
        >
          <Icon name={view === "sound" ? "chevronLeft" : "cog"} size={16} />
        </button>
      </header>

      {view === "sound" ? (
        <NotificationSoundSettings />
      ) : sorted.length === 0 ? (
        <div className="notification-menu__empty">
          <Icon name="bell" size={18} />
          <span>Tudo em dia.</span>
        </div>
      ) : (
        <>
          <ul className="notification-menu__list" aria-label="Notificações">
            {sorted.map((notification) => (
              <li key={notification.id}>
                <button
                  type="button"
                  className="notification-row"
                  data-unread={!notification.read || undefined}
                  onClick={() => openNotification(notification)}
                >
                  <span className="notification-row__dot" aria-hidden="true" />
                  <span className="notification-row__text">
                    <span className="notification-row__title">{notification.title}</span>
                    {notification.body ? (
                      <span className="notification-row__body">{notification.body}</span>
                    ) : null}
                  </span>
                  <time className="notification-row__time">{formatTime(notification.createdAt)}</time>
                </button>
              </li>
            ))}
          </ul>
          {unread > 0 ? (
            <footer className="notification-menu__foot">
              <button
                type="button"
                className="ac-link ac-link--action"
                onClick={() => markAll()}
              >
                Marcar todas como lidas
              </button>
            </footer>
          ) : null}
        </>
      )}
    </Popover>
  );
}
