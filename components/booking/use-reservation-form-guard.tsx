"use client";

import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { createPortal } from "react-dom";

function formSnapshot(root: HTMLElement | null) {
  const fields = Array.from(root?.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input, select, textarea") ?? [])
    .filter(field => field.type !== "hidden")
    .map(field => [field.tagName, field.getAttribute("name"), field.getAttribute("aria-label"), field instanceof window.HTMLInputElement && ["checkbox", "radio"].includes(field.type) ? field.checked : field.value]);
  const dates = Array.from(root?.querySelectorAll('[data-reservation-date]') ?? []).map(day => day.getAttribute("data-reservation-date"));
  return JSON.stringify({ fields, dates });
}

function DiscardConfirmation({ onContinue, onDiscard }: { onContinue: () => void; onDiscard: () => void }) {
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); onContinue(); }
      if (event.key === "Tab") {
        event.stopImmediatePropagation();
        const buttons = dialog.current?.querySelectorAll("button");
        if (!buttons?.length) return;
        if (event.shiftKey && document.activeElement === buttons[0]) { event.preventDefault(); buttons[1].focus(); }
        else if (!event.shiftKey && document.activeElement === buttons[1]) { event.preventDefault(); buttons[0].focus(); }
      }
    };
    document.addEventListener("keydown", keydown, true);
    return () => { document.removeEventListener("keydown", keydown, true); previous?.focus(); };
  }, [onContinue]);
  return createPortal(<div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm">
    <div ref={dialog} role="alertdialog" aria-modal="true" aria-label="Unsaved reservation changes" className="w-full max-w-md rounded-2xl bg-white p-6 text-neutral shadow-2xl">
      <h2 className="text-lg font-semibold">Discard unsaved changes?</h2>
      <p className="mt-2 text-sm text-neutral/65">Your reservation changes have not been saved.</p>
      <div className="mt-6 flex flex-wrap justify-end gap-3">
        <button type="button" onClick={onContinue} className="min-h-11 rounded-xl border border-neutral/20 px-4 text-sm font-semibold hover:bg-base">Continue Editing</button>
        <button type="button" onClick={onDiscard} className="min-h-11 rounded-xl bg-red-700 px-4 text-sm font-semibold text-white hover:bg-red-800">Discard Changes</button>
      </div>
    </div>
  </div>, document.body);
}

/** Capture the loaded form, so asynchronous defaults and reverted edits stay clean. */
export function useReservationFormGuard(enabled = true, busy = false, resetKey = "") {
  const root = useRef<HTMLDivElement>(null);
  const initial = useRef<string | null>(null);
  const touched = useRef(false);
  const leaving = useRef(false);
  const [dirty, setDirty] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const pending = useRef<(() => void) | null>(null);
  const checkTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const checkAfterEvent = useCallback(() => {
    if (checkTimer.current !== null) clearTimeout(checkTimer.current);
    // Trusted browser events can run microtasks between capture and bubble.
    // Wait for the next task so React's onChange stores the new value first.
    checkTimer.current = setTimeout(() => {
      checkTimer.current = null;
      setDirty(formSnapshot(root.current) !== initial.current);
    }, 0);
  }, []);
  const reset = useCallback(() => {
    touched.current = false; initial.current = formSnapshot(root.current); setDirty(false);
  }, []);
  useEffect(() => {
    if (!enabled || !root.current) return;
    const element = root.current;
    queueMicrotask(reset);
    const observer = new window.MutationObserver(() => {
      const snapshot = formSnapshot(element);
      if (!touched.current) initial.current = snapshot;
      else checkAfterEvent();
    });
    observer.observe(element, { childList: true, subtree: true, attributes: true });
    element.addEventListener("reservation-form-saved", reset);
    return () => {
      observer.disconnect(); element.removeEventListener("reservation-form-saved", reset);
      if (checkTimer.current !== null) clearTimeout(checkTimer.current);
    };
  }, [enabled, resetKey, reset, checkAfterEvent]);
  const requestClose = useCallback((action: () => void) => {
    if (busy) return;
    if (!touched.current || formSnapshot(root.current) === initial.current) { action(); return; }
    pending.current = action; setConfirming(true);
  }, [busy]);
  const continueEditing = useCallback(() => { pending.current = null; setConfirming(false); }, []);
  useEffect(() => {
    if (!enabled || !dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { if (!leaving.current) { event.preventDefault(); event.returnValue = ""; } };
    const navigate = (event: MouseEvent) => {
      const link = event.target instanceof window.Element ? event.target.closest("a[href]") as HTMLAnchorElement | null : null;
      if (!link || link.target === "_blank" || link.hasAttribute("download") || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return;
      event.preventDefault(); event.stopImmediatePropagation();
      requestClose(() => { reset(); leaving.current = true; window.location.assign(link.href); });
    };
    // History navigation can stay inside Next without triggering beforeunload.
    const navigation = (window as unknown as { navigation?: EventTarget & { traverseTo: (key: string) => unknown } }).navigation;
    const traverse = (event: Event) => {
      const next = event as Event & { navigationType?: string; destination?: { key: string } };
      if (leaving.current || next.navigationType !== "traverse" || !next.cancelable || !next.destination?.key) return;
      event.preventDefault();
      const key = next.destination.key;
      requestClose(() => { reset(); leaving.current = true; navigation?.traverseTo(key); });
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", navigate, true);
    navigation?.addEventListener("navigate", traverse);
    return () => { window.removeEventListener("beforeunload", beforeUnload); document.removeEventListener("click", navigate, true); navigation?.removeEventListener("navigate", traverse); };
  }, [enabled, dirty, requestClose, reset]);
  return {
    root, requestClose, reset,
    captureInitial: () => { if (!touched.current) initial.current = formSnapshot(root.current); },
    captureChange: () => { touched.current = true; checkAfterEvent(); },
    captureClick: (event: ReactMouseEvent) => {
      const button = event.target instanceof window.Element ? event.target.closest("button") : null;
      if (!button || button.type === "submit" || /month/i.test(button.getAttribute("aria-label") ?? "")) return;
      if (!touched.current) initial.current = formSnapshot(root.current);
      touched.current = true;
      checkAfterEvent();
    },
    confirmation: confirming ? <DiscardConfirmation onContinue={continueEditing} onDiscard={() => { const action = pending.current; pending.current = null; reset(); setConfirming(false); action?.(); }} /> : null,
  };
}
