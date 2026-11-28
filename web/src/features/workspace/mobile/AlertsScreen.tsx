import { useEffect, useMemo, useState } from "react";
import { Check, ChevronRight, MenuBars } from "@jeff/icons";
import { api } from "../../../shared/api";
import { useApp, type AppNotification } from "../../../app/store";
import { formatTime } from "../../../shared/time";
import { cx } from "@jeff/ui";
import MobileScreenHeader from "../../../app/layouts/mobile/components/MobileScreenHeader";
import MobileIconButton from "../../../app/layouts/mobile/components/MobileIconButton";
import { MobileEmpty } from "./mobile-ui";
import BrandGlyph from "../../../shared/ui/BrandGlyph";
import JeffBell from "../../../shared/ui/JeffBell";

interface Props {
  onOpen: (notification: AppNotification) => void;
  onMenu: () => void;
}

/** Alertas: the workspace inbox as a full screen, with the room or the chat it points to. */
export default function AlertsScreen({ onOpen, onMenu }: Props) {
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
        lead={<MobileIconButton icon={MenuBars} label="Abrir navegação" onClick={onMenu} />}
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
          <MobileEmpty icon={<JeffBell className="m-empty__glyph" />} title={filter === "unread" ? "Nenhum alerta não lido" : "Nenhum alerta ainda"}>
            {filter === "unread" ? "Você está em dia." : "Respostas dos agentes e avisos do workspace aparecem aqui."}
          </MobileEmpty>
        ) : (
          <ul className="m-alertlist">
            {list.map((notification) => (
              <li key={notification.id} className="m-alert" data-unread={!notification.read || undefined}>
                <button type="button" className="m-alert__main" onClick={() => open(notification)}>
                  <span className="m-alert__photo">
                    {notification.kind === "ai" ? <BrandGlyph size={28} /> : <JeffBell className="m-alert__glyph" />}
                  </span>
                  <span className="m-alert__copy">
                    <span className="m-alert__top">
                      <strong>{notification.title}</strong>
                      <time>{formatTime(notification.createdAt)}</time>
                    </span>
                    {notification.body ? <span className="m-alert__body">{notification.body}</span> : null}
                    <span className="m-alert__foot">
                      <span className="m-alert__meta">
                        {notification.botName || notification.projectName || "Workspace"}
                      </span>
                      {!notification.read ? <span className="m-alert__dot" aria-label="Não lida" /> : null}
                    </span>
                  </span>
                </button>
                <span className="m-alert__actions">
                  {!notification.read ? (
                    <button
                      type="button"
                      className="m-alert__action"
                      aria-label={`Marcar ${notification.title} como lida`}
                      title="Marcar como lida"
                      onClick={() => markRead(notification.id)}
                    >
                      <Check size={14} />
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="m-alert__action"
                    aria-label={`Abrir ${notification.title}`}
                    title="Abrir"
                    onClick={() => open(notification)}
                  >
                    <ChevronRight size={15} />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="m-scroll__end" />
      </div>
    </div>
  );
}
