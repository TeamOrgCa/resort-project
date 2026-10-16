"use client";

import { createClient } from "@/lib/supabase/client";
import { useBookingStore } from "@/lib/stores/booking-store";
import type { User } from "@supabase/supabase-js";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

type NotificationItem = {
  notification_id: string;
  title: string;
  message: string | null;
  action_url: string | null;
  is_read: boolean;
  created_at: string;
};

type GuestProfile = {
  first_name: string | null;
  last_name: string | null;
};

export default function UserMenu() {
  const [user, setUser] = useState<User | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [profile, setProfile] = useState<GuestProfile | null>(null);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [notificationError, setNotificationError] = useState<string | null>(null);
  const [markingRead, setMarkingRead] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const supabase = useMemo(() => createClient(), []);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const [position, setPosition] = useState({ left: 8, top: 88, width: 320, maxHeight: 480 });

  useEffect(() => {
    if (!isOpen) return;
    panel.current?.querySelector<HTMLAnchorElement>('a[href="/profile"]')?.focus();
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !panel.current?.contains(event.target) && !trigger.current?.contains(event.target)) setIsOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); setIsOpen(false); trigger.current?.focus(); }
    };
    const dismiss = () => setIsOpen(false);
    const scrollOutside = (event: Event) => {
      if (event.target instanceof Node && panel.current?.contains(event.target)) return;
      dismiss();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    window.addEventListener("resize", dismiss);
    window.addEventListener("scroll", scrollOutside, true);
    window.visualViewport?.addEventListener("resize", dismiss);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("scroll", scrollOutside, true);
      window.visualViewport?.removeEventListener("resize", dismiss);
    };
  }, [isOpen]);

  useEffect(() => {
    const getUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setUser(user);

      if (user) {
        // Fetch profile data
        const { data } = await supabase
          .from('guests')
          .select('first_name, last_name')
          .eq('id', user.id)
          .maybeSingle<GuestProfile>();
        
        setProfile(data);
      } else {
        setIsOpen(false);
        setProfile(null);
        setNotifications([]);
      }
    };

    getUser();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (!session?.user) {
        setIsOpen(false);
        setProfile(null);
        setNotifications([]);
      }
    });

    return () => subscription.unsubscribe();
  }, [supabase]);

  const fetchNotifications = useCallback(async (activeUser: User) => {
    setNotificationsLoading(true);
    setNotificationError(null);
    try {
      const { data, error } = await supabase
      .from("notifications")
      .select("notification_id, title, message, action_url, is_read, created_at")
      .eq("recipient_role", "guest")
      .eq("recipient_id", activeUser.id)
      .order("created_at", { ascending: false })
      .limit(5);

      if (error) throw error;
      setNotifications((data as NotificationItem[] | null) ?? []);
    } catch {
      setNotificationError("Unable to load notifications. Please try again.");
    } finally { setNotificationsLoading(false); }
  }, [supabase]);

  const handleMenuToggle = async () => {
    const nextOpen = !isOpen;
    if (nextOpen) {
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(352, window.innerWidth - 16);
      const height = Math.min(600, window.innerHeight - 16);
      const top = Math.max(8, Math.min(rect.bottom + 8, window.innerHeight - height - 8));
      setPosition({ left: Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8)),
        top, width, maxHeight: window.innerHeight - top - 8 });
    }
    setIsOpen(nextOpen);

    if (nextOpen && user) {
      await fetchNotifications(user);
    }
  };

  const handleLogout = async () => {
    if (isLoggingOut) return;
    setIsLoggingOut(true);
    setLogoutError(null);

    let serverSignedOut = false;
    try {
      const response = await fetch('/api/auth/logout', { method: 'POST' });
      serverSignedOut = response.ok;
    } catch (error) {
      console.warn("Guest logout request failed", error);
    }

    try {
      const { error } = await supabase.auth.signOut({ scope: "local" });
      if (error && !serverSignedOut) throw error;
      useBookingStore.getState().resetBookingDraft();
      setUser(null);
      setProfile(null);
      setNotifications([]);
      setIsOpen(false);
      window.location.replace('/');
    } catch (error) {
      console.error("Guest logout failed", error);
      setLogoutError("Could not sign out. Please try again.");
      setIsLoggingOut(false);
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
      timeZone: "Asia/Manila",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  };

  const markAllNotificationsRead = async () => {
    if (!user || markingRead) return;

    const unreadIds = notifications.filter((item) => !item.is_read).map((item) => item.notification_id);
    if (!unreadIds.length) return;

    setMarkingRead(true);
    setNotificationError(null);
    try {
      const { error } = await supabase
      .from("notifications")
      .update({ is_read: true })
      .eq("recipient_role", "guest")
      .eq("recipient_id", user.id)
      .in("notification_id", unreadIds);
      if (error) throw error;
      setNotifications((prev) => prev.map((item) => ({ ...item, is_read: true })));
    } catch { setNotificationError("Could not mark notifications as read. Please try again."); }
    finally { setMarkingRead(false); }
  };

  if (!user) {
    return (
      <div className="flex items-center gap-2">
        <a
          href="/auth/login"
          className="text-neutral hover:text-primary transition-colors px-4 py-2"
        >
          Sign In
        </a>
        <a
          href="/auth/register"
          className="bg-primary text-base px-6 py-2 rounded-full hover:bg-primary/90 transition-colors"
        >
          Sign Up
        </a>
      </div>
    );
  }

  const displayName = [profile?.first_name, profile?.last_name].filter(Boolean).join(" ") || user.email?.split("@")[0] || "Guest";

  return (
    <div className="relative">
      <button
        ref={trigger}
        type="button"
        onClick={handleMenuToggle}
        className="flex min-h-11 items-center gap-2 text-neutral hover:text-primary transition-colors"
        aria-label="Open user menu"
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-controls={isOpen ? panelId : undefined}
      >
        <div className="relative w-10 h-10 bg-primary/20 rounded-full flex items-center justify-center">
          <span className="text-primary font-semibold">
            {profile?.first_name?.[0]?.toUpperCase() || user.email?.[0]?.toUpperCase()}
          </span>
          {unreadCount > 0 ? (
            <span className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full bg-accent" />
          ) : null}
        </div>
        <span className="hidden md:block font-medium">{displayName}</span>
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && createPortal(
          <div ref={panel} id={panelId} role="dialog" aria-label="Your account and notifications" style={position}
            className="fixed z-[80] flex max-w-[calc(100vw-16px)] flex-col overflow-y-auto overscroll-contain rounded-2xl border border-neutral/10 bg-white py-2 text-neutral shadow-2xl">
            <div className="flex shrink-0 items-start gap-2 border-b border-neutral/10 px-4 py-3">
              <div className="min-w-0 flex-1"><p title={displayName} className="truncate text-sm font-semibold text-neutral">{displayName}</p>
              <p title={user.email} className="truncate text-xs text-neutral/60">{user.email}</p></div>
              <button type="button" aria-label="Close user menu" onClick={() => { setIsOpen(false); trigger.current?.focus(); }}
                className="-mr-2 -mt-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-xl text-neutral/70 hover:bg-base">×</button>
            </div>
            <div className="shrink-0 border-b border-neutral/10 py-1" aria-label="Account actions">
              <a href="/profile" onClick={() => setIsOpen(false)} className="flex min-h-11 items-center px-4 py-2 text-sm font-medium text-neutral transition-colors hover:bg-base">Profile Settings</a>
              <a href="/manage" onClick={() => setIsOpen(false)} className="flex min-h-11 items-center px-4 py-2 text-sm text-neutral transition-colors hover:bg-base">My Bookings</a>
              <button type="button" onClick={handleLogout} disabled={isLoggingOut}
                className="flex min-h-11 w-full items-center px-4 py-2 text-left text-sm font-medium text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50">{isLoggingOut ? "Signing out..." : "Sign Out"}</button>
              {logoutError && <p role="alert" className="px-4 py-2 text-xs text-red-600">{logoutError}</p>}
            </div>
            <section aria-label="Notifications" className="flex min-h-0 flex-1 flex-col px-4 py-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wide text-neutral/60">Notifications</p>
                {unreadCount > 0 ? (
                  <button
                    type="button"
                    onClick={markAllNotificationsRead}
                    disabled={markingRead || notificationsLoading}
                    className="min-h-11 text-xs font-medium text-primary hover:text-primary/80 disabled:opacity-50"
                  >
                    {markingRead ? "Saving..." : "Mark all read"}
                  </button>
                ) : null}
              </div>
              {notificationError && <div role="alert" className="mb-2 rounded-lg bg-red-50 p-2 text-xs text-red-700">{notificationError}
                <button type="button" disabled={notificationsLoading || markingRead} onClick={() => void fetchNotifications(user)} className="ml-2 min-h-11 font-semibold underline disabled:opacity-50">Retry</button>
              </div>}
              <div className="mt-2 min-h-0 max-h-[35dvh] space-y-2 overflow-y-auto overscroll-contain [overflow-wrap:anywhere]" tabIndex={0} aria-label="Recent notifications" aria-busy={notificationsLoading}>
                {notificationsLoading ? (
                  <p className="text-xs text-neutral/60">Loading notifications...</p>
                ) : notifications.length === 0 && !notificationError ? (
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
                          onClick={() => setIsOpen(false)}
                          className="block"
                        >
                          {content}
                        </a>
                      );
                    }

                    return content;
                  })
                )}
              </div>
            </section>
          </div>
      , document.body)}
    </div>
  );
}
