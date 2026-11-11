"use client";

import { createPortal } from "react-dom";
import { useEffect, useEffectEvent, useSyncExternalStore } from "react";
import type { NotificationItem } from "./NotificationCenter";

const compactQuery = "(max-width: 639px), (max-height: 500px)";
const compactSnapshot = () => typeof window.matchMedia === "function" && window.matchMedia(compactQuery).matches;
const serverSnapshot = () => false;
function subscribeCompact(onChange: () => void) {
  if (typeof window.matchMedia !== "function") return () => {};
  const media = window.matchMedia(compactQuery);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function NotificationAlert({ item, onDismiss, compact, remaining, onDismissAll }: {
  item: NotificationItem; onDismiss: (id: string) => void; compact: boolean; remaining: number; onDismissAll: () => void;
}) {
  const dismiss = useEffectEvent(() => onDismiss(item.notification_id));
  useEffect(() => {
    const timer = window.setTimeout(() => dismiss(), 5000);
    return () => window.clearTimeout(timer);
  }, [item.notification_id]);

  const href = item.action_url?.startsWith("/") && !item.action_url.startsWith("//") ? item.action_url : null;
  return <article role="status" className={`pointer-events-auto rounded-2xl border border-neutral/15 border-l-4 border-l-primary bg-white shadow-xl [overflow-wrap:anywhere] ${compact ? "p-2" : "p-4"}`}>
    <div className={`flex items-start ${compact ? "gap-2" : "gap-3"}`}>
      <span className={`flex shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary ${compact ? "mt-1 h-8 w-8" : "h-10 w-10"}`} aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5"><path strokeLinecap="round" strokeLinejoin="round" d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></svg>
      </span>
      <div className="min-w-0 flex-1">{!compact && <p className="text-xs font-semibold uppercase tracking-wide text-primary">New notification</p>}<h2 title={item.title} className={`text-sm font-semibold ${compact ? "line-clamp-2 pt-1 leading-5" : "mt-1"}`}>{item.title}</h2></div>
      <button type="button" aria-label={`Dismiss notification: ${item.title}`} onClick={() => onDismiss(item.notification_id)} title="Dismiss notification"
        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-neutral/60 hover:bg-neutral/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${compact ? "" : "-mr-2 -mt-2"}`}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5" aria-hidden="true"><path strokeLinecap="round" d="m6 6 12 12M18 6 6 18" /></svg>
      </button>
    </div>
    {!compact && item.message && <p tabIndex={0} className="mt-3 max-h-32 overflow-y-auto overscroll-contain whitespace-pre-line text-sm leading-relaxed text-neutral/80">{item.message}</p>}
    {compact ? <div className="flex min-h-11 items-center justify-between gap-2">
      {href ? <a href={href} onClick={() => onDismiss(item.notification_id)} className="inline-flex min-h-11 shrink-0 items-center rounded-lg px-2 text-xs font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">View details<span className="sr-only">: {item.title}</span></a>
        : <p className="min-w-0 text-xs text-neutral/65">Saved in notifications</p>}
      <div className="flex shrink-0 items-center gap-1">{remaining > 0 && <p className="text-xs text-neutral/65">+{remaining} more<span className="sr-only"> waiting in your notifications</span></p>}
        <button type="button" onClick={onDismissAll} className="min-h-11 rounded-lg px-2 text-xs font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">Dismiss all</button>
      </div>
    </div> : href && <a href={href} onClick={() => onDismiss(item.notification_id)} className="mt-3 inline-flex min-h-11 items-center rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2">View details<span className="sr-only">: {item.title}</span></a>}
  </article>;
}

export default function NotificationAlerts({ items, remaining, onDismiss, onDismissAll }: {
  items: NotificationItem[]; remaining: number; onDismiss: (id: string) => void; onDismissAll: () => void;
}) {
  const compact = useSyncExternalStore(subscribeCompact, compactSnapshot, serverSnapshot);
  if (!items.length) return null;
  const visibleItems = compact ? items.slice(0, 1) : items;
  const waiting = remaining + items.length - visibleItems.length;
  return createPortal(<aside aria-label="New notifications" aria-live="polite" aria-relevant="additions" data-no-auto-scroll
    className={`pointer-events-none fixed z-[110] text-neutral ${compact ? "inset-x-3 top-[calc(env(safe-area-inset-top,0px)+5.5rem)] ml-auto max-w-sm" : "inset-x-3 top-24 max-h-[calc(100dvh-7rem)] space-y-3 overflow-y-auto overscroll-contain sm:left-auto sm:right-5 sm:w-96"}`}>
    {visibleItems.map(item => <NotificationAlert key={item.notification_id} item={item} onDismiss={onDismiss} compact={compact} remaining={waiting} onDismissAll={onDismissAll} />)}
    {!compact && <div className="pointer-events-auto flex items-center justify-between gap-3 rounded-xl border border-neutral/10 bg-white px-3 py-1 shadow-lg">
      <p className="text-xs text-neutral/65">{remaining > 0 ? `${remaining} more waiting. ` : ""}Saved in your notifications.</p>
      <button type="button" onClick={onDismissAll} className="min-h-11 shrink-0 px-2 text-sm font-semibold text-primary hover:underline">Dismiss all</button>
    </div>}
  </aside>, document.body);
}
