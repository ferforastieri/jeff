import type { ComponentType } from "react";
import { cx } from "@jeff/ui";

export interface MobileTabItem {
  id: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  badge?: number;
  /** The Jeff mark in place of an icon. */
  brand?: boolean;
}

interface Props {
  items: MobileTabItem[];
  active: string;
  onSelect: (id: string) => void;
  label?: string;
}

/** The phone's root navigation: one row of labeled destinations, Discord's shape. */
export default function MobileTabBar({ items, active, onSelect, label = "Navegação principal" }: Props) {
  return (
    <nav className="m-tabbar" aria-label={label}>
      {items.map((item) => {
        const Icon = item.icon;
        const selected = active === item.id;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelect(item.id)}
            aria-current={selected ? "page" : undefined}
            className={cx("m-tabbar__item", selected && "is-active")}
          >
            <span className="m-tabbar__glyph">
              {item.brand ? (
                <span
                  className="m-tabbar__mark"
                  aria-hidden="true"
                  style={{
                    WebkitMaskImage: `url("${import.meta.env.BASE_URL}brand/jeff-mark-eyeless.png?v=5")`,
                    maskImage: `url("${import.meta.env.BASE_URL}brand/jeff-mark-eyeless.png?v=5")`,
                  }}
                />
              ) : (
                <Icon className="m-tabbar__icon" />
              )}
              {item.badge && item.badge > 0 ? (
                <span className="m-tabbar__badge" aria-hidden="true">
                  {item.badge > 99 ? "99+" : item.badge}
                </span>
              ) : null}
            </span>
            <span className="m-tabbar__label">{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
