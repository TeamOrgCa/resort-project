"use client";

import { useEffect, useRef, type ReactNode } from "react";

export default function CatalogDialog({ title, description, busy, onClose, children }: { title: string; description: string; busy: boolean; onClose: () => void; children: ReactNode }) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    container.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); }
      if (event.key !== "Tab") return;
      const elements = container.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]');
      if (!elements?.length) { event.preventDefault(); return; }
      const first = elements[0]; const last = elements[elements.length - 1];
      if (event.shiftKey && (document.activeElement === first || !container.current?.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && (document.activeElement === last || !container.current?.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [onClose]);

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral/45 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="catalog-dialog-title" aria-describedby="catalog-dialog-description" onClick={() => { if (!busy) onClose(); }}>
    <div ref={container} className="flex max-h-[92dvh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
      <div className="flex items-start justify-between gap-6 border-b border-neutral/10 px-6 py-5">
        <div><h2 id="catalog-dialog-title" className="text-xl font-semibold text-neutral">{title}</h2><p id="catalog-dialog-description" className="mt-1 text-sm leading-relaxed text-neutral/60">{description}</p></div>
        <button type="button" onClick={onClose} disabled={busy} aria-label="Close dialog" className="rounded-lg p-2 text-neutral/60 hover:bg-base disabled:opacity-40"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6" /></svg></button>
      </div>
      <div className="overflow-y-auto px-6 py-5">{children}</div>
    </div>
  </div>;
}
