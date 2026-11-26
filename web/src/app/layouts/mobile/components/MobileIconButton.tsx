import { forwardRef, type ButtonHTMLAttributes, type ComponentType } from "react";
import { cx } from "@jeff/ui";

interface Props extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  icon: ComponentType<{ className?: string }>;
  label: string;
  active?: boolean;
  badge?: number;
}

/** A round icon target sized for a thumb, with an optional unread badge. */
const MobileIconButton = forwardRef<HTMLButtonElement, Props>(function MobileIconButton(
  { icon: Icon, label, onClick, disabled, active, badge, className, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      className={cx("m-iconbtn", active && "is-active", className)}
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      {...rest}
    >
      <Icon className="m-iconbtn__icon" />
      {badge && badge > 0 ? (
        <span className="m-iconbtn__badge" aria-hidden="true">
          {badge > 99 ? "99+" : badge}
        </span>
      ) : null}
    </button>
  );
});

export default MobileIconButton;
