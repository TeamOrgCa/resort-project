"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type NotificationItem = {
  notification_id: string;
  title: string;
  message: string | null;
  action_url: string | null;
  is_read: boolean;
  created_at: string;
};

export default function AdminNotifications() {
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const supabase = createClient();

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
    setNotificationsLoading(true);

    const { data } = await supabase
      .from("notifications")
      .select("notification_id, title, message, action_url, is_read, created_at")
      .eq("recipient_role", "staff")
      .or(`recipient_id.is.null,recipient_id.eq.${activeUserId}`)
      .order("created_at", { ascending: false })
      .limit(6);

    setNotifications((data as NotificationItem[] | null) ?? []);
    setNotificationsLoading(false);
  }, [supabase]);

  const handleToggle = async () => {
    const nextOpen = !isOpen;
    setIsOpen(nextOpen);

    if (nextOpen && userId) {
      await fetchNotifications(userId);
    }
  };

  const unreadCount = useMemo(
    () => notifications.filter((item) => !item.is_read).length,
    [notifications]
  );

  const formatNotificationTime = (value: string) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return "";
    }
    return date.toLocaleString("en-PH", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  };

  const markAllNotificationsRead = async () => {
    if (!userId) return;

    const unreadIds = notifications.filter((item) => !item.is_read).map((item) => item.notification_id);
    if (!unreadIds.length) return;

    const { error } = await supabase
      .from("notifications")
      .update({ is_read: true })
      .in("notification_id", unreadIds);

    if (!error) {
      setNotifications((prev) => prev.map((item) => ({ ...item, is_read: true })));
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
          <div className="absolute right-0 z-50 mt-3 w-80 rounded-xl border border-neutral/10 bg-white p-3 shadow-xl">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-neutral/60">Notifications</p>
              {unreadCount > 0 ? (
                <button
                  type="button"
                  onClick={markAllNotificationsRead}
                  className="text-xs font-medium text-primary hover:text-primary/80"
                >
                  Mark all read
                </button>
              ) : null}
            </div>
            <div className="mt-3 space-y-2">
              {notificationsLoading ? (
                <p className="text-xs text-neutral/60">Loading notifications...</p>
              ) : notifications.length === 0 ? (
                <p className="text-xs text-neutral/60">No notifications yet.</p>
              ) : (
                notifications.map((item) => {
                  const content = (
                    <div
                      key={item.notification_id}
                      className={`rounded-md border px-3 py-2 text-left text-xs transition-colors ${
                        item.is_read
                          ? "border-neutral/10 bg-base"
                          : "border-primary/20 bg-primary/5"
                      }`}
                    >
                      <p className="font-semibold text-neutral">{item.title}</p>
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
                        onClick={() => setIsOpen(false)}
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
