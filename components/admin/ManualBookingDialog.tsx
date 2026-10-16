"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { buildBookingWindow, toIsoLocalDay, type BookingMode, type WholeDayVariant } from "@/lib/booking/policy";
import { usePackageRates } from "@/lib/booking/use-package-rates";
import { useBookingAvailability } from "@/lib/booking/use-booking-availability";
import { computeBookingPricing } from "@/lib/booking/pricing";
import { isValidGuestCounts } from "@/lib/booking/guest-count";
import { isWindowAvailable } from "@/lib/booking/availability";
import { isBookingStartAllowed } from "@/lib/booking/start-time";
import { manilaDateKey } from "@/lib/booking/manila-date";
import BookingDateCalendar from "@/components/booking/BookingDateCalendar";

type Unit = { unit_id: string; name: string; capacity: number };
type Service = { service_id: string; name: string; description: string | null; price: number };
type PackageMode = Exclude<BookingMode, "custom">;
type ManualBookingDialogProps = { isOpen: boolean; onClose: () => void; onCreated: () => void };
type BookingForm = { bookingDate: string; bookingMode: PackageMode; wholeDayVariant: WholeDayVariant; adultCount: string; childCount: string; unitId: string; specialRequests: string };
const money = (value: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(value);
const fieldClass = "admin-field mt-1 w-full";
const validQuantity = (value: string) => Number.isSafeInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 10000;

export default function ManualBookingDialog({ isOpen, onClose, onCreated }: ManualBookingDialogProps) {
  const { schedule: packageSchedule, error: packageRatesError } = usePackageRates(isOpen);
  const [units, setUnits] = useState<Unit[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [serviceQuantities, setServiceQuantities] = useState<Record<string, string>>({});
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [optionsRevision, setOptionsRevision] = useState(0);
  const [walkIn, setWalkIn] = useState({ firstName: "", lastName: "", email: "", phoneNumber: "", address: "" });
  const [form, setForm] = useState<BookingForm>({ bookingDate: toIsoLocalDay(new Date()), bookingMode: "day", wholeDayVariant: "day_to_night", adultCount: "1", childCount: "0", unitId: "", specialRequests: "" });
  const [calendarMonth, setCalendarMonth] = useState(() => toIsoLocalDay(new Date()).slice(0, 7));
  const availability = useBookingAvailability([calendarMonth, form.bookingDate.slice(0, 7)], isOpen);
  const [isSaving, setIsSaving] = useState(false);
  const saving = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    const loadOptions = async () => {
      setOptionsLoading(true); setOptionsError(null);
      try {
        const supabase = createClient();
        const [unitResult, serviceResult] = await Promise.all([
          supabase.from("units").select("unit_id, name, capacity").eq("is_active", true).is("archived_at", null).order("name"),
          supabase.from("services").select("service_id, name, description, price").eq("is_active", true).order("name"),
        ]);
        if ([unitResult, serviceResult].some(result => result.error)) throw new Error("Unable to load units or services. Please reload the booking options.");
        if (!active) return;
        const availableUnits = (unitResult.data as Unit[] | null) ?? [];
        setUnits(availableUnits); setServices((serviceResult.data as Service[] | null) ?? []);
        setForm(current => ({ ...current, unitId: current.unitId || availableUnits[0]?.unit_id || "" }));
      } catch (cause) {
        if (active) setOptionsError(cause instanceof Error ? cause.message : "Unable to load booking options.");
      } finally { if (active) setOptionsLoading(false); }
    };
    void loadOptions();
    return () => { active = false; };
  }, [isOpen, optionsRevision]);

  if (!isOpen) return null;

  const packageIssue = (date: string, mode: PackageMode, variant: WholeDayVariant = "day_to_night"): string | null => {
    if (!date) return "Choose a booking date.";
    if (!availability.ready) return availability.error ?? "Loading available dates...";
    const window = buildBookingWindow({ bookingMode: mode, date: new Date(`${date}T00:00:00`), wholeDayVariant: variant });
    if ("error" in window || !window.startDatetime || !window.endDatetime) return "Invalid booking schedule.";
    if (!isBookingStartAllowed(window.startDatetime, availability.now)) return "Choose a start time at least 30 minutes from now.";
    if (!isWindowAvailable(window.startDatetime, window.endDatetime, availability.reservations)) return "Already reserved for this package.";
    const start = manilaDateKey(window.startDatetime);
    const end = manilaDateKey(new Date(Date.parse(window.endDatetime) - 1));
    if (availability.blockedDates.some(block => block.start_date <= end && block.end_date >= start)) return "Closed for maintenance.";
    return null;
  };
  const dateIssue = (date: string) => {
    const day = packageIssue(date, "day"), night = packageIssue(date, "night");
    return !day || !night ? null : day === night ? day : "No available package start times.";
  };
  const chooseDate = (date: string) => {
    if (dateIssue(date)) return;
    setForm(current => {
      if (!packageIssue(date, current.bookingMode, current.wholeDayVariant)) return { ...current, bookingDate: date };
      return { ...current, bookingDate: date, bookingMode: !packageIssue(date, "day") ? "day" : "night" };
    });
    setError(null);
  };
  const updateForm = (key: keyof BookingForm, value: string) => setForm(current => ({ ...current, [key]: value }));
  const selectedIssue = packageIssue(form.bookingDate, form.bookingMode, form.wholeDayVariant);
  const selectedServices = Object.entries(serviceQuantities).map(([serviceId, quantity]) => ({ serviceId, quantity: Number(quantity) }));
  const quantitiesValid = Object.values(serviceQuantities).every(validQuantity);
  const servicesTotal = services.reduce((total, service) => total + (validQuantity(serviceQuantities[service.service_id] ?? "") ? Number(service.price) * Number(serviceQuantities[service.service_id]) : 0), 0);
  const previewWindow = buildBookingWindow({ bookingMode: form.bookingMode, date: new Date(`${form.bookingDate}T00:00:00`), wholeDayVariant: form.wholeDayVariant });
  const preview = packageSchedule && !("error" in previewWindow) && isValidGuestCounts(Number(form.adultCount), Number(form.childCount))
    ? computeBookingPricing({ bookingMode: form.bookingMode, startDatetime: previewWindow.startDatetime, endDatetime: previewWindow.endDatetime, adultCount: Number(form.adultCount), childCount: Number(form.childCount), servicesTotal }, packageSchedule.rates) : null;

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving.current) return;
    setError(null); setSuccess(null);
    if (selectedIssue) { setError(selectedIssue); return; }
    if (optionsLoading || optionsError) { setError(optionsError ?? "Please wait for booking options to load."); return; }
    if (!quantitiesValid) { setError("Enter a whole-number quantity from 1 to 10,000 for each selected service."); return; }
    if (!packageSchedule || packageRatesError) { setError(packageRatesError ?? "Please wait for booking prices to load."); return; }
    if ("error" in previewWindow) { setError(previewWindow.error ?? "Invalid booking window."); return; }
    const adults = Number(form.adultCount), children = Number(form.childCount);
    if (!form.unitId || !isValidGuestCounts(adults, children)) { setError("Select a unit and enter valid guest counts."); return; }
    if (Object.values(walkIn).some(value => !value.trim())) { setError("Complete all walk-in guest details."); return; }
    saving.current = true; setIsSaving(true);
    try {
      const response = await fetch("/api/admin/reservations/create", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        packageRateVersion: packageSchedule.version, guestType: "walk_in", walkInGuest: walkIn, bookingMode: form.bookingMode,
        wholeDayVariant: form.bookingMode === "whole_day" ? form.wholeDayVariant : null,
        startDatetime: previewWindow.startDatetime, endDatetime: previewWindow.endDatetime,
        adultCount: adults, childCount: children, unitId: form.unitId, specialRequests: form.specialRequests, selectedServices,
      }) });
      const result = (await response.json().catch(() => null)) as { success?: boolean; message?: string; reservation?: { referenceNumber?: string } } | null;
      if (!response.ok || !result?.success) {
        if (response.status === 409) availability.refresh();
        throw new Error(result?.message ?? "Failed to create manual reservation.");
      }
      setSuccess(`Manual reservation ${result.reservation?.referenceNumber ?? "created"}.`);
      onCreated();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Failed to create manual reservation."); }
    finally { saving.current = false; setIsSaving(false); }
  };

  return <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-neutral/45 px-3 py-4 backdrop-blur-sm sm:items-center sm:px-4 sm:py-6" role="dialog" aria-modal="true" aria-labelledby="manual-booking-title">
    <div className="max-h-[92dvh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-neutral/10 bg-white p-4 shadow-2xl sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-neutral/10 pb-5">
        <div className="min-w-0"><h2 id="manual-booking-title" className="text-xl font-semibold text-neutral">New Manual Reservation</h2><p className="mt-1 text-sm text-neutral/60">Choose an available package and add any services requested by the guest.</p></div>
        <button type="button" disabled={isSaving} onClick={onClose} className="min-h-11 rounded-xl border border-neutral/20 px-3 text-sm font-semibold text-neutral">Close</button>
      </div>
      <form onSubmit={handleSubmit} className="mt-5">
        {error && <p role="alert" className="mb-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
        {success && <p role="status" className="mb-4 rounded-xl bg-green-50 px-3 py-2 text-sm text-neutral">{success}</p>}
        {optionsError && <div role="alert" className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-800">{optionsError}<button type="button" onClick={() => setOptionsRevision(value => value + 1)} className="ml-2 min-h-11 underline">Reload booking options</button></div>}
        <fieldset disabled={isSaving} className="min-w-0 space-y-5">
          <div className="grid gap-4 md:grid-cols-2">
            <p className="text-sm text-neutral/65 md:col-span-2">For guests without an account who book by phone, Messenger or walk-in. Registered guests should book through their own account.</p>
            {(Object.keys(walkIn) as Array<keyof typeof walkIn>).map(key => <Input key={key} label={({ firstName: "First name", lastName: "Last name", email: "Email", phoneNumber: "Phone", address: "Address" })[key]} type={key === "email" ? "email" : "text"} value={walkIn[key]} onChange={value => setWalkIn(current => ({ ...current, [key]: value }))} />)}
          </div>
          <div className="grid min-w-0 gap-4 md:grid-cols-2">
            <div className="min-w-0 space-y-3">
              {!availability.ready && !availability.error && <p role="status" className="text-sm text-neutral/70">Loading available dates...</p>}
              {availability.error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{availability.error}<button type="button" onClick={availability.refresh} className="ml-2 min-h-11 underline">Retry availability</button></p>}
              <BookingDateCalendar value={form.bookingDate} onChange={chooseDate} onMonthChange={setCalendarMonth} minDate={manilaDateKey(new Date(availability.now))} minimumDateReason="Past date"
                getUnavailableReason={dateIssue} disabled={isSaving}
                getDateHint={date => !packageIssue(date, "day") && !packageIssue(date, "night") ? "Day / Night" : !packageIssue(date, "day") ? "Day only" : "Night only"}
                footnote="Dates show remaining day/night starts. Unavailable packages are disabled. Times are fixed in Philippine time; availability is checked again before saving." />
            </div>
            <div className="min-w-0 space-y-4">
              <SelectField label="Booking package" value={form.bookingMode} onChange={value => {
                if (value === "whole_day" && packageIssue(form.bookingDate, "whole_day", form.wholeDayVariant)) {
                  setForm(current => ({ ...current, bookingMode: "whole_day", wholeDayVariant: current.wholeDayVariant === "day_to_night" ? "night_to_day" : "day_to_night" }));
                } else updateForm("bookingMode", value);
              }} options={[
                { value: "day", label: "Day - 8:00 AM to 4:00 PM", disabled: Boolean(packageIssue(form.bookingDate, "day")) },
                { value: "night", label: "Night - 6:00 PM to 6:00 AM", disabled: Boolean(packageIssue(form.bookingDate, "night")) },
                { value: "whole_day", label: "Whole Day - 22 hours", disabled: Boolean(packageIssue(form.bookingDate, "whole_day", "day_to_night") && packageIssue(form.bookingDate, "whole_day", "night_to_day")) },
              ]} />
              {form.bookingMode === "whole_day" && <SelectField label="Whole-day variant" value={form.wholeDayVariant} onChange={value => updateForm("wholeDayVariant", value)} options={[
                { value: "day_to_night", label: "A - 8:00 AM to 6:00 AM next day", disabled: Boolean(packageIssue(form.bookingDate, "whole_day", "day_to_night")) },
                { value: "night_to_day", label: "B - 6:00 PM to 4:00 PM next day", disabled: Boolean(packageIssue(form.bookingDate, "whole_day", "night_to_day")) },
              ]} />}
              {availability.ready && selectedIssue && <p role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{selectedIssue} Choose another date or an available package.</p>}
              <SelectField label="Unit" value={form.unitId} onChange={value => updateForm("unitId", value)} options={units.map(unit => ({ value: unit.unit_id, label: `${unit.name} - ${unit.capacity} pax` }))} />
              <div className="grid grid-cols-2 gap-3"><Input label="Adults" type="number" value={form.adultCount} onChange={value => updateForm("adultCount", value)} /><Input label="Children" type="number" value={form.childCount} onChange={value => updateForm("childCount", value)} /></div>
            </div>
          </div>
          <section aria-labelledby="manual-services-title" className="rounded-xl border border-neutral/10 p-4">
            <h3 id="manual-services-title" className="font-semibold text-neutral">Additional services</h3>
            <p className="mt-1 text-sm text-neutral/60">Optional. Select services and enter the quantities needed.</p>
            {optionsLoading ? <p className="mt-3 text-sm text-neutral/60">Loading services...</p> : !optionsError && services.length === 0 ? <p className="mt-3 text-sm text-neutral/60">No active services are available.</p> : null}
            <div className="mt-3 space-y-3">{services.map(service => {
              const quantity = serviceQuantities[service.service_id], selected = quantity !== undefined;
              return <div key={service.service_id} className="rounded-xl border border-neutral/10 p-3">
                <label className="flex cursor-pointer items-start gap-3 text-sm text-neutral">
                  <input type="checkbox" checked={selected} onChange={event => setServiceQuantities(current => { const next = { ...current }; if (event.target.checked) next[service.service_id] = "1"; else delete next[service.service_id]; return next; })} className="mt-0.5 h-5 w-5 shrink-0" />
                  <span className="min-w-0 flex-1"><span className="block font-medium">{service.name}</span>{service.description && <span className="mt-1 block break-words text-xs text-neutral/60">{service.description}</span>}<span className="mt-1 block text-xs">{money(Number(service.price))} each</span></span>
                </label>
                {selected && <div className="mt-3 flex flex-wrap items-end justify-between gap-3"><label className="w-28 text-sm text-neutral">Quantity<input aria-label={`Quantity for ${service.name}`} type="number" min="1" max="10000" step="1" required value={quantity} onChange={event => setServiceQuantities(current => ({ ...current, [service.service_id]: event.target.value }))} className={fieldClass} /></label><p className="text-sm font-semibold text-neutral">{validQuantity(quantity) ? money(Number(service.price) * Number(quantity)) : "Enter a valid quantity"}</p></div>}
              </div>;
            })}</div>
          </section>
          <label className="block text-sm text-neutral">Special requests<textarea value={form.specialRequests} onChange={event => updateForm("specialRequests", event.target.value)} rows={3} className={fieldClass} /></label>
          <div aria-label="Billing preview" className="rounded-xl bg-base p-4 text-sm text-neutral">{packageRatesError ? <p role="alert" className="text-red-700">{packageRatesError}</p> : preview ? <>
            <p className="font-semibold">{preview.rateTier === "weekend" ? "Weekend" : "Weekday"} package: {money(preview.packageRate)}</p>
            <p className="mt-1">Extra guests: {preview.extraGuests} x {money(preview.addOnPerHead)}</p>
            <p className="mt-1">Additional services: {money(preview.servicesTotal)}</p>
            {!quantitiesValid && <p role="alert" className="mt-2 text-red-700">Enter a whole-number quantity from 1 to 10,000 for each selected service.</p>}
            <p className="mt-2 font-semibold text-primary">Total: {money(preview.total)}</p>
            <p className="mt-1 text-xs text-neutral/60">Minimum 20% downpayment: {money(preview.downPaymentMin)}</p>
          </> : <p>Choose a valid date and guest count to view the current package price.</p>}</div>
          <div className="flex flex-wrap justify-end gap-2"><button type="button" onClick={onClose} className="min-h-11 rounded-xl border border-neutral/20 px-4 py-2 text-sm font-semibold text-neutral">Cancel</button><button type="submit" disabled={isSaving || !preview || Boolean(packageRatesError) || !quantitiesValid || Boolean(selectedIssue) || optionsLoading || Boolean(optionsError)} className="min-h-11 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{isSaving ? "Creating..." : "Create Manual Reservation"}</button></div>
        </fieldset>
      </form>
    </div>
  </div>;
}

function Input({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (value: string) => void; type?: string }) {
  return <label className="block text-sm text-neutral">{label}<input type={type} value={value} onChange={event => onChange(event.target.value)} className={fieldClass} /></label>;
}
function SelectField({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: Array<{ value: string; label: string; disabled?: boolean }> }) {
  return <label className="block text-sm text-neutral">{label}<select value={value} onChange={event => onChange(event.target.value)} className={fieldClass}><option value="" disabled>Select {label.toLowerCase()}</option>{options.map(option => <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}{option.disabled ? " (unavailable)" : ""}</option>)}</select></label>;
}
