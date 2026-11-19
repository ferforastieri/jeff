import type { CSSProperties, HTMLAttributes } from "react";
import { cx } from "@jeff/ui";

const EYE_TRANSFORM = "translate3d(var(--jeff-look-x, 0px), var(--jeff-look-y, 0px), 0)";

const EYE_VERSION = "?v=3";

export function avatarColorStyle(color: string, image: string): CSSProperties {
  return {
    backgroundColor: color,
    WebkitMaskImage: `url("${image}")`,
    maskImage: `url("${image}")`,
    WebkitMaskPosition: "center",
    maskPosition: "center",
    WebkitMaskRepeat: "no-repeat",
    maskRepeat: "no-repeat",
    WebkitMaskSize: "contain",
    maskSize: "contain",
    mixBlendMode: "color",
  };
}

interface ColorOverlayProps extends HTMLAttributes<HTMLSpanElement> {
  color: string;
  image: string;
}

export function JeffColorOverlay({ color, image, className, style, ...props }: ColorOverlayProps) {
  return (
    <span
      {...props}
      className={cx("pointer-events-none absolute inset-0 size-full", className)}
      style={{ ...avatarColorStyle(color, image), ...style }}
    />
  );
}

interface Props {
  /** Avatar slug, e.g. "jeff-prism". */
  avatar: string;
  color?: string;
  imageClassName?: string;
  imageStyle?: CSSProperties;
  /** Mirrors the CSS `scale` applied to the base image, when any. */
  scale?: number;
  /** The avatar has no eye sprite yet: let the caller fall back to static art. */
  onMissing?: () => void;
}

/**
 * Draws the avatar's eyes as a transparent sprite on top of the eyeless body.
 * The sprite carries only the eye pixels — never the skin around them — so
 * moving it leaves no ghost ring behind, and the body stays still.
 *
 * Sprites live in `public/jeffs/<avatar>-eyes.png` and are generated from the
 * full/eyeless pair by `web/scripts/jeff-eyes.py`.
 */
export default function JeffEyes({ avatar, color, imageClassName, imageStyle, scale, onMissing }: Props) {
  const sprite = `${import.meta.env.BASE_URL}jeffs/${avatar}-eyes.png${EYE_VERSION}`;

  return (
    <span
      aria-hidden
      data-jeff-eyes={avatar}
      className="pointer-events-none absolute inset-0 block"
      style={{
        transform: EYE_TRANSFORM,
        transition: "transform 70ms linear",
        scale: scale === undefined ? undefined : String(scale),
      }}
    >
      <img
        src={sprite}
        alt=""
        width={256}
        height={256}
        draggable={false}
        onError={onMissing}
        className={cx("size-full select-none object-contain", imageClassName)}
        style={imageStyle}
      />
      {color ? <JeffColorOverlay color={color} image={sprite} /> : null}
    </span>
  );
}
