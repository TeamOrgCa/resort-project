"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import ManageIcon from "./ManageIcon";

export default function RecordDialog({ title, reference, busy, onClose, children }: {
  title: string; reference: string; busy: boolean; onClose: () => void; children: ReactNode;
}) {
  const dialog = useRef<HTMLDivElement>(null), close = useRef<HTMLButtonElement>(null), titleId = useId();
  const onCloseRef = useRef(onClose), busyRef = useRef(busy);
  useEffect(() => { onCloseRef.current = onClose; busyRef.current = busy; }, [onClose, busy]);
  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden"; close.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); if (!busyRef.current) onCloseRef.current(); }
      if (event.key !== "Tab") return;
      const items = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]') ?? [])];
      const first = items[0], last = items.at(-1);
      if (!first) { event.preventDefault(); dialog.current?.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || !dialog.current?.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !dialog.current?.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", keydown);
    return () => { document.removeEventListener("keydown", keydown); document.body.style.overflow = previousOverflow; previousFocus?.focus(); };
  }, []);
  return createPortal(<div className="fixed inset-0 z-[70] flex items-center justify-center bg-neutral/55 p-2 backdrop-blur-sm sm:p-5"
    onClick={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} aria-busy={busy}
      className="flex max-h-[94dvh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-white/60 bg-white shadow-2xl sm:rounded-3xl">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-neutral/10 bg-white px-4 py-3 sm:px-7 sm:py-4">
        <div className="min-w-0"><p className="break-all text-xs font-semibold uppercase tracking-wide text-primary">{reference}</p><h2 id={titleId} className="mt-1 text-lg font-semibold text-neutral sm:text-xl">{title}</h2></div>
        <button ref={close} type="button" onClick={onClose} disabled={busy} aria-label="Close booking dialog" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-base text-neutral/70 hover:bg-neutral/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-40"><ManageIcon name="close" /></button>
      </header>
      <div className="min-h-0 overflow-y-auto overscroll-contain p-3 sm:p-6" key={title}><fieldset disabled={busy} className="min-w-0 [overflow-wrap:anywhere]">{children}</fieldset></div>
      <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-neutral/10 bg-white px-4 py-3 text-xs sm:px-7"><span className="min-w-0 text-neutral/50">Schedules shown in Philippine time</span><button type="button" disabled={busy} onClick={onClose} className="min-h-11 shrink-0 rounded-lg border border-neutral/15 px-4 py-2 text-sm font-medium text-neutral hover:bg-base disabled:opacity-40">Close</button></footer>
    </div>
  </div>, document.body);
}
