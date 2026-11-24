"use client";
import { useEffect, useState } from "react";
import BookingDateCalendar from "@/components/booking/BookingDateCalendar";
import { formatManilaDate, formatManilaDateTime, formatManilaTime } from "@/lib/booking/manila-date";
import type { PublicSwimmingCatalog, PublicSwimmingSlot, PublicSwimmingType } from "@/lib/booking/public-swimming";
import { publicSwimmingWindow } from "@/lib/booking/public-swimming";
import { isBookingStartAllowed } from "@/lib/booking/start-time";

export default function PublicSwimmingSelection({ onChoose }: { onChoose: (type: PublicSwimmingType, slot: PublicSwimmingSlot) => void }) {
  const [catalog, setCatalog] = useState<PublicSwimmingCatalog | null>(null), [error, setError] = useState(""), [loading, setLoading] = useState(true);
  const [month, setMonth] = useState(""), [date, setDate] = useState(""), [typeId, setTypeId] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const r = await fetch("/api/booking/public-swimming", { cache: "no-store", signal: controller.signal }), data = await r.json();
        if (!r.ok || !data.success) throw new Error(data.message || "Unable to load public swimming.");
        if (controller.signal.aborted) return;
        setCatalog(data); setError("");
        const firstMonth = data.dates[0]?.slice(0, 7), lastMonth = data.dates.at(-1)?.slice(0, 7);
        if (firstMonth) setMonth(m => !m || m < firstMonth || m > lastMonth ? firstMonth : m);
      } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Unable to load availability."); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    }
    void load(); const timer = window.setInterval(load, 15000); window.addEventListener("focus", load);
    return () => { controller.abort(); window.clearInterval(timer); window.removeEventListener("focus", load); };
  }, [retry]);
  const available = catalog?.slots.filter(s => s.date === date && isBookingStartAllowed(s.startDatetime)) ?? [];
  const slot = available.find(s => s.typeId === typeId), type = catalog?.types.find(t => t.type_id === typeId);
  const dateSlots = (day: string) => catalog?.slots.filter(s => s.date === day && isBookingStartAllowed(s.startDatetime)) ?? [];
  const firstDate = catalog?.dates[0], lastDate = catalog?.dates.at(-1);
  return <div className="space-y-6">
    {!loading && !error && firstDate && <section data-booking-guide="public-times" className="rounded-2xl bg-primary/5 p-4 sm:p-5">
      <h2 className="mb-3 font-bold text-neutral">Select Booking Mode</h2>
      <div className="grid gap-3 sm:grid-cols-2">{catalog?.types.map(t => {
        const enabled = catalog.slots.some(s => s.typeId === t.type_id && isBookingStartAllowed(s.startDatetime));
        const window = publicSwimmingWindow(firstDate, t);
        return <button key={t.type_id} type="button" aria-pressed={typeId === t.type_id} disabled={!enabled} onClick={() => {
          setTypeId(t.type_id);
          if (date && !available.some(s => s.typeId === t.type_id)) setDate("");
        }} className={`rounded-xl border px-4 py-3 text-left text-neutral transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${typeId === t.type_id ? "border-primary bg-white" : "border-neutral/20 bg-white/60 hover:border-primary/40"} disabled:cursor-not-allowed disabled:opacity-40`}>
          <span className="block font-semibold">{t.name}</span>
          <span className="block text-xs text-neutral/70">{formatManilaTime(window.startDatetime)} – {formatManilaTime(window.endDatetime)}</span>
          <span className="mt-2 block text-xs text-neutral/70">Adult ₱{Number(t.adult_rate)} · Child ₱{Number(t.child_rate)}</span>
        </button>;
      })}</div>
    </section>}
    <div className="grid gap-8 lg:grid-cols-3">
    <div className="min-w-0 space-y-6 lg:col-span-2">
      {loading ? <section className="rounded-3xl bg-white p-4 shadow-xl sm:p-8"><h2 className="text-xl font-bold sm:text-3xl">Select Public Swimming Date</h2><div role="status" className="mt-5 h-80 animate-pulse rounded-2xl bg-base" aria-label="Loading public swimming dates" /></section> : error ? <section className="rounded-3xl bg-white p-5 shadow-xl sm:p-8"><p role="alert" className="text-red-700">{error}</p><button type="button" className="mt-4 min-h-11 rounded-lg border border-neutral/20 px-4 py-2 text-sm font-semibold text-neutral hover:bg-base" onClick={() => { setLoading(true); setRetry(n => n + 1); }}>Retry availability</button></section> : !firstDate ? <p role="status" className="rounded-3xl bg-white p-5 shadow-xl sm:p-8">No public sessions are currently available. Please contact the resort.</p> : <div data-booking-guide="dates-calendar">
        <BookingDateCalendar value={date} onChange={setDate} appearance="customer"
          title="Select Booking Date" description={`Showing dates available for ${type?.name ?? "Public Swimming"}, ${formatManilaDate(firstDate)} – ${formatManilaDate(lastDate!)}. Unavailable dates are disabled.`}
          minDate={firstDate} maxDate={lastDate} visibleMonth={month} onMonthChange={setMonth}
          getUnavailableReason={day => dateSlots(day).some(s => !typeId || s.typeId === typeId) ? null : type ? `${type.name} is unavailable on this date` : "No public swimming sessions available"}
          getDateHint={day => {
            const modes = dateSlots(day).map(s => catalog?.types.find(t => t.type_id === s.typeId)?.mode);
            return modes.includes("day") && modes.includes("night") ? "Day · Night" : modes.includes("day") ? "Day only" : "Night only";
          }}
          isPartiallyAvailable={day => new Set(dateSlots(day).map(s => s.typeId)).size < (catalog?.types.length ?? 0)}
          emptyLabel="Select an available booking date."
          footnote="Book within three consecutive dates from the next available public date. All times are Philippine time. Private bookings and maintenance block the affected sessions."
          className="min-w-0 rounded-3xl bg-white p-4 shadow-xl sm:p-8" />
      </div>}
    </div>
    <div className="min-w-0 lg:col-span-1">
      <aside data-booking-guide="date-summary" className="booking-summary rounded-3xl bg-white p-4 shadow-xl sm:p-8 lg:sticky lg:top-28">
        <h3 className="mb-6 text-2xl font-bold text-neutral">Booking Summary</h3>
        <dl className="mb-6 space-y-4">
          <div><dt className="text-sm text-neutral/70">Check-in</dt><dd className="text-lg font-semibold text-neutral">{slot ? formatManilaDateTime(slot.startDatetime) : "Select date and time"}</dd></div>
          <div><dt className="text-sm text-neutral/70">Check-out</dt><dd className="text-lg font-semibold text-neutral">{slot ? formatManilaDateTime(slot.endDatetime) : "Select date and time"}</dd></div>
          <div><dt className="text-sm text-neutral/70">Mode</dt><dd className="text-lg font-semibold text-neutral">{type?.name ?? "Select Day or Night"}</dd></div>
        </dl>
        <div className="mb-6 border-t border-neutral/10 pt-6">
          <h4 className="mb-3 font-semibold text-neutral">Rate Information</h4>
          {type ? <dl className="space-y-2 text-sm"><div className="flex justify-between gap-3"><dt className="text-neutral/70">Adult entrance</dt><dd className="font-semibold text-primary">₱{Number(type.adult_rate).toLocaleString("en-PH")}</dd></div><div className="flex justify-between gap-3"><dt className="text-neutral/70">Child entrance</dt><dd className="font-semibold text-primary">₱{Number(type.child_rate).toLocaleString("en-PH")}</dd></div></dl> : <p className="text-sm text-neutral/70">Select Day or Night to see the entrance rates.</p>}
          <p className="mt-2 text-xs text-neutral/60">Guest counts and optional services are added in the next step.</p>
        </div>
        <button type="button" data-booking-guide="dates-continue" disabled={!slot || !type || loading || !!error} className="w-full rounded-full bg-primary px-6 py-4 font-semibold text-base transition-all hover:bg-primary/90 sm:hover:scale-105 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100" onClick={() => { if (slot && type && isBookingStartAllowed(slot.startDatetime)) onChoose(type, slot); else setError("This session is no longer available. Refresh the dates."); }}>Continue to Reservation</button>
        <p className="mt-4 text-center text-xs text-neutral/60">Full payment is required within 30 minutes after saving. Submitted payments awaiting review preserve the booking.</p>
      </aside>
    </div>
    </div>
  </div>;
}
