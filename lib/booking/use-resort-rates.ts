"use client";
import { useEffect, useState } from "react";
import type { PublicSwimmingType } from "./public-swimming";
import type { RoomClass } from "@/lib/rooms/types";

export type ResortRateCatalog = {
  publicSwimming: Pick<PublicSwimmingType, "type_id" | "mode" | "name" | "start_time" | "end_time" | "end_day_offset" | "adult_rate" | "child_rate">[];
  rooms: Pick<RoomClass, "classification_id" | "name" | "code" | "included_capacity" | "maximum_capacity" | "rate_3_hours" | "rate_12_hours" | "additional_guest_rate" | "extension_hourly_rate">[];
};

export function useResortRates() {
  const [rates, setRates] = useState<ResortRateCatalog | null>(null), [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch("/api/resort-rates", { cache: "no-store", signal: controller.signal });
        const result = await response.json();
        if (!response.ok || !result.success || !Array.isArray(result.publicSwimming) || !Array.isArray(result.rooms)) throw new Error("Unable to load current prices.");
        if (!controller.signal.aborted) { setRates(result); setError(null); }
      } catch { if (!controller.signal.aborted) setError("Current prices are temporarily unavailable. Please contact the resort or try again later."); }
    }
    void load();
    const refresh = () => { void load(); };
    window.addEventListener("focus", refresh);
    return () => { controller.abort(); window.removeEventListener("focus", refresh); };
  }, []);
  return { rates, error };
}
