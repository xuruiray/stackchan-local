import type { ButtonHTMLAttributes, ReactNode } from "react";

type ButtonVariant = "default" | "primary" | "danger";

export function Button({
  children,
  variant = "default",
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode; variant?: ButtonVariant }): JSX.Element {
  return (
    <button {...props} type={type} className={`button button-${variant} ${props.className ?? ""}`.trim()}>
      {children}
    </button>
  );
}
