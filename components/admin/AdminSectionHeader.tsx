import type { ReactNode } from "react";

interface AdminSectionHeaderProps {
  title: string;
  subtitle: string;
  actions?: ReactNode;
  eyebrow?: string;
  footer?: ReactNode;
}

export default function AdminSectionHeader({ title, subtitle, actions, eyebrow, footer }: AdminSectionHeaderProps) {
  return (
    <header className="mb-6 overflow-hidden rounded-2xl border border-neutral/10 bg-white shadow-sm">
      <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div className="min-w-0">
          {eyebrow && <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-primary">{eyebrow}</p>}
          <h1 className="text-xl font-semibold tracking-tight text-neutral sm:text-2xl md:text-3xl">{title}</h1>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-neutral/65">{subtitle}</p>
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {footer && <div className="flex flex-wrap items-center justify-between gap-3 border-t border-neutral/10 bg-base/40 px-4 py-3 text-xs sm:px-6">{footer}</div>}
    </header>
  );
}
