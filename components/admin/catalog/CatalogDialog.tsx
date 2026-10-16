"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import LoadingState from "@/components/ui/LoadingState";

export default function CatalogDialog({ title, description, busy, onClose, children }: { title: string; description: string; busy: boolean; onClose: () => void; children: ReactNode }) {
  const container = useRef<HTMLDivElement>(null);
  const titleId = useId(), descriptionId = useId();
  const closeRef = useRef(onClose), busyRef = useRef(busy);
  useEffect(() => { closeRef.current = onClose; busyRef.current = busy; }, [onClose, busy]);
  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    (container.current?.querySelector<HTMLElement>("[data-autofocus]") ?? container.current?.querySelector<HTMLElement>("button:not(:disabled)"))?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); if (!busyRef.current) closeRef.current(); }
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
  }, []);

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral/45 p-3 backdrop-blur-sm sm:p-4" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId} aria-busy={busy} onClick={() => { if (!busy) onClose(); }}>
    <div ref={container} className="flex max-h-[92dvh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
      <div className="flex shrink-0 items-start justify-between gap-4 border-b border-neutral/10 px-4 py-5 sm:px-6">
        <div className="min-w-0"><h2 id={titleId} className="text-xl font-semibold text-neutral">{title}</h2><p id={descriptionId} className="mt-1 break-words text-sm leading-relaxed text-neutral/60 [overflow-wrap:anywhere]">{description}</p></div>
        <button type="button" onClick={onClose} disabled={busy} aria-label="Close dialog" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-neutral/60 hover:bg-base disabled:opacity-40"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6" /></svg></button>
      </div>
      <div className="min-h-0 overflow-y-auto overscroll-contain px-4 py-5 sm:px-6">{children}</div>
      {busy && <div className="shrink-0 px-4 pb-4 sm:px-6"><LoadingState compact title="Saving changes..." description="Please wait for confirmation before leaving this dialog." /></div>}
    </div>
  </div>;
}
