"use client";

import { formatManilaDateTime } from "@/lib/booking/manila-date";

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import NotificationStatusFilters, { notificationMatchesFilter, notificationStatusClass, type NotificationFilter } from "@/components/notifications/NotificationStatusFilters";
import { createClient } from "@/lib/supabase/client";
import type { StaffRole } from "@/lib/auth/staff-auth";
import { useNotificationCenter } from "@/components/notifications/NotificationCenter";

type NotificationItem = {
  notification_id: string;
  title: string;
  message: string | null;
  action_url: string | null;
  is_read: boolean;
  created_at: string;
};

export default function AdminNotifications({ role }: { role: StaffRole }) {
  const popupHelpId = useId();
  const [isOpen, setIsOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<NotificationFilter>("All");
  const [localNotifications, setNotifications] = useState<NotificationItem[]>([]);
  const [localNotificationsLoading, setNotificationsLoading] = useState(false);
  const notificationCenter = useNotificationCenter();
  const notifications = notificationCenter?.notifications ?? localNotifications;
  const visibleNotifications = notifications.filter(item => notificationMatchesFilter(item, statusFilter));
  const notificationsLoading = notificationCenter?.loading ?? localNotificationsLoading;
  const [userId, setUserId] = useState<string | null>(null);
  const supabase = useMemo(() => createClient(), []);
  const pauseAlerts = notificationCenter?.pauseAlerts;
  useEffect(() => isOpen ? pauseAlerts?.() : undefined, [isOpen, pauseAlerts]);

  useEffect(() => {
    const loadUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setUserId(user?.id ?? null);
    };

    loadUser();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserId(session?.user?.id ?? null);
      if (!session?.user) {
        setNotifications([]);
      }
    });

    return () => subscription.unsubscribe();
  }, [supabase]);

  const fetchNotifications = useCallback(async (activeUserId: string) => {
    if (notificationCenter) { notificationCenter.refresh(); return; }
    setNotificationsLoading(true);

    const { data } = await supabase
      .from("notifications")
      .select("notification_id, title, message, action_url, is_read, created_at")
      .eq("recipient_role", role)
      .eq("recipient_id", activeUserId)
      .order("created_at", { ascending: false })
      .limit(6);

    setNotifications((data as NotificationItem[] | null) ?? []);
    setNotificationsLoading(false);
  }, [supabase, role, notificationCenter]);

  const handleToggle = async () => {
    const nextOpen = !isOpen;
    setIsOpen(nextOpen);

    if (nextOpen && userId && !notificationCenter) {
      await fetchNotifications(userId);
    }
  };

  const unreadCount = useMemo(
    () => notifications.filter((item) => !item.is_read).length,
    [notifications]
  );

  const formatNotificationTime = (value: string) => {
    return formatManilaDateTime(value, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }, "");
  };

  const markAllNotificationsRead = async (id?: string) => {
    if (notificationCenter) { await (id ? notificationCenter.markRead(id) : notificationCenter.markAllRead()); return; }
    if (!userId) return;

    const unreadIds = notifications.filter((item) => !item.is_read && (!id || item.notification_id === id)).map((item) => item.notification_id);
    if (!unreadIds.length) return;

    const { error } = await supabase
      .from("notifications")
      .update({ is_read: true })
      .eq("recipient_role", role)
      .eq("recipient_id", userId)
      .in("notification_id", unreadIds);

    if (!error) {
      setNotifications((prev) => prev.map((item) => unreadIds.includes(item.notification_id) ? { ...item, is_read: true } : item));
    }
  };


  if (!userId) {
    return null;
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={handleToggle}
        className="relative rounded-full border border-neutral/20 bg-white p-2 text-neutral hover:bg-base"
        aria-label="Open admin notifications"
        aria-expanded={isOpen}
      >
        <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6 6 0 10-12 0v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0a3 3 0 11-6 0m6 0H9"
          />
        </svg>
        {unreadCount > 0 ? (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        ) : null}
      </button>

      {isOpen ? (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40"
            onClick={() => setIsOpen(false)}
            aria-label="Close notifications"
          />
          <div className="absolute right-0 z-50 mt-3 max-h-[calc(100dvh-6rem)] w-[min(22rem,calc(100vw-2rem))] overflow-y-auto overscroll-contain rounded-xl border border-neutral/10 bg-white p-3 shadow-xl [overflow-wrap:anywhere]">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-neutral/60">Notifications</p>
              {unreadCount > 0 ? (
                <button
                  type="button"
                  onClick={() => void markAllNotificationsRead()}
                  disabled={notificationCenter?.markingRead}
                  className="min-h-11 text-xs font-medium text-primary hover:text-primary/80 disabled:opacity-50"
                >
                  Mark all read
                </button>
              ) : null}
            </div>
            {notificationCenter?.error && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-xs text-red-800">{notificationCenter.error}<button type="button" onClick={notificationCenter.refresh} className="ml-2 min-h-11 font-semibold underline">Retry</button></p>}
            <NotificationStatusFilters value={statusFilter} onChange={setStatusFilter} />
            {notificationCenter && <div className="mt-3 flex items-center gap-3 rounded-xl border border-neutral/15 bg-slate-50 p-3">
              <div className="min-w-0 flex-1"><p className="text-sm font-medium">Pop-up notifications</p>
                <p id={popupHelpId} className="mt-1 text-xs leading-relaxed text-neutral/65">{notificationCenter.savingPreference ? "Saving preference..." : notificationCenter.popupsEnabled ? "On — show pop-up updates." : "Off — updates stay in this menu."} Saved with your account.</p>
              </div>
              <button type="button" role="switch" aria-label="Pop-up notifications" aria-checked={notificationCenter.popupsEnabled} aria-describedby={popupHelpId}
                disabled={notificationCenter.savingPreference} onClick={() => void notificationCenter.setPopupsEnabled(!notificationCenter.popupsEnabled)}
                className="flex min-h-11 min-w-14 shrink-0 items-center justify-center rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-50">
                <span aria-hidden="true" className={`flex h-7 w-12 items-center rounded-full px-1 transition-colors ${notificationCenter.popupsEnabled ? "bg-primary" : "bg-neutral/30"}`}>
                  <span className={`h-5 w-5 rounded-full bg-white shadow transition-transform ${notificationCenter.popupsEnabled ? "translate-x-5" : "translate-x-0"}`} />
                </span>
              </button>
            </div>}
            {notificationCenter?.preferenceError && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-xs text-red-700">{notificationCenter.preferenceError}</p>}
            <div className="mt-3 max-h-[60dvh] space-y-2 overflow-y-auto" aria-label="Recent notifications">
              {notificationsLoading ? (
                <p className="text-xs text-neutral/60">Loading notifications...</p>
              ) : visibleNotifications.length === 0 ? (
                <p className="text-xs text-neutral/60">{statusFilter === "All" ? "No notifications yet." : `No ${statusFilter.toLowerCase()} notifications.`}</p>
              ) : (
                visibleNotifications.map((item) => {
                  const content = (
                    <div
                      key={item.notification_id}
                      className={`rounded-md border px-3 py-2 text-left text-xs transition-colors ${
                        notificationStatusClass(item.is_read)
                      }`}
                    >
                      <p className="font-semibold text-neutral">{item.title}</p>
                      <span className="text-[10px] font-medium text-neutral/60">{item.is_read ? "Read" : "Unread"}</span>
                      {item.message ? (
                        <p className="mt-1 text-neutral/70">{item.message}</p>
                      ) : null}
                      <p className="mt-1 text-[11px] text-neutral/50">
                        {formatNotificationTime(item.created_at)}
                      </p>
                    </div>
                  );

                  if (item.action_url) {
                    return (
                      <a
                        key={item.notification_id}
                        href={item.action_url}
                        className="block"
                        onClick={() => { void markAllNotificationsRead(item.notification_id); setIsOpen(false); }}
                      >
                        {content}
                      </a>
                    );
                  }

                  return content;
                })
              )}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
