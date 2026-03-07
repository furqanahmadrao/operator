import { ReactNode } from "react";

type ChatStatePanelProps = {
  title: string;
  description: string;
  icon?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
};

export function ChatStatePanel({ title, description, icon, actions, children }: ChatStatePanelProps) {
  return (
    <div className="state-panel">
      {icon ? <div className="mb-4 text-text-3">{icon}</div> : null}
      <h2 className="state-title">{title}</h2>
      <p className="state-copy">{description}</p>
      {actions ? <div className="mt-5 flex flex-wrap gap-2.5">{actions}</div> : null}
      {children ? <div className="mt-6">{children}</div> : null}
    </div>
  );
}
