import type { Ref, TextareaHTMLAttributes } from "react";

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  raw?: boolean;
  ref?: Ref<HTMLTextAreaElement>;
}

export function Textarea({ className = "", raw = false, ...props }: TextareaProps) {
  return (
    <textarea className={raw ? className : `jeff-input jeff-textarea ${className}`.trim()} {...props} />
  );
}
