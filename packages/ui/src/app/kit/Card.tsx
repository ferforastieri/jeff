import type { ElementType, HTMLAttributes, ReactNode } from "react";

export interface CardProps extends HTMLAttributes<HTMLElement> {
  selected?: boolean;
  interactive?: boolean;
  as?: ElementType;
  type?: "button" | "submit" | "reset";
  children?: ReactNode;
}

/** The normal card surface, separate from the Jeff speaking bubble. */
export function Card({
  selected = false,
  interactive = false,
  as,
  className = "",
  children,
  ...rest
}: CardProps) {
  const Tag = (as ?? "div") as ElementType;
  const classes = [
    "jeff-card",
    selected && "jeff-card--selected",
    (interactive || as === "button") && "jeff-card--interactive",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <Tag className={classes} {...rest}>
      {children}
    </Tag>
  );
}
