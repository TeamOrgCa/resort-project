"use client";
import BookingDiscountPanel from "./BookingDiscountPanel";

import ConfirmationDialog from "@/components/ui/ConfirmationDialog";
import { advanceBookingIssue } from "@/lib/booking/advance-window";
import { serviceQuantityLimit } from "@/lib/booking/service-quantity";
import { serviceBilling } from "@/lib/booking/service-billing";

import { useEffect, useRef, useState } from "react";
import { AdminFormSkeleton } from "@/components/admin/AdminSkeletons";
import { MAX_GUESTS } from "@/lib/booking/guest-count";
import { serviceSelectionsChanged, moveReservationToDate, previewReservationEdit, validateEditWindow, type EditDetail, type ReservationEdit } from "@/lib/booking/reservation-edit";
import BookingDateCalendar from "@/components/booking/BookingDateCalendar";
import { useBookingAvailability } from "@/lib/booking/use-booking-availability";
import { useGuestRescheduleAvailability } from "@/lib/booking/use-guest-reschedule-availability";
import { maintenanceOverlaps } from "@/lib/booking/maintenance";
import { isWindowAvailable } from "@/lib/booking/availability";
import { manilaDateKey, manilaDateTimeLocal } from "@/lib/booking/manila-date";
import { reschedulePolicy, RESCHEDULE_POLICY_TEXT, RESCHEDULE_FEE_TEXT } from "@/lib/booking/reschedule-charge-policy";
import { BOOKING_LEAD_MESSAGE, isBookingStartAllowed } from "@/lib/booking/start-time";

const currency = (amount: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(amount);
const localTime = manilaDateTimeLocal;
const inputClass = "admin-field mt-1 w-full";
type Draft = Omit<ReservationEdit, "version" | "expectedTotal">;

const monthsInWindow = (start: string, end: string) => {
  if (!Number.isFinite(Date.parse(start)) || !Number.isFinite(Date.parse(end))) return [];
  const first = new Date(`${start.slice(0, 7)}-01T00:00:00Z`);
  const last = end.slice(0, 7), months: string[] = [];
  for (let i = 0; i < 14 && first.toISOString().slice(0, 7) <= last; i++) {
    months.push(first.toISOString().slice(0, 7)); first.setUTCMonth(first.getUTCMonth() + 1);
  }
  return months;
};

export default function ReservationEditor({ reservationId, onSaved, onBusyChange }: { reservationId: string; onSaved: () => void; onBusyChange?: (busy: boolean) => void }) {
  const [detail, setDetail] = useState<EditDetail | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { onBusyChange?.(busy); }, [busy, onBusyChange]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [lateAcknowledged, setLateAcknowledged] = useState(false);
  const saving = useRef(false);
  const form = useRef<HTMLFormElement>(null);
  const [confirming, setConfirming] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState("");
  const isPublicBooking = detail?.reservation.commercial_type === "public_swimming" && !detail.reservation.room_pricing;
  const privateAvailability = useBookingAvailability([
    calendarMonth, ...monthsInWindow(draft?.startDatetime ?? "", draft?.endDatetime ?? ""),
  ], Boolean(!isPublicBooking && detail?.canEdit && (detail.canChangeDetails || detail.canRescheduleException) && (!detail.lockedReason || detail.canRescheduleException) && !loading), reservationId);
  const publicAvailability = useGuestRescheduleAvailability(detail?.reservation.start_datetime ?? "", detail?.reservation.end_datetime ?? "", calendarMonth, draft?.startDatetime.slice(0, 10) ?? "", !!isPublicBooking && !loading, "public_swimming", reservationId);
  const availability = isPublicBooking ? publicAvailability : privateAvailability;

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/admin/reservations/${reservationId}`, { cache: "no-store", signal: controller.signal })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.message ?? "Unable to load reservation details.");
        if (controller.signal.aborted) return;
        const d = data as EditDetail;
        setDetail(d); setLateAcknowledged(false);
        setCalendarMonth(localTime(d.reservation.start_datetime).slice(0, 7));
        setDraft({ bookingMode: d.reservation.booking_mode ?? "day", startDatetime: localTime(d.reservation.start_datetime),
          endDatetime: localTime(d.reservation.end_datetime), adultCount: d.reservation.commercial_type === "public_swimming" ? d.reservation.adult_count : d.reservation.adult_count + d.reservation.child_count, childCount: d.reservation.commercial_type === "public_swimming" ? d.reservation.child_count : 0,
          unitId: d.units.length === 1 && d.units[0].quantity === 1 ? d.units[0].unit_id : null,
          specialRequests: d.reservation.special_requests ?? "", reason: "",
          services: d.services.map(s => ({ serviceId: s.service_id, quantity: s.quantity })) });
      }).catch(e => { if (!controller.signal.aborted) setError(e.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [reservationId, reload]);

  function reloadDetails() { setLoading(true); setError(null); setReload(n => n + 1); }
  if (loading) return <AdminFormSkeleton label="Loading reservation and bill..." fields={6} />;
  if (!detail || !draft) return <div className="mt-5"><p role="alert" className="text-sm text-red-700">{error}</p><button onClick={reloadDetails} className="mt-3 rounded-xl border px-4 py-2 text-sm">Try again</button></div>;

  const canEdit = detail.canEdit && !detail.lockedReason;
  const canChange = canEdit && detail.canChangeDetails;
  const canReduce = canEdit && (detail.canReduceServices ?? detail.canChangeDetails);
  const canChangeAccommodation = canEdit && (detail.canChangeAccommodation ?? detail.canChangeDetails);
  const noticePolicy = reschedulePolicy(detail.reservation.start_datetime, availability.now);
  const canMove = !detail.reservation.checked_in_at && (canChange || Boolean(detail.canRescheduleException && lateAcknowledged));
  const toEdit = () => ({ ...draft,
    ...moveReservationToDate(detail.reservation, draft.startDatetime.slice(0, 10)),
    bookingMode: detail.reservation.booking_mode ?? "day", lateRescheduleAcknowledged: lateAcknowledged, version: detail.version, expectedTotal: 0 });
  let preview: ReturnType<typeof previewReservationEdit> | null = null, previewError = "";
  try { preview = previewReservationEdit(detail.reservation, detail.bill, detail.services, detail.catalogServices, toEdit(), detail.packageRates, availability.now); } catch (cause) { previewError = cause instanceof Error ? cause.message : "Unable to calculate the bill."; }
  const visibleServices = detail.catalogServices.filter(s => s.is_active || detail.services.some(e => e.service_id === s.service_id));
  // Keep historical selections visible even if their catalog record was removed.
  for (const s of detail.services) if (!visibleServices.some(e => e.service_id === s.service_id)) visibleServices.push({ service_id: s.service_id, name: "Previously booked service", price: Number(s.price_at_time), is_active: false });

  const sameSchedule = (candidate: Pick<Draft, "bookingMode" | "startDatetime" | "endDatetime">) => candidate.bookingMode === detail.reservation.booking_mode
    && candidate.startDatetime === localTime(detail.reservation.start_datetime) && candidate.endDatetime === localTime(detail.reservation.end_datetime);
  const scheduleChanged = !sameSchedule(draft);
  const unsavedDetails = scheduleChanged || draft.adultCount + draft.childCount !== detail.reservation.adult_count + detail.reservation.child_count || draft.unitId !== (detail.units.length === 1 ? detail.units[0].unit_id : null) || draft.specialRequests !== (detail.reservation.special_requests ?? "") || serviceSelectionsChanged(detail.services, draft.services);

  function windowIssue(candidate: Pick<Draft, "bookingMode" | "startDatetime" | "endDatetime">): string | null {
    if (!draft || !detail) return "Load the reservation first.";
    if (isPublicBooking) return candidate.startDatetime.slice(0, 10) === manilaDateKey(detail.reservation.start_datetime) ? null : publicAvailability.dateIssue(candidate.startDatetime.slice(0, 10));
    if (!availability.ready) return availability.error ?? "Loading available dates...";
    try {
      const { startDatetime: start, endDatetime: end } = moveReservationToDate(detail.reservation, candidate.startDatetime.slice(0, 10));
      if (!sameSchedule(candidate)) {
        if (!noticePolicy.allowed && (!lateAcknowledged || !detail.canApproveLateReschedule)) return noticePolicy.blockedReason;
        if (availability.maxBookingDate) { const issue = advanceBookingIssue(manilaDateKey(start), availability.maxBookingDate); if (issue) return issue; }
        if (!isBookingStartAllowed(start, availability.now)) return BOOKING_LEAD_MESSAGE;
        const validation = validateEditWindow({ ...draft, ...candidate, startDatetime: start, endDatetime: end, version: detail.version, expectedTotal: 0 }, detail.packageTimes, detail.reservation);
        if (!validation.valid) return validation.message ?? "Choose a valid schedule.";
      }
      if (!isWindowAvailable(start, end, availability.reservations)) return "Already reserved for this package or time slot.";
      if (availability.blockedDates.some(block => maintenanceOverlaps(start, end, block))) return "Closed for maintenance.";
      return null;
    } catch { return "Complete the arrival and departure times."; }
  }

  const dateIssue = (date: string) => {
    if (isPublicBooking) return date === manilaDateKey(detail.reservation.start_datetime) ? null : publicAvailability.calendarDateIssue(date);
    const moved = moveReservationToDate(detail.reservation, date);
    return windowIssue({ bookingMode: draft.bookingMode, startDatetime: localTime(moved.startDatetime), endDatetime: localTime(moved.endDatetime) });
  };
  const chooseDate = (date: string) => {
    if (dateIssue(date)) return;
    const moved = moveReservationToDate(detail.reservation, date);
    setDraft({ ...draft, startDatetime: localTime(moved.startDatetime), endDatetime: localTime(moved.endDatetime) });
    setError(null);
  };
  const selectedIssue = scheduleChanged ? windowIssue(draft) : null;
  const packageName = ({ day: "Day swimming", night: "Night swimming", whole_day: "Whole-day swimming", custom: "Custom schedule" })[detail.reservation.booking_mode ?? "day"];
  const packageLabel = detail.reservation.booking_mode === "whole_day"
    ? `Whole Day \u2013 ${Number(localTime(detail.reservation.start_datetime).slice(11, 13)) >= 12 ? "Overnight" : "Daytime"}` : packageName;
  const scheduleLabel = (value: string) => Number.isFinite(Date.parse(`${value}:00+08:00`))
    ? new Date(`${value}:00+08:00`).toLocaleString("en-PH", { timeZone: "Asia/Manila", year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "Choose a time";

  async function save() {
    if (!draft || !detail || !preview || (!canEdit && !(canMove && scheduleChanged)) || saving.current) return;
    if (selectedIssue) { setError(selectedIssue); return; }

    saving.current = true;
    setBusy(true); setError(null); setSuccess(null);
    try {
      const response = await fetch(`/api/admin/reservations/${reservationId}`, { method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...toEdit(), expectedTotal: preview.total }) });
      const result = await response.json();
      if (!response.ok) { if (response.status === 409) availability.refresh(); throw new Error(result.message ?? "Unable to save reservation."); }
      setSuccess(result.message);
      form.current?.dispatchEvent(new window.Event("reservation-form-saved", { bubbles: true }));
      reloadDetails(); onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to save reservation."); }
    finally { saving.current = false; setBusy(false); setConfirming(false); }
  }

  return <form ref={form} onSubmit={event => { event.preventDefault(); if (!selectedIssue) setConfirming(true); }} className="mt-5 space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl bg-base p-4">
      <div><p className="font-semibold text-neutral">{detail.guest ? `${detail.guest.first_name} ${detail.guest.last_name}` : "Guest"}</p>
        <p className="mt-1 text-sm text-neutral/60">{detail.guest?.email || "No email"} · {detail.guest?.phone_number || "No phone"}</p></div>
      <div className="text-sm text-neutral/70"><p className="font-medium">{detail.reservation.reference_number}</p><p className="capitalize">{detail.reservation.status.replaceAll("_", " ")}</p><p>{detail.reservation.booking_type === "walk_in" ? "Staff-entered booking" : "Online booking"}</p></div>
    </div>
    {canEdit && detail.canManageDiscount && <div>{unsavedDetails && <p className="mb-2 text-sm text-amber-900">Save the reservation changes first so the discount uses the saved number of guests and package price.</p>}<BookingDiscountPanel reservationId={reservationId} disabled={busy || unsavedDetails} onBusyChange={setBusy} onChanged={() => { reloadDetails(); onSaved(); }} /></div>}
    {success && <p role="status" className="rounded-xl bg-green-50 p-3 text-sm text-green-800">{success}</p>}
    {error && <div role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800"><p>{error}</p><button type="button" disabled={busy} onClick={reloadDetails} className="mt-2 underline">Reload reservation</button></div>}
    {!canEdit && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{detail.lockedReason ?? "Your role has view-only access. An administrator can grant permission to edit reservations."}</p>}
    {canEdit && !canChange && <p className="rounded-xl bg-blue-50 p-3 text-sm text-blue-900">The stay has started. Managers can reduce or remove services while this stay is editable. Review the revised bill and record a reason. Schedule changes stay locked after check-in.</p>}
    {(detail.reservation.commercial_type === "room_accommodation" || detail.reservation.room_pricing) && <a href="/admin/rooms" className="admin-button-secondary inline-flex">Open Room Management</a>}
    {!isPublicBooking && (canChange || detail.canRescheduleException) && <div className="rounded-xl border border-neutral/10 bg-base p-4 text-sm text-neutral">
      <p>{RESCHEDULE_POLICY_TEXT}</p><p className="mt-2">{RESCHEDULE_FEE_TEXT}</p>
      <p className="mt-2">Original swimming date: {manilaDateKey(detail.reservation.start_datetime)}. Standard notice deadline: {noticePolicy.deadline} (Philippines).</p>
      {!noticePolicy.allowed && <p role="alert" className="mt-2 text-amber-900">{noticePolicy.blockedReason}</p>}
      {!noticePolicy.allowed && detail.canApproveLateReschedule && detail.canRescheduleException && <label className="mt-3 flex items-start gap-3"><input type="checkbox" disabled={busy} checked={lateAcknowledged} onChange={event => setLateAcknowledged(event.target.checked)} className="mt-0.5 h-5 w-5 shrink-0" />I authorize this late reschedule exception after reviewing the guest request. The notice fee will be added; I will document the reason below.</label>}
    </div>}
    <fieldset disabled={busy || !canMove} className="grid gap-4 sm:grid-cols-2">
      <legend className="mb-3 font-semibold text-neutral">Reservation details</legend>
      <div className="mx-auto w-full min-w-0 max-w-md space-y-3 sm:col-span-2">
        {(canChange || detail.canRescheduleException) && !availability.ready && !availability.error && <p role="status" className="text-sm text-neutral/60">Loading available dates...</p>}
        {(canChange || detail.canRescheduleException) && availability.error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{availability.error}<button type="button" onClick={availability.refresh} className="ml-2 min-h-11 underline">Retry availability</button></p>}
        <BookingDateCalendar value={draft.startDatetime.slice(0, 10)} onChange={chooseDate} onMonthChange={setCalendarMonth}
          minDate={manilaDateKey(new Date(availability.now))} maxDate={detail.reservation.commercial_type === "room_accommodation" ? availability.maxBookingDate : undefined} minimumDateReason="Past date" title="Arrival date"
          disabled={busy || !canMove} getUnavailableReason={canMove ? dateIssue : undefined}
          footnote="Choose a date available for the booked package. Its original times and duration stay fixed. The current reservation is excluded from conflicts; other bookings and maintenance closures are checked." />
      </div>
      <label className="min-w-0 text-sm text-neutral/70">Booked package<input readOnly className={inputClass} value={packageLabel} />
        <span className="mt-1 block text-xs text-neutral/60">Package and time slot cannot be changed.</span>
      </label>

      <dl className="grid min-w-0 gap-2 rounded-xl bg-base p-3 text-sm text-neutral sm:col-span-2 sm:grid-cols-2">
        <div><dt className="text-xs text-neutral/60">Arrival (Philippines)</dt><dd>{scheduleLabel(draft.startDatetime)}</dd></div>
        <div><dt className="text-xs text-neutral/60">Departure (Philippines)</dt><dd>{scheduleLabel(draft.endDatetime)}</dd></div>
      </dl>
      {selectedIssue && <p role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900 sm:col-span-2">{selectedIssue} Choose another date or time slot.</p>}
      </fieldset>
      {(detail.reservation.commercial_type === "room_accommodation" || detail.reservation.room_pricing) && <label className="text-sm text-neutral/70">Accommodation type<select className={inputClass} disabled={busy || !canChangeAccommodation || detail.units.length > 1 || detail.units.some(u => u.quantity !== 1)} value={draft.unitId ?? ""} onChange={e => setDraft({ ...draft, unitId: e.target.value || null })}>
        {!draft.unitId && <option value="">{detail.units.length ? "Multiple accommodations (retained)" : "No accommodation selected"}</option>}
        {detail.catalogUnits.filter(u => (u.is_active && !u.archived_at) || detail.units.some(e => e.unit_id === u.unit_id)).map(u => <option key={u.unit_id} value={u.unit_id} disabled={(!u.is_active || Boolean(u.archived_at)) && u.unit_id !== draft.unitId}>{u.name}{!u.is_active || u.archived_at ? " (archived)" : ""}</option>)}
      </select></label>}
      {(detail.reservation.commercial_type ?? "private_swimming") === "private_swimming" && !detail.reservation.room_pricing && <p className="text-sm text-neutral/70">All cottages are included with private swimming.</p>}
    <fieldset disabled={busy || !canEdit} className="grid gap-4 sm:grid-cols-2">
      <legend className="mb-3 font-semibold text-neutral">Guest counts</legend>
      <label className="text-sm text-neutral/70">{isPublicBooking ? "Adults" : "Number of guests"}<input aria-label={isPublicBooking ? "Adults" : "Number of guests"} disabled={!canEdit} required type="number" min={1} max={MAX_GUESTS} className={inputClass} value={draft.adultCount} onChange={e => setDraft({ ...draft, adultCount: Number(e.target.value), childCount: isPublicBooking ? draft.childCount : 0 })} /></label>
      {isPublicBooking && <label className="text-sm text-neutral/70">Children<input aria-label="Children" disabled={!canEdit} required type="number" min={0} max={MAX_GUESTS - draft.adultCount} className={inputClass} value={draft.childCount} onChange={e => setDraft({ ...draft, childCount: Number(e.target.value) })} /></label>}
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
          const billing = serviceBilling(old?.billing_type ?? s.billing_type, serviceQuantityLimit(s.max_quantity, old?.quantity));
          return <div key={s.service_id} className="flex items-center justify-between gap-3 rounded-xl bg-base/60 p-3">
            <label className="flex cursor-pointer items-start gap-3 text-sm"><input type="checkbox" className="mt-1 accent-primary" checked={Boolean(selected)} disabled={!canEdit || (!canReduce && Boolean(old))} onChange={e => setDraft({ ...draft, services: e.target.checked ? [...draft.services, { serviceId: s.service_id, quantity: 1 }] : draft.services.filter(x => x.serviceId !== s.service_id) })} />
              <span><span className="font-medium text-neutral">{s.name}{!s.is_active ? " (archived)" : ""}</span><span className="block text-xs text-neutral/60">{currency(price)} {billing.rateLabel}{old ? " · booked rate" : ""}</span></span></label>
            {selected && billing.hasQuantity && <label className="w-20 shrink-0 text-xs text-neutral/60">{billing.inputLabel}<input aria-label={`${billing.inputLabel} for ${s.name}`} type="number" required min={!canReduce ? old?.quantity ?? 1 : 1} max={serviceQuantityLimit(s.max_quantity, old?.quantity)} className={inputClass} value={selected.quantity} onChange={e => setDraft({ ...draft, services: draft.services.map(x => x.serviceId === s.service_id ? { ...x, quantity: Number(e.target.value) } : x) })} /></label>}
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
        <dt className="text-neutral/60">Reschedule notice fee</dt><dd className="text-right">{currency(preview.rescheduleFee)}</dd>
        <dt className="text-neutral/60">Services total</dt><dd className="text-right">{currency(preview.servicesTotal)}</dd>
        {preview.hasDiscount && <><dt>Discount applied</dt><dd className="text-right">-{currency(preview.discountAmount)}</dd></>}
        <dt className="font-semibold">New total</dt><dd className="text-right font-semibold">{currency(preview.total)}</dd>
        <dt className="text-neutral/60">Already paid</dt><dd className="text-right">{currency(preview.paid)}</dd>
        <dt className="font-semibold text-primary">Amount payable</dt><dd className="text-right font-semibold text-primary">{currency(preview.balance)}</dd>
        {preview.overpaid > 0 && <><dt className="text-amber-800">Overpayment</dt><dd className="text-right text-amber-800">{currency(preview.overpaid)}</dd></>}
      </dl> : <p className="mt-2 text-sm text-neutral/60">{previewError || "Complete the schedule to preview the bill."}</p>}
      <p className="mt-3 text-xs text-neutral/60">Payments and issued receipts are retained. The current invoice follows the updated bill. Handle any overpayment in Transactions.</p>
    </div>
    {(canEdit || detail.canRescheduleException) && <><label className="block text-sm text-neutral/70">Reason for change <span className="text-red-600">*</span><textarea required maxLength={1000} disabled={busy} rows={2} className={inputClass} placeholder="Example: Guest requested a new date by Messenger, or added services at check-in." value={draft.reason} onChange={e => setDraft({ ...draft, reason: e.target.value })} /></label>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-neutral/10 pt-4"><a href="/admin/transactions" className="text-sm text-primary hover:underline">View transactions and receipts</a><button type="submit" disabled={busy || !preview || preview.total < 0 || Boolean(selectedIssue) || (!canEdit && !scheduleChanged)} className="rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-white hover:bg-primary/90 disabled:opacity-50">{busy ? "Saving…" : "Save reservation"}</button></div></>}
    <ConfirmationDialog isOpen={confirming} title="Confirm reservation changes" message={`Save the revised services and accommodation for ${detail.reservation.reference_number}?\nPrevious total: ${currency(Number(detail.bill.total_amount))}\nNew total: ${currency(preview?.total ?? 0)}\nRemaining balance: ${currency(preview?.balance ?? 0)}${preview?.overpaid ? `\nExcess paid: ${currency(preview.overpaid)}. Use the refund workflow; no money is refunded automatically.` : ""}\nThe updated invoice and audit log will record this change.`} confirmText="Confirm changes" isConfirming={busy} onConfirm={() => void save()} onCancel={() => setConfirming(false)} />
  </form>;
}
