"use client";

import ConfirmationDialog from "@/components/ui/ConfirmationDialog";
import GuestCountInput from "@/components/ui/GuestCountInput";
import { serviceQuantityLimit } from "@/lib/booking/service-quantity";
import { serviceBilling } from "@/lib/booking/service-billing";

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
  const [unitId, setUnitId] = useState<string | null | undefined>(undefined);
  const [confirming, setConfirming] = useState(false);
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
      setUnitId(next.units?.length === 1 ? next.units[0].unit_id : next.units ? null : undefined);
      setDetail(next); setCounts({ adultCount: next.reservation.adult_count + next.reservation.child_count, childCount: 0 });
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
  const isReservation = r.status?.toLowerCase() === "confirmed";
  const recordName = isReservation ? "reservation" : "booking";
  let preview: ReturnType<typeof previewReservationEdit> | null = null, previewError: string | null = null;
  if (isValidGuestCounts(counts.adultCount, counts.childCount)) {
    try { preview = previewReservationEdit(r, detail.bill, detail.services, detail.catalogServices,
      { ...counts, services, bookingMode: r.booking_mode, startDatetime: r.start_datetime, endDatetime: r.end_datetime }, detail.packageRates); }
    catch (cause) { previewError = cause instanceof Error ? cause.message : "Unable to calculate the bill."; }
  }
  const choices = detail.catalogServices.filter(service => service.is_active || detail.services.some(old => old.service_id === service.service_id));
  const unchanged = (unitId === (detail.units?.length === 1 ? detail.units[0].unit_id : detail.units ? null : undefined)) && counts.adultCount + counts.childCount === r.adult_count + r.child_count && services.length === detail.services.length
    && services.every(service => detail.services.some(old => old.service_id === service.serviceId && old.quantity === service.quantity));
  const edit = preview ? parseGuestBookingEdit({ ...counts, ...(unitId !== undefined ? { unitId } : {}), services, expectedTotal: preview.total, version: detail.version }) : null;
  const restriction = edit ? guestEditRestriction(detail, edit) : null;

  async function save() {
    if (!detail || !edit || saving.current || unchanged || stale) return;
    if (restriction) { setError(restriction); return; }
    saving.current = true; setBusy(true); onBusyChange(true); setError(null);
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(edit) });
      const data = await response.json();
      if (!response.ok || !data.success) { if (response.status === 409) setStale(true); throw new Error(data.message ?? "Unable to save your booking changes."); }
      onSaved(data as GuestEditResult);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to save your booking changes."); }
    finally { saving.current = false; setBusy(false); onBusyChange(false); setConfirming(false); }
  }

  return <form onSubmit={event => { event.preventDefault(); if (!restriction && !unchanged) setConfirming(true); }} className="min-w-0 space-y-5">
    <div><h3 className="text-lg font-semibold text-neutral">Edit {recordName}</h3><p className="mt-1 text-sm text-neutral/70">Review the recalculated bill before saving. Your package and schedule stay fixed; use Reschedule to request another date.</p></div>
    {detail.lockedReason && <p role="alert" className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">{detail.lockedReason}</p>}
    <fieldset disabled={busy || Boolean(detail.lockedReason) || stale} className="min-w-0 space-y-5">
      {detail.catalogUnits && <label className="block text-sm font-medium text-neutral">Accommodation type<select aria-label="Accommodation type" className={inputClass} value={unitId ?? ""} disabled={!detail.canChangeAccommodation} onChange={event => setUnitId(event.target.value || null)}><option value="" disabled>Select accommodation</option>{detail.catalogUnits.filter(unit => unit.unit_id === unitId || unit.is_active && !unit.archived_at).map(unit => <option key={unit.unit_id} value={unit.unit_id} disabled={!unit.is_active || Boolean(unit.archived_at)}>{unit.name}</option>)}</select><span className="mt-1 block text-xs text-neutral/65">Change before check-in. The private package rate stays the same.</span></label>}
      <section className="rounded-xl border border-neutral/10 bg-base p-4">
        <h4 className="font-semibold text-neutral">Number of guests</h4>
        <p className="mt-1 text-sm text-neutral/65">At least one guest; up to {MAX_GUESTS} guests. Guest counts can be changed before check-in. Any extra-person charges will be recalculated using your booked rates.</p>
        <label className="mt-3 block text-sm font-medium text-neutral">Number of guests<GuestCountInput aria-label="Number of guests" min={1} max={MAX_GUESTS} step={1} required disabled={!detail.canChangeGuests} className={inputClass} value={counts.adultCount} onValueChange={adultCount => setCounts({ adultCount, childCount: 0 })} /></label>
        {!isValidGuestCounts(counts.adultCount, counts.childCount) && <p role="alert" className="mt-3 text-sm font-medium text-red-700">Include at least one guest and no more than {MAX_GUESTS} guests in total.</p>}
      </section>
      <section className="space-y-3"><h4 className="font-semibold text-neutral">Services</h4>
        <p className="text-sm text-neutral/65">{detail.canReduceServices ? "You can add, reduce or remove services while a balance remains and before check-in." : "You can add services or increase quantities. Reductions after full payment or check-in require resort staff."}</p>
        {!services.length && <p className="rounded-xl bg-base p-4 text-sm text-neutral/65">No services selected. Services are optional.</p>}
        {services.map(service => {
          const original = detail.services.find(old => old.service_id === service.serviceId);
          const listed = choices.find(choice => choice.service_id === service.serviceId);
          const minimum = !detail.canReduceServices && original ? original.quantity : 1;
          const billing = serviceBilling(original?.billing_type ?? listed?.billing_type, serviceQuantityLimit(listed?.max_quantity, original?.quantity));
          return <div key={service.serviceId} className="grid min-w-0 gap-3 rounded-xl border border-neutral/10 p-4 sm:grid-cols-[minmax(0,1fr)_7rem_auto] sm:items-center">
            <div className="min-w-0"><p className="break-words font-medium text-neutral">{listed?.name ?? "Booked service"}</p><p className="mt-1 text-sm text-neutral/65">{currency(Number(original?.price_at_time ?? listed?.price ?? 0))} {billing.rateLabel}</p></div>
            {billing.hasQuantity && <input type="number" aria-label={`${billing.inputLabel} for ${listed?.name ?? "Booked service"}`} min={minimum} max={serviceQuantityLimit(listed?.max_quantity, original?.quantity)} step={1} required className={inputClass} value={service.quantity} onChange={event => setServices(current => current.map(item => item.serviceId === service.serviceId ? { ...item, quantity: Number(event.target.value) } : item))} />}
            <button type="button" aria-label={`Remove ${listed?.name ?? "Booked service"}`} disabled={Boolean(original) && !detail.canReduceServices} onClick={() => setServices(current => current.filter(item => item.serviceId !== service.serviceId))} className="min-h-11 rounded-lg border border-red-200 px-3 py-2 text-sm font-medium text-red-700 disabled:opacity-40">Remove</button>
          </div>;
        })}
        <div className="grid gap-3 rounded-xl bg-base p-4 sm:grid-cols-[minmax(0,1fr)_6rem_auto] sm:items-end">
          <label className="text-sm text-neutral">Add a service<select aria-label="New service" className={inputClass} value={newService} onChange={event => { setNewService(event.target.value); setQuantity("1"); }}><option value="">Select a service</option>{choices.filter(choice => choice.is_active && !services.some(service => service.serviceId === choice.service_id)).map(choice => <option key={choice.service_id} value={choice.service_id}>{choice.name} ({currency(Number(choice.price))} {serviceBilling(choice.billing_type).rateLabel})</option>)}</select></label>
          {serviceBilling(choices.find(choice => choice.service_id === newService)?.billing_type, choices.find(choice => choice.service_id === newService)?.max_quantity).hasQuantity && <label className="text-sm text-neutral">{serviceBilling(choices.find(choice => choice.service_id === newService)?.billing_type).inputLabel}<input aria-label={choices.find(choice => choice.service_id === newService)?.billing_type === "duration" ? "New service hours" : choices.find(choice => choice.service_id === newService)?.billing_type === "person" ? "Number of Guests for new service" : choices.find(choice => choice.service_id === newService)?.billing_type === "fixed" ? "Number of Bookings for new service" : "New service quantity"} type="number" min={1} max={serviceQuantityLimit(choices.find(choice => choice.service_id === newService)?.max_quantity, detail.services.find(old => old.service_id === newService)?.quantity)} step={1} value={quantity} onChange={event => setQuantity(event.target.value)} className={inputClass} /></label>}
          <button type="button" onClick={() => {
            if (!newService || !Number.isSafeInteger(Number(quantity)) || Number(quantity) < 1 || Number(quantity) > serviceQuantityLimit(choices.find(choice => choice.service_id === newService)?.max_quantity, detail.services.find(old => old.service_id === newService)?.quantity)) { setError("Choose a service and a whole-number quantity within its maximum per booking."); return; }
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
    {stale && <button type="button" disabled={busy} onClick={refresh} className="min-h-11 rounded-lg border px-4 py-2 text-sm font-semibold">Reload {recordName} and bill</button>}
    <button type="submit" disabled={busy || stale || !edit || unchanged || Boolean(restriction)} className="min-h-12 w-full rounded-xl bg-primary px-5 py-3 font-semibold text-white hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto">{busy ? "Saving..." : isReservation ? "Save Reservation Changes" : "Save Booking Changes"}</button>
    <ConfirmationDialog isOpen={confirming} title={`Confirm ${recordName} changes`} message={`Save your accommodation, guest counts and services?\nNew total: ${currency(preview?.total ?? 0)}\nRemaining balance: ${currency(preview?.balance ?? 0)}${preview?.overpaid ? `\nExcess paid: ${currency(preview.overpaid)}. Refunds must be requested separately.` : ""}`} confirmText="Confirm changes" isConfirming={busy} onConfirm={() => void save()} onCancel={() => setConfirming(false)} />
  </form>;
}
