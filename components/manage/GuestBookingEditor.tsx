"use client";

import { useEffect, useRef, useState } from "react";
import LoadingState from "@/components/ui/LoadingState";
import { guestEditRestriction, parseGuestBookingEdit, type GuestEditDetail, type GuestEditResult } from "@/lib/booking/guest-edit";
import { previewReservationEdit } from "@/lib/booking/reservation-edit";
import { isValidGuestCounts, MAX_GUESTS } from "@/lib/booking/guest-count";

const currency = (amount: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(amount);
const inputClass = "mt-1 min-h-11 w-full min-w-0 rounded-lg border border-neutral/20 bg-white px-3 py-2 text-[16px] text-black disabled:bg-neutral/5 disabled:text-neutral/60 focus:outline-none focus:ring-2 focus:ring-primary";

export default function GuestBookingEditor({ reservationId, onSaved, onBusyChange }: {
  reservationId: string; onSaved: (result: GuestEditResult) => void; onBusyChange: (busy: boolean) => void;
}) {
  const [detail, setDetail] = useState<GuestEditDetail | null>(null);
  const [counts, setCounts] = useState({ adultCount: 1, childCount: 0 });
  const [services, setServices] = useState<{ serviceId: string; quantity: number }[]>([]);
  const [newService, setNewService] = useState(""), [quantity, setQuantity] = useState("1");
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null), [reload, setReload] = useState(0), [stale, setStale] = useState(false);
  const saving = useRef(false);
  const endpoint = `/api/reservations/edit?reservationId=${encodeURIComponent(reservationId)}`;
  useEffect(() => {
    const controller = new AbortController();
    fetch(endpoint, { cache: "no-store", signal: controller.signal }).then(async response => {
      const data = await response.json(); if (!response.ok) throw new Error(data.message ?? "Unable to load your booking.");
      if (controller.signal.aborted) return;
      if (!data.reservation || !data.bill || !Array.isArray(data.services) || !Array.isArray(data.catalogServices) || !data.packageRates) throw new Error("Booking details are incomplete. Please retry.");
      const next = data as GuestEditDetail;
      setDetail(next); setCounts({ adultCount: next.reservation.adult_count, childCount: next.reservation.child_count });
      setServices(next.services.map(service => ({ serviceId: service.service_id, quantity: service.quantity })));
      setNewService(""); setQuantity("1"); setStale(false); setError(null);
    }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Unable to load your booking."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [endpoint, reload]);
  const refresh = () => { setLoading(true); setDetail(null); setError(null); setReload(value => value + 1); };
  if (loading) return <LoadingState title="Loading your booking and payment records..." description="Checking your guests, services and remaining balance." />;
  if (!detail) return <div><p role="alert" className="rounded-xl border-2 border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</p><button type="button" onClick={refresh} className="mt-3 min-h-11 rounded-lg border px-4 py-2">Retry booking details</button></div>;
  const r = detail.reservation;
  let preview: ReturnType<typeof previewReservationEdit> | null = null, previewError: string | null = null;
  if (isValidGuestCounts(counts.adultCount, counts.childCount)) {
    try { preview = previewReservationEdit(r, detail.bill, detail.services, detail.catalogServices,
      { ...counts, services, bookingMode: r.booking_mode, startDatetime: r.start_datetime, endDatetime: r.end_datetime }, detail.packageRates); }
    catch (cause) { previewError = cause instanceof Error ? cause.message : "Unable to calculate the bill."; }
  }
  const choices = detail.catalogServices.filter(service => service.is_active || detail.services.some(old => old.service_id === service.service_id));
  const unchanged = counts.adultCount === r.adult_count && counts.childCount === r.child_count && services.length === detail.services.length
    && services.every(service => detail.services.some(old => old.service_id === service.serviceId && old.quantity === service.quantity));
  const edit = preview ? parseGuestBookingEdit({ ...counts, services, expectedTotal: preview.total, version: detail.version }) : null;
  const restriction = edit ? guestEditRestriction(detail, edit) : null;

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!detail || !edit || saving.current || unchanged || stale) return;
    if (restriction) { setError(restriction); return; }
    saving.current = true; setBusy(true); onBusyChange(true); setError(null);
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(edit) });
      const data = await response.json();
      if (!response.ok || !data.success) { if (response.status === 409) setStale(true); throw new Error(data.message ?? "Unable to save your booking changes."); }
      onSaved(data as GuestEditResult);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to save your booking changes."); }
    finally { saving.current = false; setBusy(false); onBusyChange(false); }
  }

  return <form onSubmit={event => void save(event)} className="min-w-0 space-y-5">
    <div><h3 className="text-lg font-semibold text-neutral">Edit booking</h3><p className="mt-1 text-sm text-neutral/70">Review the recalculated bill before saving. Your package and schedule stay fixed; use Reschedule to request another date.</p></div>
    {detail.lockedReason && <p role="alert" className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">{detail.lockedReason}</p>}
    <fieldset disabled={busy || Boolean(detail.lockedReason) || stale} className="min-w-0 space-y-5">
      <section className="rounded-xl border border-neutral/10 bg-base p-4">
        <h4 className="font-semibold text-neutral">Number of guests</h4>
        <p className="mt-1 text-sm text-neutral/65">At least one adult; up to {MAX_GUESTS} guests. Guest counts can be changed before check-in. Any extra-person charges will be recalculated using your booked rates.</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-sm font-medium text-neutral">Adults<input type="number" aria-label="Adults" min={1} max={MAX_GUESTS} step={1} required disabled={!detail.canChangeGuests} className={inputClass} value={counts.adultCount} onChange={event => setCounts({ ...counts, adultCount: Number(event.target.value) })} /></label>
          <label className="text-sm font-medium text-neutral">Children<input type="number" aria-label="Children" min={0} max={MAX_GUESTS - 1} step={1} required disabled={!detail.canChangeGuests} className={inputClass} value={counts.childCount} onChange={event => setCounts({ ...counts, childCount: Number(event.target.value) })} /></label>
        </div>
        {!isValidGuestCounts(counts.adultCount, counts.childCount) && <p role="alert" className="mt-3 text-sm font-medium text-red-700">Include at least one adult and no more than {MAX_GUESTS} guests in total.</p>}
      </section>
      <section className="space-y-3"><h4 className="font-semibold text-neutral">Services</h4>
        <p className="text-sm text-neutral/65">{detail.canReduceServices ? "You can add, reduce or remove services while a balance remains and before check-in." : "You can add services or increase quantities. Reductions after full payment or check-in require resort staff."}</p>
        {!services.length && <p className="rounded-xl bg-base p-4 text-sm text-neutral/65">No services selected. Services are optional.</p>}
        {services.map(service => {
          const original = detail.services.find(old => old.service_id === service.serviceId);
          const listed = choices.find(choice => choice.service_id === service.serviceId);
          const minimum = !detail.canReduceServices && original ? original.quantity : 1;
          return <div key={service.serviceId} className="grid min-w-0 gap-3 rounded-xl border border-neutral/10 p-4 sm:grid-cols-[minmax(0,1fr)_7rem_auto] sm:items-center">
            <div className="min-w-0"><p className="break-words font-medium text-neutral">{listed?.name ?? "Booked service"}</p><p className="mt-1 text-sm text-neutral/65">{currency(Number(original?.price_at_time ?? listed?.price ?? 0))} each</p></div>
            <input type="number" aria-label={`Quantity for ${listed?.name ?? "Booked service"}`} min={minimum} max={10000} step={1} required className={inputClass} value={service.quantity} onChange={event => setServices(current => current.map(item => item.serviceId === service.serviceId ? { ...item, quantity: Number(event.target.value) } : item))} />
            <button type="button" aria-label={`Remove ${listed?.name ?? "Booked service"}`} disabled={Boolean(original) && !detail.canReduceServices} onClick={() => setServices(current => current.filter(item => item.serviceId !== service.serviceId))} className="min-h-11 rounded-lg border border-red-200 px-3 py-2 text-sm font-medium text-red-700 disabled:opacity-40">Remove</button>
          </div>;
        })}
        <div className="grid gap-3 rounded-xl bg-base p-4 sm:grid-cols-[minmax(0,1fr)_6rem_auto] sm:items-end">
          <label className="text-sm text-neutral">Add a service<select aria-label="New service" className={inputClass} value={newService} onChange={event => setNewService(event.target.value)}><option value="">Select a service</option>{choices.filter(choice => choice.is_active && !services.some(service => service.serviceId === choice.service_id)).map(choice => <option key={choice.service_id} value={choice.service_id}>{choice.name} ({currency(Number(choice.price))})</option>)}</select></label>
          <label className="text-sm text-neutral">Quantity<input aria-label="New service quantity" type="number" min={1} max={10000} step={1} value={quantity} onChange={event => setQuantity(event.target.value)} className={inputClass} /></label>
          <button type="button" onClick={() => {
            if (!newService || !Number.isSafeInteger(Number(quantity)) || Number(quantity) < 1 || Number(quantity) > 10000) { setError("Choose a service and a whole-number quantity from 1 to 10000."); return; }
            setServices(current => [...current, { serviceId: newService, quantity: Number(quantity) }]); setNewService(""); setQuantity("1"); setError(null);
          }} className="min-h-11 rounded-lg border border-primary/30 px-4 py-2 text-sm font-semibold text-primary">Add Service</button>
        </div>
      </section>
    </fieldset>
    {preview && <section aria-label="Updated bill preview" className="rounded-xl border-2 border-primary/20 bg-primary/5 p-4 text-sm text-neutral">
      <h4 className="font-semibold">Updated bill preview</h4><dl className="mt-3 grid grid-cols-[1fr_auto] gap-3"><dt>New total</dt><dd className="font-semibold">{currency(preview.total)}</dd><dt>Net verified payments</dt><dd>{currency(preview.paid)}</dd><dt>Remaining balance</dt><dd className="font-semibold text-primary">{currency(preview.balance)}</dd></dl>
      {preview.overpaid > 0 && <p className="mt-3">Excess paid: {currency(preview.overpaid)}. After saving, request an excess refund in the Refunds tab. Money is not refunded automatically.</p>}
    </section>}
    {(error || previewError || restriction) && <p role="alert" className="rounded-xl border-2 border-red-200 bg-red-50 p-4 text-sm text-red-800">{error ?? previewError ?? restriction}</p>}
    {stale && <button type="button" disabled={busy} onClick={refresh} className="min-h-11 rounded-lg border px-4 py-2 text-sm font-semibold">Reload booking and bill</button>}
    <button type="submit" disabled={busy || stale || !edit || unchanged || Boolean(restriction)} className="min-h-12 w-full rounded-xl bg-primary px-5 py-3 font-semibold text-white hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto">{busy ? "Saving..." : "Save Booking Changes"}</button>
  </form>;
}
