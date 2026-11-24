import type { InputHTMLAttributes, Ref } from "react";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Keeps the caller's own classes and native element (raw markup migration). */
  raw?: boolean;
  ref?: Ref<HTMLInputElement>;
}

export function Input({ className = "", raw = false, ...props }: InputProps) {
  return <input className={raw ? className : `jeff-input ${className}`.trim()} {...props} />;
}
