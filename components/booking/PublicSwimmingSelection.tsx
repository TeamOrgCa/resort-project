"use client";
import { useEffect, useState } from "react";
import BookingDateCalendar from "@/components/booking/BookingDateCalendar";
import { formatManilaDate, formatManilaDateTime, formatManilaTime, manilaDateKey } from "@/lib/booking/manila-date";
import { isPublicSwimmingStartAllowed, publicSwimmingAvailabilityLabel, publicSwimmingDateLabel, publicSwimmingSessionLabel, publicSwimmingWindow,
  type PublicSwimmingCatalog, type PublicSwimmingSlot, type PublicSwimmingType } from "@/lib/booking/public-swimming";

const compactStatus: Record<string, string> = {
  "Partially Available": "Partial", "Unavailable — Private Reservation": "Private",
  "Unavailable — Maintenance": "Maintenance", "Not Yet Open for Booking": "Not yet open",
  "Booking Cutoff Passed": "Cutoff passed", "Past Date": "Past date", "Fully Booked": "Full",
  "Unavailable — Session Disabled": "Disabled",
};
export default function PublicSwimmingSelection({ onChoose }: { onChoose: (type: PublicSwimmingType, slot: PublicSwimmingSlot) => void }) {
  const [catalog, setCatalog] = useState<PublicSwimmingCatalog | null>(null), [error, setError] = useState(""), [loading, setLoading] = useState(true);
  const [month, setMonth] = useState(() => manilaDateKey(new Date()).slice(0, 7)), [date, setDate] = useState(""), [typeId, setTypeId] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let revision = 0;
    async function load() {
      const request = ++revision;
      try {
        const r = await fetch(`/api/booking/public-swimming?month=${month}`, { cache: "no-store", signal: controller.signal }), data = await r.json();
        if (!r.ok || !data.success) throw new Error(data.message || "Unable to load public swimming.");
        if (controller.signal.aborted || request !== revision) return;
        setCatalog(data); setError("");
      } catch (e) { if (!controller.signal.aborted && request === revision) setError(e instanceof Error ? e.message : "Unable to load availability."); }
      finally { if (!controller.signal.aborted && request === revision) setLoading(false); }
    }
    void load(); const timer = window.setInterval(load, 15000); window.addEventListener("focus", load);
    return () => { controller.abort(); window.clearInterval(timer); window.removeEventListener("focus", load); };
  }, [retry, month]);
  const dateSessions = (day: string) => catalog?.sessions.filter(s => s.date === day) ?? [];
  const selectedSessions = dateSessions(date);
  const selected = selectedSessions.find(s => s.typeId === typeId);
  const slot = selected?.eligibility === "eligible" && selected.availability === "available" && selected.remainingCapacity > 0
    && isPublicSwimmingStartAllowed(selected.startDatetime, Date.now(), selected.cutoffAt) ? selected : undefined;
  const type = catalog?.types.find(t => t.type_id === typeId);
  const changeMonth = (next: string) => { setMonth(next); setDate(""); setLoading(true); };
  return <div className="space-y-6">
    {catalog && !error && <section data-booking-guide="public-times" className="rounded-2xl bg-primary/5 p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-bold text-neutral">Select Booking Mode</h2>
        <p aria-live="polite" className="text-sm text-neutral/70">{date ? `${formatManilaDate(date)} · ${publicSwimmingDateLabel(selectedSessions)}` : "Select a date to view session availability."}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">{catalog.types.map(t => {
        const window = publicSwimmingWindow(date || catalog.today, t), session = selectedSessions.find(s => s.typeId === t.type_id);
        return <button key={t.type_id} type="button" data-public-session={t.mode} aria-pressed={typeId === t.type_id} onClick={() => setTypeId(t.type_id)}
          className={`rounded-xl border px-4 py-3 text-left text-neutral transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${typeId === t.type_id ? "border-primary bg-white" : "border-neutral/20 bg-white/60 hover:border-primary/40"}`}>
          <span className="block font-semibold">{t.name}</span>
          <span className="block text-sm text-neutral/70">{formatManilaTime(window.startDatetime)} – {formatManilaTime(window.endDatetime)}</span>
          <span className="mt-2 block text-sm text-neutral/70">Adult ₱{Number(t.adult_rate)} · Child ₱{Number(t.child_rate)}</span>
          {date && <span className="mt-3 block border-t border-neutral/10 pt-3 text-sm" aria-live="polite">
            <span className="block font-semibold">{session ? publicSwimmingSessionLabel(session) : "Loading availability"}</span>
            {session?.accessMode && <span className="block">{session.accessMode === "public_only" ? "Public Only" : session.accessMode === "private_only" ? "Private Only" : "Flexible"}</span>}
            {session && <>
              <span className="mt-1 block">Remaining capacity: {session.availability === "available" && t.max_guests === null ? "No configured limit" : session.remainingCapacity}</span>
              <span className="mt-1 block text-neutral/70">Booking cutoff: {formatManilaTime(session.cutoffAt ?? new Date(Date.parse(session.startDatetime) - 3600000).toISOString())}</span>
              {session.eligibility === "not_open" && <span className="mt-2 block text-neutral/70">Reservations open {formatManilaDateTime(session.opensAt)}. Tentative availability: {publicSwimmingAvailabilityLabel(session.availability)}. {session.accessMode !== "public_only" ? "Private reservations may still be made." : "This session is reserved for public swimming."}</span>}
              {session.eligibility !== "eligible" && session.eligibility !== "not_open" && session.availability !== "available" && <span className="mt-1 block">{publicSwimmingAvailabilityLabel(session.availability)}</span>}
            </>}
          </span>}
        </button>;
      })}</div>
    </section>}
    <div className="grid gap-8 lg:grid-cols-3">
      <div className="min-w-0 space-y-6 lg:col-span-2">
        {loading && !catalog ? <section className="rounded-3xl bg-white p-4 shadow-xl sm:p-8"><h2 className="text-xl font-bold sm:text-3xl">Select Public Swimming Date</h2><div role="status" className="mt-5 h-80 animate-pulse rounded-2xl bg-base" aria-label="Loading public swimming dates" /></section> : error ? <section className="rounded-3xl bg-white p-5 shadow-xl sm:p-8"><p role="alert" className="text-red-700">{error}</p><button type="button" className="mt-4 min-h-11 rounded-lg border border-neutral/20 px-4 py-2 text-sm font-semibold text-neutral hover:bg-base" onClick={() => { setLoading(true); setRetry(n => n + 1); }}>Retry availability</button></section> : catalog && <>
          <div data-booking-guide="dates-calendar">
            <BookingDateCalendar value={date} onChange={setDate} appearance="customer" allowUnavailableSelection
              title="Select Booking Date" description="Browse any month. Select a date to inspect each session's access mode, booking opening date and capacity (Philippine time)."
              visibleMonth={month} onMonthChange={changeMonth} disabled={loading}
              getUnavailableReason={day => {
                const label = publicSwimmingDateLabel(dateSessions(day));
                return label === "Available" || label === "Partially Available" ? null : label;
              }}
              getDateHint={day => { const label = publicSwimmingDateLabel(dateSessions(day)); return compactStatus[label] ?? label; }}
              isPartiallyAvailable={day => publicSwimmingDateLabel(dateSessions(day)) === "Partially Available"}
              emptyLabel="Select a date to inspect the sessions."
              footnote="Public opening dates follow each session's access mode and configured booking window. Future Flexible availability is tentative. Active payment holds allocate the pool or public capacity."
              className="min-w-0 rounded-3xl bg-white p-4 shadow-xl sm:p-8" />
          </div>
          {!catalog.types.length && <p role="status" className="rounded-xl bg-white p-5">No public swimming sessions are configured. Please contact the resort.</p>}
        </>}
      </div>
      <div className="min-w-0 lg:col-span-1">
        <aside data-booking-guide="date-summary" className="booking-summary rounded-3xl bg-white p-4 shadow-xl sm:p-8 lg:sticky lg:top-28">
          <h3 className="mb-6 text-2xl font-bold text-neutral">Booking Summary</h3>
          <dl className="mb-6 space-y-4">
            <div><dt className="text-sm text-neutral/70">Check-in</dt><dd className="text-lg font-semibold text-neutral">{selected ? formatManilaDateTime(selected.startDatetime) : "Select date and time"}</dd></div>
            <div><dt className="text-sm text-neutral/70">Check-out</dt><dd className="text-lg font-semibold text-neutral">{selected ? formatManilaDateTime(selected.endDatetime) : "Select date and time"}</dd></div>
            <div><dt className="text-sm text-neutral/70">Mode</dt><dd className="text-lg font-semibold text-neutral">{type?.name ?? "Select Day or Night"}</dd></div>
          </dl>
          <div className="mb-6 border-t border-neutral/10 pt-6">
            <h4 className="mb-3 font-semibold text-neutral">Rate Information</h4>
            {type ? <dl className="space-y-2 text-sm"><div className="flex justify-between gap-3"><dt className="text-neutral/70">Adult entrance</dt><dd className="font-semibold text-primary">₱{Number(type.adult_rate).toLocaleString("en-PH")}</dd></div><div className="flex justify-between gap-3"><dt className="text-neutral/70">Child entrance</dt><dd className="font-semibold text-primary">₱{Number(type.child_rate).toLocaleString("en-PH")}</dd></div></dl> : <p className="text-sm text-neutral/70">Select Day or Night to see the entrance rates.</p>}
            <p className="mt-2 text-xs text-neutral/60">Guest counts and optional services are added in the next step.</p>
          </div>
          <button type="button" data-booking-guide="dates-continue" disabled={!slot || !type || loading || !!error} className="w-full rounded-full bg-primary px-6 py-4 font-semibold text-base transition-all hover:bg-primary/90 sm:hover:scale-105 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100" onClick={() => { if (slot && type && isPublicSwimmingStartAllowed(slot.startDatetime, Date.now(), slot.cutoffAt)) onChoose(type, slot); else setError("This session is no longer available. Refresh the dates."); }}>Continue to Reservation</button>
          <p className="mt-4 text-center text-xs text-neutral/60">Full payment is required within 30 minutes after saving. Submitted payments awaiting review preserve the booking.</p>
        </aside>
      </div>
    </div>
  </div>;
}
