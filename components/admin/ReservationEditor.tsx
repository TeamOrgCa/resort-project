"use client";

import { useEffect, useState } from "react";
import { MAX_GUESTS } from "@/lib/booking/guest-count";
import { previewReservationEdit, type EditDetail, type ReservationEdit } from "@/lib/booking/reservation-edit";
import type { BookingMode } from "@/lib/booking/policy";

const currency = (amount: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(amount);
const localTime = (value: string) => new Date(Date.parse(value) + 8 * 3600000).toISOString().slice(0, 16);
const isoTime = (value: string) => new Date(`${value}:00+08:00`).toISOString();
const inputClass = "mt-1 w-full rounded-lg border border-neutral/20 bg-white px-3 py-2 text-sm text-neutral disabled:bg-neutral/5 disabled:text-neutral/60 focus:outline-none focus:ring-2 focus:ring-primary";
type Draft = Omit<ReservationEdit, "version" | "expectedTotal">;

export default function ReservationEditor({ reservationId, onSaved }: { reservationId: string; onSaved: () => void }) {
  const [detail, setDetail] = useState<EditDetail | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/admin/reservations/${reservationId}`, { cache: "no-store", signal: controller.signal })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.message ?? "Unable to load reservation details.");
        if (controller.signal.aborted) return;
        const d = data as EditDetail;
        setDetail(d);
        setDraft({ bookingMode: d.reservation.booking_mode ?? "day", startDatetime: localTime(d.reservation.start_datetime),
          endDatetime: localTime(d.reservation.end_datetime), adultCount: d.reservation.adult_count, childCount: d.reservation.child_count,
          unitId: d.units.length === 1 && d.units[0].quantity === 1 ? d.units[0].unit_id : null,
          specialRequests: d.reservation.special_requests ?? "", reason: "",
          services: d.services.map(s => ({ serviceId: s.service_id, quantity: s.quantity })) });
      }).catch(e => { if (!controller.signal.aborted) setError(e.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [reservationId, reload]);

  function reloadDetails() { setLoading(true); setError(null); setReload(n => n + 1); }
  if (loading) return <p className="py-8 text-sm text-neutral/60" role="status">Loading reservation and bill…</p>;
  if (!detail || !draft) return <div className="mt-5"><p role="alert" className="text-sm text-red-700">{error}</p><button onClick={reloadDetails} className="mt-3 rounded-lg border px-4 py-2 text-sm">Try again</button></div>;

  const canEdit = detail.canEdit && !detail.lockedReason;
  const canChange = canEdit && detail.canChangeDetails;
  const toEdit = () => ({ ...draft,
    startDatetime: draft.startDatetime === localTime(detail.reservation.start_datetime) ? detail.reservation.start_datetime : isoTime(draft.startDatetime),
    endDatetime: draft.endDatetime === localTime(detail.reservation.end_datetime) ? detail.reservation.end_datetime : isoTime(draft.endDatetime),
    version: detail.version, expectedTotal: 0 });
  let preview: ReturnType<typeof previewReservationEdit> | null = null;
  try { preview = previewReservationEdit(detail.reservation, detail.bill, detail.services, detail.catalogServices, toEdit()); } catch { /* Incomplete datetime input: show a prompt in the bill preview. */ }
  const visibleServices = detail.catalogServices.filter(s => s.is_active || detail.services.some(e => e.service_id === s.service_id));
  // Keep historical selections visible even if their catalog record was removed.
  for (const s of detail.services) if (!visibleServices.some(e => e.service_id === s.service_id)) visibleServices.push({ service_id: s.service_id, name: "Previously booked service", price: Number(s.price_at_time), is_active: false });

  function updateSchedule(start: string, mode: BookingMode) {
    if (!draft) return;
    const hours = { day: 8, night: 12, whole_day: 22 };
    let end = draft.endDatetime;
    if (mode !== "custom" && start && Number.isFinite(Date.parse(`${start}:00+08:00`))) end = localTime(new Date(Date.parse(`${start}:00+08:00`) + hours[mode] * 3600000).toISOString());
    setDraft({ ...draft, startDatetime: start, endDatetime: end, bookingMode: mode });
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!draft || !detail || !preview || !canEdit) return;
    setBusy(true); setError(null); setSuccess(null);
    try {
      const response = await fetch(`/api/admin/reservations/${reservationId}`, { method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...toEdit(), expectedTotal: preview.total }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? "Unable to save reservation.");
      setSuccess(result.message);
      reloadDetails(); onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to save reservation."); }
    finally { setBusy(false); }
  }

  return <form onSubmit={save} className="mt-5 space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl bg-base p-4">
      <div><p className="font-semibold text-neutral">{detail.guest ? `${detail.guest.first_name} ${detail.guest.last_name}` : "Guest"}</p>
        <p className="mt-1 text-sm text-neutral/60">{detail.guest?.email || "No email"} · {detail.guest?.phone_number || "No phone"}</p></div>
      <div className="text-sm text-neutral/70"><p className="font-medium">{detail.reservation.reference_number}</p><p className="capitalize">{detail.reservation.status.replaceAll("_", " ")}</p><p>{detail.reservation.booking_type === "walk_in" ? "Staff-entered booking" : "Online booking"}</p></div>
    </div>
    {success && <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-800">{success}</p>}
    {error && <div role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800"><p>{error}</p><button type="button" disabled={busy} onClick={reloadDetails} className="mt-2 underline">Reload reservation</button></div>}
    {!canEdit && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{detail.lockedReason ?? "Your role has view-only access. An administrator can grant permission to edit reservations."}</p>}
    {canEdit && !canChange && <p className="rounded-lg bg-blue-50 p-3 text-sm text-blue-900">The stay has started. Add services or update notes below. Existing services remain on the bill.</p>}
    <fieldset disabled={busy || !canChange} className="grid gap-4 sm:grid-cols-2">
      <legend className="mb-3 font-semibold text-neutral">Reservation details</legend>
      <label className="text-sm text-neutral/70">Booking package<select className={inputClass} value={draft.bookingMode} onChange={e => {
        const mode = e.target.value as BookingMode;
        const start = mode === "custom" ? draft.startDatetime : `${draft.startDatetime.slice(0, 10)}T${mode === "night" ? "18:00" : "08:00"}`;
        updateSchedule(start, mode);
      }}>
        <option value="day">Day · 8 hours</option><option value="night">Night · 12 hours</option><option value="whole_day">Whole day · 22 hours</option><option value="custom">Custom schedule</option>
      </select></label>
      <label className="text-sm text-neutral/70">Accommodation<select className={inputClass} disabled={!canChange || detail.units.length > 1 || detail.units.some(u => u.quantity !== 1)} value={draft.unitId ?? ""} onChange={e => setDraft({ ...draft, unitId: e.target.value || null })}>
        {!draft.unitId && <option value="">{detail.units.length ? "Multiple accommodations (retained)" : "No accommodation selected"}</option>}
        {detail.catalogUnits.filter(u => (u.is_active && !u.archived_at) || detail.units.some(e => e.unit_id === u.unit_id)).map(u => <option key={u.unit_id} value={u.unit_id} disabled={(!u.is_active || Boolean(u.archived_at)) && u.unit_id !== draft.unitId}>{u.name}{!u.is_active || u.archived_at ? " (archived)" : ""}</option>)}
      </select></label>
      <label className="text-sm text-neutral/70">Arrival<input required type="datetime-local" className={inputClass} value={draft.startDatetime} onChange={e => updateSchedule(e.target.value, draft.bookingMode)} /></label>
      <label className="text-sm text-neutral/70">Departure<input required type="datetime-local" disabled={!canChange || draft.bookingMode !== "custom"} className={inputClass} value={draft.endDatetime} onChange={e => setDraft({ ...draft, endDatetime: e.target.value })} /></label>
      <label className="text-sm text-neutral/70">Adults<input required type="number" min={1} max={MAX_GUESTS} className={inputClass} value={draft.adultCount} onChange={e => setDraft({ ...draft, adultCount: Number(e.target.value) })} /></label>
      <label className="text-sm text-neutral/70">Children<input required type="number" min={0} max={MAX_GUESTS - 1} className={inputClass} value={draft.childCount} onChange={e => setDraft({ ...draft, childCount: Number(e.target.value) })} /></label>
      <p className="text-xs text-neutral/60 sm:col-span-2">Times are in Philippine time. Up to {MAX_GUESTS} guests. Package rates apply to the selected schedule and guest count.</p>
    </fieldset>
    <fieldset disabled={busy || !canEdit} className="space-y-3">
      <legend className="mb-3 font-semibold text-neutral">Services and requests</legend>
      <div className="max-h-60 space-y-2 overflow-y-auto rounded-xl border border-neutral/10 p-3">
        {visibleServices.length === 0 && <p className="text-sm text-neutral/60">No services available.</p>}
        {visibleServices.map(s => {
          const selected = draft.services.find(e => e.serviceId === s.service_id);
          const old = detail.services.find(e => e.service_id === s.service_id);
          const price = Number(old?.price_at_time ?? s.price);
          return <div key={s.service_id} className="flex items-center justify-between gap-3 rounded-lg bg-base/60 p-3">
            <label className="flex cursor-pointer items-start gap-3 text-sm"><input type="checkbox" className="mt-1 accent-primary" checked={Boolean(selected)} disabled={!canEdit || (!canChange && Boolean(old))} onChange={e => setDraft({ ...draft, services: e.target.checked ? [...draft.services, { serviceId: s.service_id, quantity: 1 }] : draft.services.filter(x => x.serviceId !== s.service_id) })} />
              <span><span className="font-medium text-neutral">{s.name}{!s.is_active ? " (archived)" : ""}</span><span className="block text-xs text-neutral/60">{currency(price)} each{old ? " · booked rate" : ""}</span></span></label>
            {selected && <label className="w-20 shrink-0 text-xs text-neutral/60">Quantity<input aria-label={`Quantity for ${s.name}`} type="number" required min={!canChange ? old?.quantity ?? 1 : 1} max={10000} className={inputClass} value={selected.quantity} onChange={e => setDraft({ ...draft, services: draft.services.map(x => x.serviceId === s.service_id ? { ...x, quantity: Number(e.target.value) } : x) })} /></label>}
          </div>;
        })}
      </div>
      <label className="block text-sm text-neutral/70">Special requests / staff notes<textarea maxLength={5000} rows={3} className={inputClass} value={draft.specialRequests} onChange={e => setDraft({ ...draft, specialRequests: e.target.value })} /></label>
    </fieldset>
    <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
      <p className="font-semibold text-neutral">Updated bill</p>
      {preview ? <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
        <dt className="text-neutral/60">Previous total</dt><dd className="text-right">{currency(Number(detail.bill.total_amount))}</dd>
        <dt className="text-neutral/60">Package adjustment</dt><dd className="text-right">{currency(preview.packageDelta)}</dd>
        <dt className="text-neutral/60">Services total</dt><dd className="text-right">{currency(preview.servicesTotal)}</dd>
        <dt className="font-semibold">New total</dt><dd className="text-right font-semibold">{currency(preview.total)}</dd>
        <dt className="text-neutral/60">Already paid</dt><dd className="text-right">{currency(preview.paid)}</dd>
        <dt className="font-semibold text-primary">Amount payable</dt><dd className="text-right font-semibold text-primary">{currency(preview.balance)}</dd>
        {preview.overpaid > 0 && <><dt className="text-amber-800">Overpayment</dt><dd className="text-right text-amber-800">{currency(preview.overpaid)}</dd></>}
      </dl> : <p className="mt-2 text-sm text-neutral/60">Complete the schedule to preview the bill.</p>}
      <p className="mt-3 text-xs text-neutral/60">Payments and issued receipts are retained. The current invoice follows the updated bill. Handle any overpayment in Transactions.</p>
    </div>
    {canEdit && <><label className="block text-sm text-neutral/70">Reason for change <span className="text-red-600">*</span><textarea required maxLength={1000} disabled={busy} rows={2} className={inputClass} placeholder="Example: Guest requested a new date by Messenger, or added services at check-in." value={draft.reason} onChange={e => setDraft({ ...draft, reason: e.target.value })} /></label>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-neutral/10 pt-4"><a href="/admin/transactions" className="text-sm text-primary hover:underline">View transactions and receipts</a><button type="submit" disabled={busy || !preview || preview.total < 0} className="rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-white hover:bg-primary/90 disabled:opacity-50">{busy ? "Saving…" : "Save reservation"}</button></div></>}
  </form>;
}
