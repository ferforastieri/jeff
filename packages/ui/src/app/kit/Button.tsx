import type { ButtonHTMLAttributes, Ref } from "react";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "light" | "ghost" | "raw";
  size?: "sm" | "md";
  block?: boolean;
  ref?: Ref<HTMLButtonElement>;
}

export function Button({
  variant = "primary",
  size = "md",
  block = false,
  className = "",
  type = "button",
  children,
  ...rest
}: ButtonProps) {
  if (variant === "raw") {
    return (
      <button type={type} className={className} {...rest}>
        {children}
      </button>
    );
  }
  const classes = [
    "jeff-button",
    `jeff-button--${variant}`,
    size === "sm" && "jeff-button--sm",
    block && "jeff-button--block",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button type={type} className={classes} {...rest}>
      {children}
    </button>
  );
}
