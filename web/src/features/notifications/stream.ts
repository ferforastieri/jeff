import { useEffect, useRef } from "react";
import { getApiBase } from "../../shared/api";
import { useApp } from "../../app/store";
import { playQuestionSound } from "../conversations/sound";
import { handleAiCompletion, type AiCompletionPayload } from "./completion";

export type NotificationPushPayload = AiCompletionPayload & {
  opened?: string;
  roomId?: string;
};

interface RoomPayload {
  title?: string;
  body?: string;
  projectId?: string;
  projectName?: string;
  roomId?: string;
  notificationId?: string;
}

interface Options {
  /** A native push was opened before the app came up; the shell decides where it lands. */
  onOpened?: (payload: NotificationPushPayload) => void;
}

/**
 * The one notification stream of the app: completions become unread bell and
 * repo badges, room notices land in the same store, and native pushes reuse the
 * same handler. Both the Slack and the dev shells mount this hook; only one of
 * them is alive at a time, so there is never a second connection.
 */
export function useNotificationStream({ onOpened }: Options = {}): void {
  const opened = useRef(onOpened);
  opened.current = onOpened;

  useEffect(() => {
    const handler = (payload: NotificationPushPayload) => {
      if (payload.opened === "true" && payload.projectId) {
        if (opened.current) {
          opened.current(payload);
          return;
        }
        window.setTimeout(
          () => window.dispatchEvent(new CustomEvent("jeff:open-bot", { detail: payload })),
          0,
        );
        return;
      }
      handleAiCompletion(payload);
    };

    (window as unknown as { __jeffPush?: (payload: NotificationPushPayload) => void }).__jeffPush =
      handler;

    if (typeof EventSource === "undefined") {
      return () => {
        delete (window as unknown as { __jeffPush?: (payload: NotificationPushPayload) => void })
          .__jeffPush;
      };
    }

    const stream = new EventSource(`${getApiBase()}/api/notifications/stream`, {
      withCredentials: true,
    });
    const onAI = (event: MessageEvent) => {
      try {
        handler(JSON.parse(event.data) as NotificationPushPayload);
      } catch {
        // Ignore malformed notification events.
      }
    };
    const onRoom = (event: MessageEvent) => {
      try {
        const payload = JSON.parse(event.data) as RoomPayload;
        useApp.getState().addNotification({
          kind: "system",
          title: payload.title ?? "Sala",
          body: payload.body ?? "",
          projectId: payload.projectId,
          projectName: payload.projectName,
          roomId: payload.roomId,
          notificationId: payload.notificationId,
        });
        playQuestionSound();
      } catch {
        // Ignore malformed notification events.
      }
    };
    stream.addEventListener("ai.done", onAI as EventListener);
    stream.addEventListener("room", onRoom as EventListener);
    return () => {
      stream.removeEventListener("ai.done", onAI as EventListener);
      stream.removeEventListener("room", onRoom as EventListener);
      stream.close();
      delete (window as unknown as { __jeffPush?: (payload: NotificationPushPayload) => void })
        .__jeffPush;
    };
  }, []);
}
