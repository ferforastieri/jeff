import { useEffect, useMemo, useState } from "react";
import { Bell, Check, MessageSquare } from "@jeff/icons";
import { api } from "../../../shared/api";
import { useApp, type AppNotification } from "../../../app/store";
import { formatTime } from "../../../shared/time";
import { cx } from "@jeff/ui";
import MobileScreenHeader from "../../../app/layouts/mobile/components/MobileScreenHeader";
import MobileIconButton from "../../../app/layouts/mobile/components/MobileIconButton";
import { MobileEmpty } from "./mobile-ui";

interface Props {
  onOpen: (notification: AppNotification) => void;
}

/** Alertas: the workspace inbox as a full screen, with the room or the chat it points to. */
export default function AlertsScreen({ onOpen }: Props) {
  const notifications = useApp((state) => state.notifications);
  const hydrate = useApp((state) => state.hydrateNotifications);
  const markRead = useApp((state) => state.markNotificationRead);
  const markAll = useApp((state) => state.markAllNotificationsRead);
  const [filter, setFilter] = useState<"all" | "unread">("all");

  useEffect(() => {
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
  }, [hydrate]);

  const sorted = useMemo(
    () => [...notifications].sort((a, b) => b.createdAt - a.createdAt),
    [notifications],
  );
  const unread = sorted.filter((notification) => !notification.read).length;
  const list = filter === "unread" ? sorted.filter((notification) => !notification.read) : sorted;

  function open(notification: AppNotification) {
    markRead(notification.id);
    onOpen(notification);
  }

  return (
    <div className="m-screen">
      <MobileScreenHeader
        title="Alertas"
        subtitle={unread > 0 ? `${unread} ${unread === 1 ? "não lido" : "não lidos"}` : "Tudo em dia"}
        actions={
          <MobileIconButton
            icon={Check}
            label="Marcar todas como lidas"
            onClick={() => markAll()}
            disabled={unread === 0}
          />
        }
      />
      <div className="m-segmented" role="tablist" aria-label="Filtrar alertas">
        <button type="button" role="tab" aria-selected={filter === "all"} className={cx(filter === "all" && "is-active")} onClick={() => setFilter("all")}>
          Todas
        </button>
        <button type="button" role="tab" aria-selected={filter === "unread"} className={cx(filter === "unread" && "is-active")} onClick={() => setFilter("unread")}>
          Não lidas {unread > 0 ? <span>{unread > 99 ? "99+" : unread}</span> : null}
        </button>
      </div>
      <div className="m-scroll">
        {list.length === 0 ? (
          <MobileEmpty icon={<Bell className="m-empty__glyph" />} title={filter === "unread" ? "Nenhum alerta não lido" : "Nenhum alerta ainda"}>
            {filter === "unread" ? "Você está em dia." : "Respostas dos agentes e avisos do workspace aparecem aqui."}
          </MobileEmpty>
        ) : (
          <ul className="m-alertlist">
            {list.map((notification) => (
              <li key={notification.id}>
                <button
                  type="button"
                  className="m-alert"
                  data-unread={!notification.read || undefined}
                  onClick={() => open(notification)}
                >
                  <span className="m-alert__icon">
                    {notification.kind === "ai" ? <MessageSquare className="m-alert__glyph" /> : <Bell className="m-alert__glyph" />}
                  </span>
                  <span className="m-alert__copy">
                    <span className="m-alert__top">
                      <strong>{notification.title}</strong>
                      <time>{formatTime(notification.createdAt)}</time>
                    </span>
                    {notification.body ? <span className="m-alert__body">{notification.body}</span> : null}
                    {notification.projectName ? <span className="m-alert__meta">{notification.projectName}</span> : null}
                  </span>
                  {!notification.read ? <span className="m-alert__dot" aria-label="Não lida" /> : null}
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="m-scroll__end" />
      </div>
    </div>
  );
}
