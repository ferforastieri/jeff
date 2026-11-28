import { Icon } from "faang-ui";
import type { ChannelCategory } from "../rooms/api";

interface GlyphProps {
  size?: 14 | 16 | 18 | 20 | 22;
  className?: string;
}

/** The category's uploaded icon, or the layers mark the sidebar uses. */
export function CategoryGlyph({ category, size = 16, className }: GlyphProps & { category: ChannelCategory }) {
  if (category.icon) {
    return (
      <img
        src={category.icon}
        alt=""
        draggable={false}
        className={`ws-glyph${className ? ` ${className}` : ""}`}
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span className={`ws-glyph-fallback${className ? ` ${className}` : ""}`} style={{ width: size, height: size }}>
      <Icon name="layers" size={20} />
    </span>
  );
}
