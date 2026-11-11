"use client";

import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { usePortalTarget } from "@/lib/use-portal-target";

interface ConfirmationDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  isConfirming?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmationDialog({
  isOpen,
  title,
  message,
  confirmText = "Confirm",
  cancelText = "Cancel",
  isConfirming = false,
  onConfirm,
  onCancel,
}: ConfirmationDialogProps) {
  const portalTarget = usePortalTarget();
  const dialog = useRef<HTMLDivElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const titleId = useId(), messageId = useId();
  const callbacks = useRef({ onCancel, isConfirming });
  useEffect(() => { callbacks.current = { onCancel, isConfirming }; }, [onCancel, isConfirming]);
  useEffect(() => {
    if (!isOpen || !portalTarget) {
      return;
    }
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    cancel.current?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault(); event.stopImmediatePropagation();
        if (!callbacks.current.isConfirming) callbacks.current.onCancel();
      }
      if (event.key === "Tab") {
        event.stopImmediatePropagation();
        const buttons = [...(dialog.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
        const first = buttons[0], last = buttons.at(-1);
        if (!first) { event.preventDefault(); return; }
        if (event.shiftKey && (document.activeElement === first || !dialog.current?.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || !dialog.current?.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", handleKey, true);
    return () => {
      document.removeEventListener("keydown", handleKey, true);
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [isOpen, portalTarget]);

  if (!isOpen || !portalTarget) {
    return null;
  }

  return createPortal(
    <div
      ref={dialog}
      className="admin-workspace fixed inset-0 z-[200] flex items-center justify-center overflow-y-auto bg-neutral/40 p-3 sm:p-4"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={messageId}
      onClick={() => {
        if (!isConfirming) {
          onCancel();
        }
      }}
    >
      <div
        className="max-h-[90dvh] w-full max-w-md overflow-y-auto overscroll-contain rounded-2xl border border-neutral/10 bg-white p-4 shadow-xl sm:p-6"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 id={titleId} className="text-lg font-semibold text-neutral">{title}</h3>
        <p id={messageId} className="mt-2 whitespace-pre-line text-sm text-neutral/80">{message}</p>

        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            ref={cancel}
            type="button"
            onClick={onCancel}
            disabled={isConfirming}
            className="rounded-lg border border-neutral/20 px-4 py-2 text-sm font-medium text-neutral hover:bg-base disabled:cursor-not-allowed disabled:opacity-50"
          >
            {cancelText}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isConfirming}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-base hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isConfirming ? "Processing..." : confirmText}
          </button>
        </div>
      </div>
    </div>, portalTarget
  );
}
