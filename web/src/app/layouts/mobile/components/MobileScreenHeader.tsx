import type { ReactNode } from "react";
import { ChevronLeft } from "@jeff/icons";
import { cx } from "@jeff/ui";

interface Props {
  title?: string;
  subtitle?: string;
  /** A custom lead (an avatar, a workspace mark): without it and with `onBack`, a back chevron. */
  lead?: ReactNode;
  /** A channel/category mark that sits after the back button or lead. */
  icon?: ReactNode;
  onBack?: () => void;
  backLabel?: string;
  actions?: ReactNode;
  /** The workspace row: title and subtitle on the left, actions on the right, no back. */
  variant?: "title" | "workspace" | "plain";
  className?: string;
  children?: ReactNode;
}

/** The compact header every mobile screen shares: back or mark, two lines, actions. */
export default function MobileScreenHeader({
  title,
  subtitle,
  lead,
  icon,
  onBack,
  backLabel = "Voltar",
  actions,
  variant = "title",
  className,
  children,
}: Props) {
  return (
    <header className={cx("m-header", `m-header--${variant}`, className)}>
      <div className="m-header__row">
        {onBack ? (
          <button type="button" className="m-header__back" aria-label={backLabel} title={backLabel} onClick={onBack}>
            <ChevronLeft className="m-header__back-icon" />
          </button>
        ) : lead ? (
          <div className="m-header__lead">{lead}</div>
        ) : null}
        {icon ? <div className="m-header__icon">{icon}</div> : null}
        <div className="m-header__copy">
          {title ? <h1 className="m-header__title">{title}</h1> : null}
          {subtitle ? <p className="m-header__subtitle">{subtitle}</p> : null}
        </div>
        {actions ? <div className="m-header__actions">{actions}</div> : null}
      </div>
      {children}
    </header>
  );
}
