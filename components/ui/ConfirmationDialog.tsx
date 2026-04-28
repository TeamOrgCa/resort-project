"use client";

import { useEffect } from "react";

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
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isConfirming) {
        onCancel();
      }
    };

    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen, isConfirming, onCancel]);

  if (!isOpen) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-neutral/40 px-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={() => {
        if (!isConfirming) {
          onCancel();
        }
      }}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-neutral/10 bg-white p-6 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 className="text-lg font-semibold text-neutral">{title}</h3>
        <p className="mt-2 text-sm text-neutral/80">{message}</p>

        <div className="mt-6 flex justify-end gap-3">
          <button
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
    </div>
  );
}
