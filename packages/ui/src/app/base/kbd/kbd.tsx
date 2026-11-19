import type { HTMLAttributes } from "react";
import { Kbd as JeffKbd } from "@jeff/ui";

export interface KbdProps extends HTMLAttributes<HTMLElement> {
  ref?: React.Ref<HTMLElement>;
}

/** A keyboard hint, drawn by the Jeffs design system. */
export function Kbd({ ref: _ref, ...props }: KbdProps) {
  return <JeffKbd {...props} />;
}
