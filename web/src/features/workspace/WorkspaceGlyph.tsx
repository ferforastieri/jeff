import { Icon } from "faang-ui";
import type { ChannelCategory } from "../rooms/api";

interface GlyphProps {
  size?: 14 | 16 | 18 | 20;
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
  return <Icon name="layers" size={size} className={className} />;
}
