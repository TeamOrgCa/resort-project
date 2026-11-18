"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import NotificationAlerts from "./NotificationAlerts";
import type { User } from "@supabase/supabase-js";
import { SESSION_CHANGE_EVENT, SESSION_CHANGE_STORAGE_KEY } from "@/lib/auth/session-events";
import { usePathname, useRouter } from "next/navigation";
import { notificationActionUrl } from "@/lib/notification-links";
import { formatNotificationText } from "@/lib/notification-text";
import { customerAccountUser, isCustomerAccountPage } from "@/lib/auth/customer-access";

export type NotificationItem = {
  recipient_id: string;
  notification_id: string; title: string; message: string | null; action_url: string | null;
  is_read: boolean; created_at: string;
  entity_type?: string | null; entity_id?: string | null;
};
type Feed = { key: string; items: NotificationItem[]; error: string | null };
type Center = {
  user: User | null;
  identityReady: boolean;
  notifications: NotificationItem[]; loading: boolean; error: string | null;
  refresh: () => void; markAllRead: () => Promise<void>; markingRead: boolean;
  markRead: (id: string) => Promise<void>;
  pauseAlerts: () => () => void;
  popupsEnabled: boolean; setPopupsEnabled: (enabled: boolean) => Promise<void>;
  savingPreference: boolean; preferenceError: string | null;
};
const Context = createContext<Center | null>(null);
export const useNotificationCenter = () => useContext(Context);
const inactiveCenter: Center = {
  user: null, identityReady: false, notifications: [], loading: false, error: null,
  refresh: () => {}, markAllRead: async () => {}, markRead: async () => {}, markingRead: false,
  pauseAlerts: () => () => {}, popupsEnabled: true, setPopupsEnabled: async () => {},
  savingPreference: false, preferenceError: null,
};
const storageKey = (key: string) => `marville:notification-popups:${key}`;
const accountFromUser = (user: User | null) => user ? { id: user.id, user, popupsEnabled: user.user_metadata?.notification_popups_enabled !== false } : null;
function dismissedInSession(key: string): string[] {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(storageKey(key)) ?? "[]");
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string").slice(-200) : [];
  } catch { return []; }
}

export default function NotificationCenter({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  // Tabs share auth cookies. A session in another tab must not populate a login
  // or recovery screen. Unmount the active feed to retire requests and timers.
  const authenticationPage = !pathname || /^\/(auth|staff)(\/|$)/.test(pathname) || /^\/admin\/login(\/|$)/.test(pathname);
  if (authenticationPage) return <Context.Provider value={inactiveCenter}>{children}</Context.Provider>;
  const customerView = !/^\/admin(?:\/|$)/.test(pathname);
  return <ActiveNotificationCenter key={customerView ? "customer" : "staff"} customerView={customerView}>
    {customerView && isCustomerAccountPage(pathname) ? <CustomerAccountGate>{children}</CustomerAccountGate> : children}
  </ActiveNotificationCenter>;
}

// Also guard cached client navigation and account switches in another tab.
// Guest pages must not mount and query a staff session while identity is loading.
function CustomerAccountGate({ children }: { children: ReactNode }) {
  const center = useNotificationCenter();
  const router = useRouter();
  const ready = center?.identityReady, user = center?.user;
  useEffect(() => {
    if (ready && !user) router.replace("/");
  }, [ready, user, router]);
  if (!ready || !user) return <p role="status" className="p-6 text-center">Checking guest account access...</p>;
  return children;
}

function ActiveNotificationCenter({ children, customerView }: { children: ReactNode; customerView: boolean }) {
  const supabase = useMemo(() => createClient(), []);
  const [account, setAccount] = useState<ReturnType<typeof accountFromUser>>(null);
  const [identityReady, setIdentityReady] = useState(false);
  const [savingPreference, setSavingPreference] = useState(false);
  const [preferenceError, setPreferenceError] = useState<{ key: string; message: string } | null>(null);
  const savingPreferenceRef = useRef(false);
  const [feed, setFeed] = useState<Feed | null>(null);
  const [revision, setRevision] = useState(0);
  const [dismissed, setDismissed] = useState<Record<string, string[]>>({});
  const [markingRead, setMarkingRead] = useState(false);
  const saving = useRef(false);
  const readRevision = useRef(0);
  const [paused, setPaused] = useState(0);
  const identity = useRef({ id: "", generation: 0, changing: false });
  const key = account?.id ?? "";
  const notifications = useMemo(() => key && feed?.key === key ? feed.items : [], [key, feed]);
  const dismissedIds = useMemo(() => new Set(key ? [...dismissedInSession(key), ...(dismissed[key] ?? [])] : []), [key, dismissed]);
  const pending = useMemo(() => notifications.filter(item => !item.is_read && !dismissedIds.has(item.notification_id)), [notifications, dismissedIds]);
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  const pauseAlerts = useCallback(() => {
    setPaused(value => value + 1);
    return () => setPaused(value => Math.max(value - 1, 0));
  }, []);

  useEffect(() => {
    let active = true, lookup = 0;
    const acceptUser = (user: User | null, ready = true) => {
      if (!active || identity.current.changing) return;
      const nextId = user?.id ?? "";
      if (identity.current.id !== nextId || !nextId) {
        identity.current.id = nextId;
        identity.current.generation++;
        setFeed(null);
        readRevision.current++;
      }
      setAccount(accountFromUser(user));
      setIdentityReady(ready);
    };
    const syncAccount = async () => {
      if (!active || identity.current.changing) return;
      const request = ++lookup, generation = identity.current.generation;
      try {
        const { data: { user }, error } = await supabase.auth.getUser();
        const visibleUser = error ? null : customerView ? await customerAccountUser(supabase, user) : user;
        if (active && request === lookup && generation === identity.current.generation) acceptUser(visibleUser, !error || error.name === "AuthSessionMissingError");
      } catch {
        // Fail closed: cached account notifications must not survive an
        // identity check that cannot establish the signed-in user.
        if (active && request === lookup && generation === identity.current.generation) acceptUser(null, false);
      }
    };
    void syncAccount();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      lookup++;
      if (session?.user?.id === identity.current.id && identity.current.id && !identity.current.changing) {
        // Recheck refreshed tokens without unmounting an unchanged guest's form.
        void syncAccount();
        return;
      }
      identity.current.id = "";
      identity.current.generation++;
      setAccount(null); setIdentityReady(false); setFeed(null); readRevision.current++;
      // Do not expose the raw shared session before its account type is checked.
      if (session?.user) void syncAccount();
      else acceptUser(null);
    });
    const onSessionChange = (event: Event) => {
      lookup++;
      identity.current = { id: "", generation: identity.current.generation + 1,
        changing: (event as CustomEvent).detail === "changing" };
      setAccount(null); setIdentityReady(false); setFeed(null); readRevision.current++;
      if (!identity.current.changing) void syncAccount();
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === SESSION_CHANGE_STORAGE_KEY) onSessionChange(new Event(SESSION_CHANGE_EVENT));
    };
    const onFocus = () => { void syncAccount(); };
    const onVisible = () => { if (document.visibilityState !== "hidden") void syncAccount(); };
    const interval = window.setInterval(() => { if (!identity.current.id) onVisible(); }, 15_000);
    window.addEventListener(SESSION_CHANGE_EVENT, onSessionChange);
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", onFocus);
    window.addEventListener("pageshow", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      active = false; lookup++; subscription.unsubscribe(); window.clearInterval(interval);
      window.removeEventListener(SESSION_CHANGE_EVENT, onSessionChange);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", onFocus); window.removeEventListener("pageshow", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [supabase, customerView]);

  useEffect(() => {
    if (!key) return;
    const generation = identity.current.generation;
    const currentAccount = () => active && !identity.current.changing && identity.current.id === key && identity.current.generation === generation;
    let active = true, loading = false, queued = false;
    const load = async () => {
      if (!currentAccount()) return;
      if (loading) { queued = true; return; }
      loading = true;
      const revisionAtStart = readRevision.current;
      let identityVerified = false;
      try {
        // Cookies may have changed in a server route or another tab without a
        // Supabase event. Verify identity before each refresh, not just at mount.
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        const visibleUser = authError ? null : customerView ? await customerAccountUser(supabase, user) : user;
        if (!currentAccount()) return;
        if (authError || visibleUser?.id !== key) {
          identity.current.id = visibleUser?.id ?? "";
          identity.current.generation++;
          setFeed(null); setAccount(accountFromUser(visibleUser));
          setIdentityReady(!authError || authError.name === "AuthSessionMissingError");
          return;
        }
        identityVerified = true;
        // Recipient filtering and the existing row policies enforce account/role access.
        const { data, error } = await supabase.from("notifications")
          .select("notification_id, recipient_id, title, message, action_url, is_read, created_at, entity_type, entity_id")
          .eq("recipient_id", key)
          .order("created_at", { ascending: false }).limit(30);
        if (error) throw error;
        if (currentAccount() && revisionAtStart === readRevision.current) setFeed({ key, items: ((data ?? []) as NotificationItem[]).filter(item => item.recipient_id === key).map(item => ({ ...item, title: formatNotificationText(item.title), message: item.message ? formatNotificationText(item.message) : item.message, action_url: notificationActionUrl(item) })), error: null });
        else if (currentAccount()) queued = true;
      } catch {
        if (currentAccount() && !identityVerified) {
          identity.current.id = ""; identity.current.generation++;
          setAccount(null); setIdentityReady(false); setFeed(null); readRevision.current++;
        } else if (currentAccount()) setFeed(current => ({ key, items: current?.key === key ? current.items : [], error: "Unable to load notifications. Please try again." }));
      } finally { loading = false; if (currentAccount() && queued) { queued = false; void load(); } }
    };
    void load();
    const channel = supabase.channel(`notifications:${key}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications", filter: `recipient_id=eq.${key}` }, () => { void load(); })
      .subscribe();
    // Polling also works when Supabase Realtime is not enabled for this table.
    const interval = window.setInterval(() => { if (document.visibilityState !== "hidden") void load(); }, 15_000);
    const onFocus = () => { void load(); };
    const onVisible = () => { if (document.visibilityState !== "hidden") void load(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      active = false; window.clearInterval(interval); void supabase.removeChannel(channel);
      window.removeEventListener("focus", onFocus); document.removeEventListener("visibilitychange", onVisible);
    };
  }, [supabase, key, revision, customerView]);

  const dismiss = useCallback((ids: string[]) => {
    const next = [...new Set([...dismissedInSession(key), ...dismissedIds, ...ids])].slice(-200);
    setDismissed(current => ({ ...current, [key]: [...new Set([...(current[key] ?? []), ...next])].slice(-200) }));
    try { sessionStorage.setItem(storageKey(key), JSON.stringify(next)); } catch { /* Dismiss still works when browser storage is unavailable. */ }
  }, [key, dismissedIds]);
  useEffect(() => {
    // Staff can have a large unread backlog. Keep only its newest three as
    // popups; the rest stay unread in the bell rather than cycling onto screen.
    if (!customerView && key && pending.length > 3) dismiss(pending.slice(3).map(item => item.notification_id));
  }, [customerView, key, pending, dismiss]);
  const setPopupsEnabled = async (enabled: boolean) => {
    if (!account || identity.current.id !== key || identity.current.changing || savingPreferenceRef.current || account.popupsEnabled === enabled) return;
    const generation = identity.current.generation;
    savingPreferenceRef.current = true; setSavingPreference(true); setPreferenceError(null);
    try {
      const { error } = await supabase.auth.updateUser({ data: { notification_popups_enabled: enabled } });
      if (identity.current.generation !== generation) return;
      if (error) throw error;
      setAccount(current => current?.id === key ? { ...current, popupsEnabled: enabled } : current);
    } catch {
      if (identity.current.generation !== generation) return;
      setPreferenceError({ key, message: "Could not save your notification preference. Please try again." });
    } finally { savingPreferenceRef.current = false; setSavingPreference(false); }
  };
  const markNotificationsRead = async (id?: string) => {
    if (!key || identity.current.id !== key || identity.current.changing || saving.current) return;
    const generation = identity.current.generation;
    const ids = notifications.filter(item => !item.is_read && (!id || item.notification_id === id)).map(item => item.notification_id);
    if (!ids.length) return;
    saving.current = true; setMarkingRead(true);
    try {
      const { error } = await supabase.from("notifications").update({ is_read: true })
        .eq("recipient_id", key).in("notification_id", ids);
      if (identity.current.generation !== generation) return;
      if (error) throw error;
      readRevision.current++;
      setFeed(current => current?.key === key ? { ...current, error: null, items: current.items.map(item => ids.includes(item.notification_id) ? { ...item, is_read: true } : item) } : current);
    } catch {
      if (identity.current.generation !== generation) return;
      setFeed(current => current?.key === key ? { ...current, error: "Could not mark notifications as read. Please try again." } : current);
    } finally { saving.current = false; setMarkingRead(false); }
  };

  return <Context.Provider value={{ user: account?.user ?? null, identityReady, notifications, loading: Boolean(key && feed?.key !== key), error: feed?.key === key ? feed.error : null, refresh, markAllRead: () => markNotificationsRead(), markRead: id => markNotificationsRead(id), markingRead, pauseAlerts,
    popupsEnabled: account?.popupsEnabled ?? true, setPopupsEnabled, savingPreference, preferenceError: preferenceError?.key === key ? preferenceError.message : null }}>
    {children}
    <NotificationAlerts key={`${key}:${identity.current.generation}`} items={!key || paused || account?.popupsEnabled === false ? [] : pending.slice(0, 3)} remaining={customerView ? Math.max(pending.length - 3, 0) : 0}
      onDismiss={id => dismiss([id])} onDismissAll={() => dismiss(pending.map(item => item.notification_id))} />
  </Context.Provider>;
}
