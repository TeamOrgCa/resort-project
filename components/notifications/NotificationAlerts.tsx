"use client";

import { createPortal } from "react-dom";
import { useEffect, useEffectEvent } from "react";
import type { NotificationItem } from "./NotificationCenter";

function NotificationAlert({ item, onDismiss }: { item: NotificationItem; onDismiss: (id: string) => void }) {
  const dismiss = useEffectEvent(() => onDismiss(item.notification_id));
  useEffect(() => {
    const timer = window.setTimeout(() => dismiss(), 5000);
    return () => window.clearTimeout(timer);
  }, [item.notification_id]);

  const href = item.action_url?.startsWith("/") && !item.action_url.startsWith("//") ? item.action_url : null;
  return <article role="status" className="pointer-events-auto rounded-2xl border border-neutral/15 border-l-4 border-l-primary bg-white p-4 shadow-xl [overflow-wrap:anywhere]">
    <div className="flex items-start gap-3">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5"><path strokeLinecap="round" strokeLinejoin="round" d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></svg>
      </span>
      <div className="min-w-0 flex-1"><p className="text-xs font-semibold uppercase tracking-wide text-primary">New notification</p><h2 className="mt-1 text-sm font-semibold">{item.title}</h2></div>
      <button type="button" aria-label={`Dismiss notification: ${item.title}`} onClick={() => onDismiss(item.notification_id)} title="Dismiss notification"
        className="-mr-2 -mt-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-neutral/60 hover:bg-neutral/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5" aria-hidden="true"><path strokeLinecap="round" d="m6 6 12 12M18 6 6 18" /></svg>
      </button>
    </div>
    {item.message && <p tabIndex={0} className="mt-3 max-h-32 overflow-y-auto overscroll-contain whitespace-pre-line text-sm leading-relaxed text-neutral/80">{item.message}</p>}
    {href && <a href={href} onClick={() => onDismiss(item.notification_id)} className="mt-3 inline-flex min-h-11 items-center rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2">View details<span className="sr-only">: {item.title}</span></a>}
  </article>;
}

export default function NotificationAlerts({ items, remaining, onDismiss, onDismissAll }: {
  items: NotificationItem[]; remaining: number; onDismiss: (id: string) => void; onDismissAll: () => void;
}) {
  if (!items.length) return null;
  return createPortal(<aside aria-label="New notifications" aria-live="polite" aria-relevant="additions" data-no-auto-scroll
    className="pointer-events-none fixed inset-x-3 top-24 z-[110] max-h-[calc(100dvh-7rem)] space-y-3 overflow-y-auto overscroll-contain text-neutral sm:left-auto sm:right-5 sm:w-96">
    {items.map(item => <NotificationAlert key={item.notification_id} item={item} onDismiss={onDismiss} />)}
    <div className="pointer-events-auto flex items-center justify-between gap-3 rounded-xl border border-neutral/10 bg-white px-3 py-1 shadow-lg">
      <p className="text-xs text-neutral/65">{remaining > 0 ? `${remaining} more waiting. ` : ""}Saved in your notifications.</p>
      <button type="button" onClick={onDismissAll} className="min-h-11 shrink-0 px-2 text-sm font-semibold text-primary hover:underline">Dismiss all</button>
    </div>
  </aside>, document.body);
}
