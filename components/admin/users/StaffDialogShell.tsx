"use client";

import { useEffect } from "react";

interface StaffDialogShellProps {
  isOpen: boolean;
  title: string;
  description: string;
  onClose: () => void;
  children: React.ReactNode;
}

export default function StaffDialogShell({ isOpen, title, description, onClose, children }: StaffDialogShellProps) {
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-neutral/45 px-4 py-6"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-3xl border border-neutral/10 bg-white p-6 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="border-b border-neutral/10 pb-4">
          <h3 className="text-xl font-semibold text-neutral">{title}</h3>
          <p className="mt-1 text-sm text-neutral/70">{description}</p>
        </div>

        <div className="pt-5">{children}</div>
      </div>
    </div>
  );
}