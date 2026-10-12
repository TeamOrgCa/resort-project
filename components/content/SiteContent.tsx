"use client";

import Image, { type ImageProps } from "next/image";
import { createContext, useContext, useEffect, useState, type ReactNode, type ComponentProps } from "react";
import { isContentImageUrl, publicContentDefaults, socialUrl } from "@/lib/settings/public-content";
import type { SettingsMap } from "@/lib/settings/types";

const SiteContentContext = createContext<SettingsMap>(publicContentDefaults);

export function SiteContentProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<SettingsMap>(publicContentDefaults);
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const response = await fetch("/api/site-content", { cache: "no-store" });
        const result = await response.json();
        if (active && response.ok && result.success && result.settings) setSettings({ ...publicContentDefaults, ...result.settings });
      } catch { /* Keep the last known content when the network is unavailable. */ }
    };
    const onStorage = (event: StorageEvent) => { if (event.key === "marville-settings-changed") void refresh(); };
    void refresh();
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 60_000);
    window.addEventListener("focus", refresh);
    window.addEventListener("site-content-changed", refresh);
    window.addEventListener("storage", onStorage);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("site-content-changed", refresh);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  return <SiteContentContext.Provider value={settings}>{children}</SiteContentContext.Provider>;
}

export function useSiteContent() { return useContext(SiteContentContext); }

export function contentText(settings: SettingsMap, key: string): string {
  const value = settings[key] ?? publicContentDefaults[key];
  return typeof value === "string" ? value : String(publicContentDefaults[key] ?? "");
}

export function SiteText({ contentKey }: { contentKey: string }) {
  const settings = useSiteContent();
  return <span className="whitespace-pre-line">{contentText(settings, contentKey)}</span>;
}

export function SiteImage({ contentKey, alt, ...props }: Omit<ImageProps, "src"> & { contentKey: string }) {
  const settings = useSiteContent();
  const source = contentText(settings, contentKey);
  const fallback = String(publicContentDefaults[contentKey] ?? "/website_photo.jpg");
  return <Image {...props} alt={alt} src={isContentImageUrl(source) ? source : fallback} unoptimized={source.startsWith("https://")} />;
}

export function SiteContact({ field }: { field: "name" | "address" | "phone" | "email" }) {
  const settings = useSiteContent();
  if (field === "phone") {
    const value = settings["resort.contact_numbers"];
    return <>{Array.isArray(value) ? value.join(" / ") : publicContentDefaults["resort.contact_numbers"].toString()}</>;
  }
  return <span className="whitespace-pre-line">{contentText(settings, `resort.${field}`)}</span>;
}

export function SiteSocialLink({ platform, children, ...props }: Omit<ComponentProps<"a">, "href"> & { platform: "facebook" | "instagram" | "tiktok" }) {
  const settings = useSiteContent();
  const links = settings["resort.social_links"];
  const record = links && typeof links === "object" && !Array.isArray(links) ? links : {};
  const href = socialUrl(platform, record[platform]);
  if (!href) return null;
  return <a {...props} href={href}>{children}</a>;
}
