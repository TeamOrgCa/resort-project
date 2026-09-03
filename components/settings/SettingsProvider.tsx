"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { SettingsMap, SettingsUpdate } from "@/lib/settings/types";
import { createClient } from "@/lib/supabase/client";

const CACHE_KEY = "marville-settings-cache";
const CHANGE_KEY = "marville-settings-changed";
const CACHE_MAX_AGE = 5 * 60 * 1000;

interface SettingsContextValue {
  settings: SettingsMap;
  isLoading: boolean;
  isRefreshing: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  save: (updates: SettingsUpdate[]) => Promise<void>;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

const readCache = (): SettingsMap | null => {
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "null") as { savedAt?: number; settings?: SettingsMap } | null;
    if (!cached?.settings || !cached.savedAt) return null;
    return Date.now() - cached.savedAt < CACHE_MAX_AGE ? cached.settings : null;
  } catch {
    return null;
  }
};

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<SettingsMap>(() => readCache() ?? {});
  const [isLoading, setIsLoading] = useState(() => Object.keys(settings).length === 0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    setIsRefreshing(true);
    try {
      const response = await fetch("/api/admin/settings", { cache: "no-store" });
      const result = (await response.json()) as { success?: boolean; settings?: SettingsMap; message?: string };
      if (!response.ok || !result.success || !result.settings) throw new Error(result.message ?? "Unable to load settings.");
      setSettings(result.settings);
      localStorage.setItem(CACHE_KEY, JSON.stringify({ savedAt: Date.now(), settings: result.settings }));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load settings.");
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  const save = async (updates: SettingsUpdate[]) => {
    const response = await fetch("/api/admin/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ updates }),
    });
    const result = (await response.json()) as { success?: boolean; settings?: SettingsMap; message?: string };
    if (!response.ok || !result.success || !result.settings) throw new Error(result.message ?? "Unable to save settings.");
    setSettings(result.settings);
    localStorage.setItem(CACHE_KEY, JSON.stringify({ savedAt: Date.now(), settings: result.settings }));
    localStorage.setItem(CHANGE_KEY, String(Date.now()));
    setError(null);
  };

  useEffect(() => {
    void refresh();
    const supabase = createClient();
    const channel = supabase
      .channel("business-settings-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "business_settings" }, () => void refresh())
      .subscribe();
    const onStorage = (event: StorageEvent) => {
      if (event.key === CHANGE_KEY) void refresh();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("storage", onStorage);
      void supabase.removeChannel(channel);
    };
  }, []);

  return <SettingsContext.Provider value={{ settings, isLoading, isRefreshing, error, refresh, save }}>{children}</SettingsContext.Provider>;
}

export function useSettings() {
  const context = useContext(SettingsContext);
  if (!context) throw new Error("useSettings must be used inside SettingsProvider");
  return context;
}