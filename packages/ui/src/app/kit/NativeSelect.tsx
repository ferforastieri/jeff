import type { ReactNode, Ref, SelectHTMLAttributes } from "react";

export interface NativeSelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  raw?: boolean;
  children?: ReactNode;
  ref?: Ref<HTMLSelectElement>;
}

/** Native select kept for forms that already render their own option list. */
export function NativeSelect({ className = "", raw = false, children, ...props }: NativeSelectProps) {
  return (
    <select className={raw ? className : `jeff-input ${className}`.trim()} {...props}>
      {children}
    </select>
  );
}
