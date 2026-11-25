"use client";


import { maintenanceOverlaps } from "@/lib/booking/maintenance";
import { isWindowAvailable } from "./availability";
import { manilaDateKey } from "./manila-date";
import { moveReservationToDate } from "./reservation-edit";
import { BOOKING_LEAD_MESSAGE, isBookingStartAllowed } from "./start-time";
import { useBookingAvailability } from "./use-booking-availability";
import { advanceBookingIssue } from "./advance-window";
import { useEffect, useState } from "react";
import { isPublicSwimmingStartAllowed, type PublicSwimmingCatalog } from "./public-swimming";

export function useGuestRescheduleAvailability(start: string, end: string, month: string, selectedDate: string, enabled: boolean, commercialType?: string, reservationId?: string) {
  const publicBooking = commercialType === "public_swimming";
  const [publicData, setPublicData] = useState<PublicSwimmingCatalog | null>(null), [publicError, setPublicError] = useState<string | null>(null), [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!enabled || !publicBooking) return;
    const controller = new AbortController();
    async function load() {
      try { const r = await fetch(`/api/booking/public-swimming${reservationId ? `?excludeReservationId=${encodeURIComponent(reservationId)}` : ""}`, { cache: "no-store", signal: controller.signal }), data = await r.json();
        if (!r.ok || !data.success) throw new Error("Unable to load public swimming dates.");
        if (!controller.signal.aborted) { setPublicData(data); setPublicError(null); }
      } catch { if (!controller.signal.aborted) setPublicError("Unable to load public swimming dates. Please retry."); }
    }
    void load(); const timer = window.setInterval(load, 15000); window.addEventListener("focus", load);
    return () => { controller.abort(); window.clearInterval(timer); window.removeEventListener("focus", load); };
  }, [enabled, publicBooking, revision, reservationId]);
  const duration = Date.parse(end) - Date.parse(start);
  const months = new Set<string>();
  if (/^\d{4}-\d{2}$/.test(month) && duration > 0) {
    // Load every month a displayed date's full stay could touch, including overnight stays.
    const first = new Date(`${month}-01T00:00:00Z`);
    const lastStart = new Date(first); lastStart.setUTCMonth(lastStart.getUTCMonth() + 1); lastStart.setUTCDate(0);
    // The endpoint already includes the next day for overnight packages.
    const lastEnd = new Date(lastStart.getTime() + Math.max(0, Math.ceil(duration / 86_400_000) - 1) * 86_400_000).toISOString().slice(0, 7);
    for (let i = 0; i < 14 && first.toISOString().slice(0, 7) <= lastEnd; i++) {
      months.add(first.toISOString().slice(0, 7)); first.setUTCMonth(first.getUTCMonth() + 1);
    }
  }
  if (selectedDate && duration > 0) {
    months.add(selectedDate.slice(0, 7));
    if (duration > 86_400_000) {
      const moved = moveReservationToDate({ start_datetime: start, end_datetime: end }, selectedDate);
      months.add(manilaDateKey(moved.endDatetime).slice(0, 7));
    }
  }
  const availability = useBookingAvailability([...months], enabled && !publicBooking);
  // This public response contains windows only. Ignore the guest's unchanged original
  // window for this preview; the submission API checks ownership and conflicts again.
  const reservations = availability.reservations.filter(window =>
    Date.parse(window.start_datetime) !== Date.parse(start) || Date.parse(window.end_datetime) !== Date.parse(end));

  function dateIssue(date: string, requireReady = true): string | null {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T00:00:00Z`)) ||
      new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) return "Choose a valid date.";
    if (!(duration > 0)) return "Unable to determine the original booking times. Contact the resort.";
    if (date === manilaDateKey(start)) return "Current reservation date";
    if (publicBooking) {
      if (publicError) return publicError;
      if (!publicData) return requireReady ? "Loading public swimming dates..." : null;
      const moved = moveReservationToDate({ start_datetime: start, end_datetime: end }, date);
      return publicData.slots.some(s => Date.parse(s.startDatetime) === Date.parse(moved.startDatetime) && Date.parse(s.endDatetime) === Date.parse(moved.endDatetime) && isPublicSwimmingStartAllowed(s.startDatetime)) ? null : "This public swimming session is unavailable within the three-day booking window or its one-hour cutoff has passed.";
    }
    if (availability.maxBookingDate) { const issue = advanceBookingIssue(date, availability.maxBookingDate); if (issue) return issue; }
    const moved = moveReservationToDate({ start_datetime: start, end_datetime: end }, date);
    if (!isBookingStartAllowed(moved.startDatetime, availability.now)) return BOOKING_LEAD_MESSAGE;
    if (!availability.ready) return availability.error ?? (requireReady ? "Loading available dates..." : null);
    if (!isWindowAvailable(moved.startDatetime, moved.endDatetime, reservations)) return "Already reserved for your package or time slot.";
    if (availability.blockedDates.some(block => maintenanceOverlaps(moved.startDatetime, moved.endDatetime, block))) return "Closed for maintenance.";
    return null;
  }

  return { ...availability, ...(publicBooking ? { ready: !!publicData && !publicError, error: publicError, maxBookingDate: publicData?.dates.at(-1), refresh: () => setRevision(n => n + 1) } : {}),
    firstBookingDate: publicBooking ? publicData?.dates[0] : undefined, dateIssue, calendarDateIssue: (date: string) => dateIssue(date, false) };
}
