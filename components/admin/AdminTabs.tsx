"use client";

import type { ReactNode } from "react";

interface AdminTabsProps<T extends string> {
  tabs: readonly T[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  disabled?: boolean;
  inset?: boolean;
  actions?: ReactNode;
}

/** Shared module navigation, using Business Catalog's category controls. */
export default function AdminTabs<T extends string>({ tabs, value, onChange, label, disabled, inset = true, actions }: AdminTabsProps<T>) {
  return <div className={`flex flex-wrap items-center justify-between gap-3 border-b border-neutral/10 bg-base/60 p-4 sm:px-6 ${inset ? "-mx-4 -mt-4 mb-5 sm:-mx-6 sm:-mt-6" : ""}`}>
    <nav aria-label={label} className="flex min-w-0 flex-wrap gap-2">
      {tabs.map(tab => <button key={tab} type="button" aria-pressed={value === tab} disabled={disabled} onClick={() => onChange(tab)} className={`min-h-11 rounded-xl px-3.5 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${value === tab ? "bg-primary text-white shadow-sm" : "text-neutral/65 hover:bg-white hover:text-neutral"}`}>{tab}</button>)}
    </nav>
    {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
  </div>;
}
