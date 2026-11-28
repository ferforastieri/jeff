import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "@jeff/icons";
import { cx } from "@jeff/ui";
import MobileIconButton from "./MobileIconButton";
import SidebarJeffs from "../../../../shared/ui/SidebarJeffs";

export interface MobileDrawerRow {
  id: string;
  label: string;
  icon?: ReactNode;
  hint?: ReactNode;
  badge?: number;
  active?: boolean;
  danger?: boolean;
  onSelect: () => void;
}

export interface MobileDrawerSection {
  id: string;
  label?: string;
  rows: MobileDrawerRow[];
}

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  meta?: string;
  mark: ReactNode;
  sections: MobileDrawerSection[];
  footer?: ReactNode;
}

/** The phone's navigation drawer, Discord's server drawer: the workspace and every place in it. */
export default function MobileDrawer({ open, onClose, title, meta, mark, sections, footer }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="m-drawer-layer">
      <button type="button" className="m-drawer__scrim" aria-label="Fechar navegação" onClick={onClose} />
      <aside className="m-drawer" role="dialog" aria-modal="true" aria-label="Navegação">
        <SidebarJeffs subtle className="m-drawer__sky" />
        <header className="m-drawer__head">
          <span className="m-drawer__mark">{mark}</span>
          <span className="m-drawer__titles">
            <strong>{title}</strong>
            {meta ? <small>{meta}</small> : null}
          </span>
          <MobileIconButton icon={X} label="Fechar navegação" onClick={onClose} className="m-drawer__close" />
        </header>
        <div className="m-drawer__scroll">
          {sections.map((section) => (
            <section className="m-drawer__section" key={section.id}>
              {section.label ? <h2 className="m-drawer__label">{section.label}</h2> : null}
              <div className="m-drawer__rows">
                {section.rows.map((row) => (
                  <button
                    key={row.id}
                    type="button"
                    className={cx("m-drawer__row", row.active && "is-active", row.danger && "is-danger")}
                    aria-current={row.active ? "page" : undefined}
                    onClick={row.onSelect}
                  >
                    <span className="m-drawer__icon">{row.icon}</span>
                    <span className="m-drawer__copy">
                      <strong>{row.label}</strong>
                      {row.hint ? <small>{row.hint}</small> : null}
                    </span>
                    {row.badge && row.badge > 0 ? (
                      <span className="m-drawer__badge">{row.badge > 99 ? "99+" : row.badge}</span>
                    ) : null}
                  </button>
                ))}
              </div>
            </section>
          ))}
          <div className="m-drawer__end" />
        </div>
        {footer ? <footer className="m-drawer__footer">{footer}</footer> : null}
      </aside>
    </div>,
    document.body,
  );
}
