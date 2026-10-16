"use client";

import { useEffect, useId, useRef, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { usePortalTarget } from "@/lib/use-portal-target";

export default function FormErrorDialog({ title, message, actions, closeText = "Back to form", onClose, returnFocusRef }: {
  title: string;
  message: string;
  actions?: ReactNode;
  closeText?: string;
  onClose: () => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const titleId = useId(), messageId = useId();
  const onCloseRef = useRef(onClose);
  const portalTarget = usePortalTarget();
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    if (!portalTarget) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const returnFocus = returnFocusRef?.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButton.current?.focus({ preventScroll: true });
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onCloseRef.current(); return; }
      if (event.key !== "Tab") return;
      const items = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href]') ?? [])];
      const first = items[0], last = items.at(-1);
      if (event.shiftKey && (document.activeElement === first || !dialog.current?.contains(document.activeElement))) {
        event.preventDefault(); last?.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialog.current?.contains(document.activeElement))) {
        event.preventDefault(); first?.focus();
      }
    };
    document.addEventListener("keydown", keydown);
    return () => {
      document.removeEventListener("keydown", keydown);
      document.body.style.overflow = previousOverflow;
      (returnFocus ?? previousFocus)?.focus({ preventScroll: !returnFocus });
    };
  }, [returnFocusRef, portalTarget]);

  if (!portalTarget) return null;
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-neutral/50 p-3 backdrop-blur-sm sm:p-5">
      <div ref={dialog} role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={messageId}
        className="max-h-[90dvh] w-full max-w-md overflow-y-auto overscroll-contain rounded-2xl border border-neutral/10 bg-white p-5 text-neutral shadow-2xl sm:p-6">
        <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-red-50 text-red-700" aria-hidden="true">
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v4m0 4h.01M10.3 3.9 2 18.2A1.2 1.2 0 0 0 3 20h18a1.2 1.2 0 0 0 1-1.8L13.7 3.9a2 2 0 0 0-3.4 0Z" /></svg>
        </div>
        <h2 id={titleId} className="text-xl font-semibold">{title}</h2>
        <p id={messageId} className="mt-2 break-words text-sm leading-relaxed text-neutral/80">{message}</p>
        {actions && <div className="mt-5 grid gap-2 sm:grid-cols-2">{actions}</div>}
        <button ref={closeButton} type="button" onClick={onClose}
          className="mt-4 min-h-11 w-full rounded-xl border border-neutral/20 px-4 py-2 text-sm font-semibold hover:bg-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">{closeText}</button>
      </div>
    </div>, portalTarget,
  );
}
