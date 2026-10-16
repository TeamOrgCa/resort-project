"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import NotificationAlerts from "./NotificationAlerts";
import type { User } from "@supabase/supabase-js";

export type NotificationItem = {
  notification_id: string; title: string; message: string | null; action_url: string | null;
  is_read: boolean; created_at: string;
};
type Feed = { key: string; items: NotificationItem[]; error: string | null };
type Center = {
  notifications: NotificationItem[]; loading: boolean; error: string | null;
  refresh: () => void; markAllRead: () => Promise<void>; markingRead: boolean;
  pauseAlerts: () => () => void;
  popupsEnabled: boolean; setPopupsEnabled: (enabled: boolean) => Promise<void>;
  savingPreference: boolean; preferenceError: string | null;
};
const Context = createContext<Center | null>(null);
export const useNotificationCenter = () => useContext(Context);
const storageKey = (key: string) => `marville:notification-popups:${key}`;
const accountFromUser = (user: User | null) => user ? { id: user.id, popupsEnabled: user.user_metadata?.notification_popups_enabled !== false } : null;
function dismissedInSession(key: string): string[] {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(storageKey(key)) ?? "[]");
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string").slice(-200) : [];
  } catch { return []; }
}

export default function NotificationCenter({ children }: { children: ReactNode }) {
  const supabase = useMemo(() => createClient(), []);
  const [account, setAccount] = useState<ReturnType<typeof accountFromUser>>(null);
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
  const key = account?.id ?? "";
  const notifications = useMemo(() => key && feed?.key === key ? feed.items : [], [key, feed]);
  const dismissedIds = useMemo(() => new Set(key ? [...dismissedInSession(key), ...(dismissed[key] ?? [])] : []), [key, dismissed]);
  const pending = notifications.filter(item => !item.is_read && !dismissedIds.has(item.notification_id));
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  const pauseAlerts = useCallback(() => {
    setPaused(value => value + 1);
    return () => setPaused(value => Math.max(value - 1, 0));
  }, []);

  useEffect(() => {
    let active = true, authChanged = false;
    void supabase.auth.getUser().then(({ data: { user } }) => { if (active && !authChanged) setAccount(accountFromUser(user)); }).catch(() => {});
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      authChanged = true;
      if (active) setAccount(accountFromUser(session?.user ?? null));
    });
    return () => { active = false; subscription.unsubscribe(); };
  }, [supabase]);

  useEffect(() => {
    if (!key) return;
    let active = true, loading = false, queued = false;
    const load = async () => {
      if (loading) { queued = true; return; }
      loading = true;
      const revisionAtStart = readRevision.current;
      try {
        // Recipient filtering and the existing row policies enforce account/role access.
        const { data, error } = await supabase.from("notifications")
          .select("notification_id, title, message, action_url, is_read, created_at")
          .eq("recipient_id", key)
          .order("created_at", { ascending: false }).limit(30);
        if (error) throw error;
        if (active && revisionAtStart === readRevision.current) setFeed({ key, items: (data ?? []) as NotificationItem[], error: null });
        else if (active) queued = true;
      } catch {
        if (active) setFeed(current => ({ key, items: current?.key === key ? current.items : [], error: "Unable to load notifications. Please try again." }));
      } finally { loading = false; if (active && queued) { queued = false; void load(); } }
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
  }, [supabase, key, revision]);

  const dismiss = (ids: string[]) => {
    const next = [...new Set([...dismissedIds, ...ids])].slice(-200);
    setDismissed(current => ({ ...current, [key]: next }));
    try { sessionStorage.setItem(storageKey(key), JSON.stringify(next)); } catch { /* Dismiss still works when browser storage is unavailable. */ }
  };
  const setPopupsEnabled = async (enabled: boolean) => {
    if (!account || savingPreferenceRef.current || account.popupsEnabled === enabled) return;
    savingPreferenceRef.current = true; setSavingPreference(true); setPreferenceError(null);
    try {
      const { error } = await supabase.auth.updateUser({ data: { notification_popups_enabled: enabled } });
      if (error) throw error;
      setAccount(current => current?.id === key ? { ...current, popupsEnabled: enabled } : current);
    } catch {
      setPreferenceError({ key, message: "Could not save your notification preference. Please try again." });
    } finally { savingPreferenceRef.current = false; setSavingPreference(false); }
  };
  const markAllRead = async () => {
    if (!key || saving.current) return;
    const ids = notifications.filter(item => !item.is_read).map(item => item.notification_id);
    if (!ids.length) return;
    saving.current = true; setMarkingRead(true);
    try {
      const { error } = await supabase.from("notifications").update({ is_read: true })
        .eq("recipient_id", key).in("notification_id", ids);
      if (error) throw error;
      readRevision.current++;
      setFeed(current => current?.key === key ? { ...current, error: null, items: current.items.map(item => ids.includes(item.notification_id) ? { ...item, is_read: true } : item) } : current);
    } catch {
      setFeed(current => current?.key === key ? { ...current, error: "Could not mark notifications as read. Please try again." } : current);
    } finally { saving.current = false; setMarkingRead(false); }
  };

  return <Context.Provider value={{ notifications, loading: Boolean(key && feed?.key !== key), error: feed?.key === key ? feed.error : null, refresh, markAllRead, markingRead, pauseAlerts,
    popupsEnabled: account?.popupsEnabled ?? true, setPopupsEnabled, savingPreference, preferenceError: preferenceError?.key === key ? preferenceError.message : null }}>
    {children}
    <NotificationAlerts items={paused || account?.popupsEnabled === false ? [] : pending.slice(0, 3)} remaining={Math.max(pending.length - 3, 0)}
      onDismiss={id => dismiss([id])} onDismissAll={() => dismiss(pending.map(item => item.notification_id))} />
  </Context.Provider>;
}
