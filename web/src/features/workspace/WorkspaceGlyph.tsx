import { Icon } from "faang-ui";
import type { ChannelCategory, Room } from "../rooms/api";

interface GlyphProps {
  size?: 14 | 16 | 18 | 20;
  className?: string;
}

/** The channel's uploaded icon, or the hash it had before icons existed. */
export function ChannelGlyph({ room, size = 16, className }: GlyphProps & { room: Room }) {
  if (room.icon) {
    return (
      <img
        src={room.icon}
        alt=""
        draggable={false}
        className={`ws-glyph${className ? ` ${className}` : ""}`}
        style={{ width: size, height: size }}
      />
    );
  }
  return <Icon name="channel" size={size} className={className} />;
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
