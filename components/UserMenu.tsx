"use client";

import { createClient } from "@/lib/supabase/client";
import { User } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

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
  const router = useRouter();
  const supabase = createClient();

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
        setProfile(null);
        setNotifications([]);
      }
    };

    getUser();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (!session?.user) {
        setProfile(null);
        setNotifications([]);
      }
    });

    return () => subscription.unsubscribe();
  }, [supabase]);

  const fetchNotifications = useCallback(async (activeUser: User) => {
    setNotificationsLoading(true);

    const { data } = await supabase
      .from("notifications")
      .select("notification_id, title, message, action_url, is_read, created_at")
      .eq("recipient_role", "guest")
      .eq("recipient_id", activeUser.id)
      .order("created_at", { ascending: false })
      .limit(5);

    setNotifications((data as NotificationItem[] | null) ?? []);
    setNotificationsLoading(false);
  }, [supabase]);

  const handleMenuToggle = async () => {
    const nextOpen = !isOpen;
    setIsOpen(nextOpen);

    if (nextOpen && user) {
      await fetchNotifications(user);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setIsOpen(false);
    router.push('/');
    router.refresh();
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
    if (!user) return;

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

  const displayName = profile 
    ? `${profile.first_name} ${profile.last_name}`
    : user.email?.split('@')[0];

  return (
    <div className="relative">
      <button
        onClick={handleMenuToggle}
        className="flex items-center gap-2 text-neutral hover:text-primary transition-colors"
        aria-label="Open user menu"
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

      {isOpen && (
        <>
          <div 
            className="fixed inset-0 z-40" 
            onClick={() => setIsOpen(false)}
          />
          <div className="absolute right-0 mt-2 w-64 bg-white rounded-lg shadow-xl z-50 py-2 border border-neutral/10">
            <div className="px-4 py-3 border-b border-neutral/10">
              <p className="text-sm font-semibold text-neutral">{displayName}</p>
              <p className="text-xs text-neutral/60">{user.email}</p>
            </div>

            <div className="border-b border-neutral/10 px-4 py-3">
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
              <div className="mt-2 space-y-2">
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
            </div>
            
            <a
              href="/manage"
              className="block px-4 py-2 text-sm text-neutral hover:bg-neutral/5 transition-colors"
              onClick={() => setIsOpen(false)}
            >
              My Bookings
            </a>
            
            <a
              href="/profile"
              className="block px-4 py-2 text-sm text-neutral hover:bg-neutral/5 transition-colors"
              onClick={() => setIsOpen(false)}
            >
              Profile Settings
            </a>
            
            <div className="border-t border-neutral/10 mt-2 pt-2">
              <button
                onClick={handleLogout}
                className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors"
              >
                Sign Out
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
