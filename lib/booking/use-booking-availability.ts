"use client";

import { useCallback, useEffect, useState } from "react";
import type { ReservedWindow } from "./availability";

export type BlockedDateRange = { start_date: string; end_date: string };
type Availability = { key: string; reservations: ReservedWindow[]; blockedDates: BlockedDateRange[]; error: string | null };

export function useBookingAvailability(months: string[], enabled: boolean, excludeReservationId?: string) {
  const key = [...new Set(months.filter(month => /^\d{4}-\d{2}$/.test(month)))].sort().join(",");
  const requestKey = `${key}|${excludeReservationId ?? ""}`;
  const [snapshot, setSnapshot] = useState<Availability | null>(null);
  const [revision, setRevision] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const refresh = useCallback(() => { setSnapshot(null); setRevision(value => value + 1); }, []);

  useEffect(() => {
    if (!enabled || !key) return;
    let active = true;
    let controller: AbortController | null = null;
    const load = async () => {
      controller?.abort();
      const current = new AbortController(); controller = current;
      try {
        const results = await Promise.all(key.split(",").map(async month => {
          const exclude = excludeReservationId ? `&excludeReservationId=${encodeURIComponent(excludeReservationId)}` : "";
          const response = await fetch(`/api/booking/availability?month=${month}${exclude}`, { cache: "no-store", signal: current.signal });
          const body = await response.json();
          if (!response.ok || !Array.isArray(body.reservations) || !Array.isArray(body.blockedDates)) {
            throw new Error("Unable to load available dates. Please retry.");
          }
          return body as { reservations: ReservedWindow[]; blockedDates: BlockedDateRange[] };
        }));
        if (active && !current.signal.aborted) {
          setSnapshot({ key: requestKey, reservations: results.flatMap(result => result.reservations), blockedDates: results.flatMap(result => result.blockedDates), error: null });
          setNow(Date.now());
        }
      } catch {
        if (active && !current.signal.aborted) setSnapshot({ key: requestKey, reservations: [], blockedDates: [], error: "Unable to load available dates. Please retry." });
      }
    };
    void load();
    const interval = window.setInterval(() => { setNow(Date.now()); void load(); }, 15_000);
    window.addEventListener("focus", load);
    return () => { active = false; controller?.abort(); window.clearInterval(interval); window.removeEventListener("focus", load); };
  }, [key, requestKey, excludeReservationId, enabled, revision]);

  const ready = enabled && snapshot?.key === requestKey && !snapshot.error;
  return {
    ready: Boolean(ready), error: snapshot?.key === requestKey ? snapshot.error : null,
    reservations: ready ? snapshot.reservations : [], blockedDates: ready ? snapshot.blockedDates : [],
    now, refresh,
  };
}
