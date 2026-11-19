import { useState, type CSSProperties } from "react";
import type { ChatJeff } from "../../conversations/store";
import { cx } from "@jeff/ui";
import { usePointerLook } from "../../../shared/ui/usePointerLook";
import JeffEyes, { JeffColorOverlay } from "./JeffEyes";

interface Props {
  bot: Pick<ChatJeff, "name" | "color" | "avatar">;
  size?: number;
  className?: string;
  style?: CSSProperties;
  look?: boolean;
}

const AVATAR_BASE = `${import.meta.env.BASE_URL}jeffs/`;
const AVATAR_VERSION = "?v=7";
/** The logo's Jeff: the only character. */
const AVATAR = "jeff-logo";
const CORE_AVATAR = `${AVATAR_BASE}${AVATAR}.png${AVATAR_VERSION}`;
const CORE_EYELESS = `${AVATAR_BASE}${AVATAR}-eyeless.png${AVATAR_VERSION}`;

export default function BotAvatar({ bot, size = 36, className, style, look = true }: Props) {
  const [eyesMissing, setEyesMissing] = useState(false);
  const lookRef = usePointerLook<HTMLSpanElement>({ disabled: !look });
  // Without an eye sprite the still art (with its own eyes) is the honest fallback.
  const animated = look && !eyesMissing;
  const base = animated ? CORE_EYELESS : CORE_AVATAR;

  return (
    <span
      ref={look ? lookRef : undefined}
      className={cx("relative isolate overflow-visible", className)}
      style={{ width: size, height: size, display: "inline-flex", flexShrink: 0, ...style }}
      title={bot.name}
      aria-hidden
    >
      <span className="pointer-events-none absolute inset-0 block">
        <img
          src={base}
          alt=""
          width={size}
          height={size}
          draggable={false}
          className="size-full select-none object-contain grayscale drop-shadow-[0_1px_1px_rgba(0,0,0,0.18)]"
        />
        <JeffColorOverlay color={bot.color} image={base} data-avatar-color={bot.color} />
      </span>
      {animated ? (
        <JeffEyes
          avatar={AVATAR}
          color={bot.color}
          imageClassName="grayscale"
          onMissing={() => setEyesMissing(true)}
        />
      ) : null}
    </span>
  );
}
