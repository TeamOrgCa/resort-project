"use client";
import { useEffect, useState } from "react";
import { parsePackageRateSchedule, type PackageRateSchedule } from "@/lib/booking/package-rates";

export function usePackageRates(enabled = true) {
  const [schedule, setSchedule] = useState<PackageRateSchedule | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    fetch("/api/package-rates", { cache: "no-store", signal: controller.signal }).then(async response => {
      const result = await response.json();
      const parsed = parsePackageRateSchedule(result.schedule);
      if (!response.ok || !parsed) throw new Error(result.message ?? "Unable to load package rates.");
      if (!controller.signal.aborted) { setSchedule(parsed); setError(null); }
    }).catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Unable to load package rates."); });
    return () => controller.abort();
  }, [enabled]);
  return { schedule, error };
}
