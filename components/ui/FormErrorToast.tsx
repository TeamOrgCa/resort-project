"use client";

import { useEffect } from "react";

export default function FormErrorToast({ error, onDismiss }: { error: { message: string }; onDismiss: () => void }) {
  useEffect(() => {
    const timer = window.setTimeout(onDismiss, 7000);
    return () => window.clearTimeout(timer);
  }, [error, onDismiss]);

  return <div data-no-auto-scroll className="pointer-events-none fixed inset-x-0 top-4 z-[120] flex justify-center px-4">
    <div role="alert" className="pointer-events-auto flex w-full max-w-lg items-start gap-3 rounded-2xl border border-red-200 bg-white px-4 py-3 text-red-900 shadow-lg">
      <span aria-hidden="true" className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-50 font-bold text-red-700">!</span>
      <p className="min-w-0 flex-1 self-center break-words text-sm font-medium">{error.message}</p>
      <button type="button" onClick={onDismiss} aria-label="Dismiss registration error" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-700">
        <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="m6 6 12 12M18 6 6 18" /></svg>
      </button>
    </div>
  </div>;
}
