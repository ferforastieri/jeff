import { forwardRef, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "@jeff/icons";
import { cx } from "@jeff/ui";

interface WorkspaceButtonProps {
  logo: string;
  name: string;
  meta?: string;
  onClick?: () => void;
  compact?: boolean;
}

/** The workspace row at the top of the phone's channel screen (Discord's server title). */
export const MobileWorkspaceButton = forwardRef<HTMLButtonElement, WorkspaceButtonProps>(function MobileWorkspaceButton(
  { logo, name, meta, onClick, compact = false },
  ref,
) {
  return (
    <button type="button" ref={ref} className={cx("m-wsbtn", compact && "is-compact")} onClick={onClick} aria-haspopup="dialog">
      <span className="m-wsbtn__logo">
        <img src={logo} alt="" draggable={false} />
      </span>
      <span className="m-wsbtn__copy">
        <strong>{name}</strong>
        {meta ? <small>{meta}</small> : null}
      </span>
      <ChevronDown className="m-wsbtn__chevron" />
    </button>
  );
});

export function MobileSectionTitle({
  title,
  icon,
  count,
  open,
  onToggle,
  actions,
}: {
  title: string;
  icon?: ReactNode;
  count?: number;
  open?: boolean;
  onToggle?: () => void;
  actions?: ReactNode;
}) {
  return (
    <div className="m-section">
      <button
        type="button"
        className="m-section__toggle"
        onClick={onToggle}
        aria-expanded={open === undefined ? undefined : open}
        disabled={!onToggle}
      >
        {open === undefined ? null : open ? <ChevronDown className="m-section__chevron" /> : <ChevronRight className="m-section__chevron" />}
        {icon ? <span className="m-section__icon">{icon}</span> : null}
        <span className="m-section__label">{title}</span>
        {typeof count === "number" ? <span className="m-section__count">{count}</span> : null}
      </button>
      {actions ? <div className="m-section__actions">{actions}</div> : null}
    </div>
  );
}

export function MobileEmpty({
  icon,
  title,
  children,
  action,
}: {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="m-empty">
      {icon ? <span className="m-empty__icon">{icon}</span> : null}
      <strong>{title}</strong>
      {children ? <p>{children}</p> : null}
      {action}
    </div>
  );
}
