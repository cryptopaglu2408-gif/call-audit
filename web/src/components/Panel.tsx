import type { ReactNode } from "react";

interface Props {
  title?: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}

export default function Panel({ title, right, children, className = "" }: Props) {
  return (
    <section className={`panel ${className}`}>
      {(title || right) && (
        <header className="flex items-center justify-between mb-3">
          {title && <h2 className="text-base font-semibold text-slate-900">{title}</h2>}
          {right}
        </header>
      )}
      {children}
    </section>
  );
}
