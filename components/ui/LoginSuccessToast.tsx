"use client";

import { useEffect, useState } from "react";
import { SESSION_CHANGE_EVENT, SESSION_CHANGE_STORAGE_KEY } from "@/lib/auth/session-events";

const eventName = "marville:login-success";

export function showLoginSuccessToast(message: string) {
  window.dispatchEvent(new window.CustomEvent(eventName, { detail: message }));
}

export default function LoginSuccessToast() {
  const [toast, setToast] = useState<{ message: string } | null>(null);

  useEffect(() => {
    const show = (event: Event) => {
      const message: unknown = (event as CustomEvent).detail;
      if (typeof message === "string" && message.trim()) setToast({ message });
    };
    const changingSession = (event: Event) => {
      if ((event as CustomEvent).detail === "changing") setToast(null);
    };
    const otherTab = (event: StorageEvent) => {
      if (event.key === SESSION_CHANGE_STORAGE_KEY) setToast(null);
    };
    window.addEventListener(eventName, show);
    window.addEventListener(SESSION_CHANGE_EVENT, changingSession);
    window.addEventListener("storage", otherTab);
    return () => {
      window.removeEventListener(eventName, show);
      window.removeEventListener(SESSION_CHANGE_EVENT, changingSession);
      window.removeEventListener("storage", otherTab);
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 5000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  return <div className="pointer-events-none fixed inset-x-0 top-4 z-[120] flex justify-center px-4" aria-live="polite" aria-atomic="true">
    {toast && <div role="status" className="pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-2xl border border-green-200 bg-white px-4 py-3 text-green-900 shadow-lg">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-green-50 text-green-700" aria-hidden="true">
        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 4 4L19 6" /></svg>
      </span>
      <p className="min-w-0 flex-1 break-words text-sm font-semibold">{toast.message}</p>
      <button type="button" onClick={() => setToast(null)} aria-label="Dismiss login notification" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-green-800 hover:bg-green-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-700">
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
      </button>
    </div>}
  </div>;
}
