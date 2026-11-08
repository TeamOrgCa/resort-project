"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { DEFAULT_CALENDAR_COLORS, readCalendarColors, type CalendarColors, type CalendarColorKey } from "@/lib/booking/calendar-appearance";

type Preferences = { key: string; colors: CalendarColors; viewed: string[] };
function read(key: string): Preferences {
  try {
    const saved = JSON.parse(window.localStorage.getItem(key) ?? "{}");
    return { key, colors: readCalendarColors(saved.colors), viewed: Array.isArray(saved.viewed) ? saved.viewed.filter((id: unknown): id is string => typeof id === "string") : [] };
  } catch { return { key, colors: { ...DEFAULT_CALENDAR_COLORS }, viewed: [] }; }
}

export function useCalendarAppearance() {
  const [preferences, setPreferences] = useState<Preferences | null>(null);
  useEffect(() => {
    let active = true;
    void createClient().auth.getUser().then(({ data: { user } }) => {
      if (active && user) setPreferences(read(`marville:calendar:${user.id}`));
    }).catch(() => {});
    const sync = (event: StorageEvent) => {
      if (event.key?.startsWith("marville:calendar:")) setPreferences(current => current?.key === event.key ? read(current.key) : current);
    };
    window.addEventListener("storage", sync);
    return () => { active = false; window.removeEventListener("storage", sync); };
  }, []);
  const save = (next: Preferences) => {
    setPreferences(next);
    try { window.localStorage.setItem(next.key, JSON.stringify({ colors: next.colors, viewed: next.viewed })); } catch { /* Preferences still work for this visit. */ }
  };
  return {
    colors: preferences?.colors ?? DEFAULT_CALENDAR_COLORS,
    ready: Boolean(preferences),
    isUnviewed: (id: string) => Boolean(preferences && !preferences.viewed.includes(id)),
    markViewed: (id: string) => {
      if (preferences && !preferences.viewed.includes(id)) save({ ...preferences, viewed: [...new Set([...read(preferences.key).viewed, ...preferences.viewed, id])] });
    },
    setColor: (key: CalendarColorKey, color: string) => {
      if (preferences && /^#[0-9a-f]{6}$/i.test(color)) save({ ...preferences, colors: { ...preferences.colors, [key]: color } });
    },
    resetColors: () => { if (preferences) save({ ...preferences, colors: { ...DEFAULT_CALENDAR_COLORS } }); },
  };
}
