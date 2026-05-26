import type { ReactNode } from "react";

export function CommandPanel({ children, title = "操作指令" }: { children: ReactNode; title?: string }): JSX.Element {
  return (
    <section className="panel-block command-panel">
      <h3>{title}</h3>
      <div className="command-stack">{children}</div>
    </section>
  );
}
