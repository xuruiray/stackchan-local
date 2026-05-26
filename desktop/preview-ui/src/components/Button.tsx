import type { ButtonHTMLAttributes, ReactNode } from "react";

type ButtonVariant = "default" | "primary" | "danger";

export function Button({
  children,
  variant = "default",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode; variant?: ButtonVariant }): JSX.Element {
  return (
    <button {...props} className={`button button-${variant} ${props.className ?? ""}`.trim()}>
      {children}
    </button>
  );
}
