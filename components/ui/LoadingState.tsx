export default function LoadingState({ title = "Loading...", description, compact = false }: {
  title?: string; description?: string; compact?: boolean;
}) {
  return <div role="status" aria-live="polite" aria-atomic="true" data-no-auto-scroll
    className={`flex min-w-0 items-center gap-3 rounded-xl border border-primary/15 bg-white text-neutral ${compact ? "p-3" : "p-5 sm:p-6"}`}>
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-6 w-6 shrink-0 animate-spin text-primary motion-reduce:animate-none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.2" />
      <path d="M12 3a9 9 0 0 1 9 9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
    <div className="min-w-0 [overflow-wrap:anywhere]"><p className="text-sm font-semibold">{title}</p>
      {description && <p className="mt-1 text-xs leading-relaxed text-neutral/65">{description}</p>}
    </div>
  </div>;
}
