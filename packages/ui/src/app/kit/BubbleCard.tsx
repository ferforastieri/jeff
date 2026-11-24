import type { ReactNode } from "react";

export interface BubbleCardProps {
  avatarSrc?: string;
  avatarAlt?: string;
  title: string;
  hint?: string;
  children?: ReactNode;
  className?: string;
}

/** The Jeff speaking bubble: avatar + speech surface, separate from the normal Card. */
export function BubbleCard({
  avatarSrc,
  avatarAlt = "",
  title,
  hint,
  children,
  className = "",
}: BubbleCardProps) {
  return (
    <div className={`jeff-bubble ${className}`.trim()}>
      {avatarSrc ? (
        <div className="jeff-bubble__avatar">
          <img
            src={avatarSrc}
            alt={avatarAlt}
            className="jeff-bubble__avatar-image"
            draggable={false}
          />
        </div>
      ) : null}
      <div className="jeff-bubble__surface">
        <p className="jeff-bubble__title">{title}</p>
        {hint ? <p className="jeff-bubble__hint">{hint}</p> : null}
        {children}
      </div>
    </div>
  );
}
