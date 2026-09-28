"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { buildBookingWindow, toIsoLocalDay, type BookingMode, type WholeDayVariant } from "@/lib/booking/policy";

type Guest = { id: string; first_name: string; last_name: string; email: string };
type Unit = { unit_id: string; name: string; capacity: number };
type ManualBookingDialogProps = { isOpen: boolean; onClose: () => void; onCreated: () => void };

type BookingForm = { bookingDate: string; bookingMode: Exclude<BookingMode, "custom">; wholeDayVariant: WholeDayVariant; adultCount: string; childCount: string; unitId: string; specialRequests: string };

export default function ManualBookingDialog({ isOpen, onClose, onCreated }: ManualBookingDialogProps) {
  const [guests, setGuests] = useState<Guest[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [guestType, setGuestType] = useState<"existing" | "walk_in">("existing");
  const [guestId, setGuestId] = useState("");
  const [walkIn, setWalkIn] = useState({ firstName: "", lastName: "", email: "", phoneNumber: "", address: "" });
  const [form, setForm] = useState<BookingForm>({ bookingDate: toIsoLocalDay(new Date()), bookingMode: "day", wholeDayVariant: "day_to_night", adultCount: "1", childCount: "0", unitId: "", specialRequests: "" });
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const loadOptions = async () => {
      const supabase = createClient();
      const [{ data: guestData }, { data: unitData }] = await Promise.all([
        supabase.from("guests").select("id, first_name, last_name, email").order("first_name").limit(500),
        supabase.from("units").select("unit_id, name, capacity").eq("is_active", true).is("archived_at", null).order("name"),
      ]);
      setGuests((guestData as Guest[] | null) ?? []);
      const availableUnits = (unitData as Unit[] | null) ?? [];
      setUnits(availableUnits);
      setForm((current) => ({ ...current, unitId: current.unitId || availableUnits[0]?.unit_id || "" }));
    };
    void loadOptions();
  }, [isOpen]);

  if (!isOpen) return null;
  const updateForm = (key: keyof BookingForm, value: string) => setForm((current) => ({ ...current, [key]: value }));

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    const bookingWindow = buildBookingWindow({ bookingMode: form.bookingMode, date: new Date(`${form.bookingDate}T00:00:00`), wholeDayVariant: form.bookingMode === "whole_day" ? form.wholeDayVariant : undefined });
    if ("error" in bookingWindow) { setError(bookingWindow.error ?? "Invalid booking window."); return; }
    const adults = Number(form.adultCount);
    const children = Number(form.childCount);
    if (!form.unitId || !Number.isInteger(adults) || adults < 1 || !Number.isInteger(children) || children < 0) { setError("Select a unit and enter valid guest counts."); return; }
    if (guestType === "existing" && !guestId) { setError("Select an existing guest account."); return; }
    if (guestType === "walk_in" && (!walkIn.firstName || !walkIn.lastName || !walkIn.email || !walkIn.phoneNumber || !walkIn.address)) { setError("Complete all walk-in guest details."); return; }
    setIsSaving(true);
    try {
      const response = await fetch("/api/admin/reservations/create", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ guestType, guestId: guestType === "existing" ? guestId : undefined, walkInGuest: guestType === "walk_in" ? walkIn : undefined, bookingMode: form.bookingMode, wholeDayVariant: form.bookingMode === "whole_day" ? form.wholeDayVariant : null, startDatetime: bookingWindow.startDatetime, endDatetime: bookingWindow.endDatetime, adultCount: adults, childCount: children, unitId: form.unitId, specialRequests: form.specialRequests }) });
      const result = (await response.json().catch(() => null)) as { success?: boolean; message?: string; reservation?: { referenceNumber?: string } } | null;
      if (!response.ok || !result?.success) throw new Error(result?.message ?? "Failed to create manual reservation.");
      setSuccess(`Manual reservation ${result.reservation?.referenceNumber ?? "created"}.`);
      onCreated();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to create manual reservation.");
    } finally { setIsSaving(false); }
  };

  return <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-neutral/40 px-4 py-6 sm:items-center" role="dialog" aria-modal="true">
    <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-neutral/10 bg-white p-6 shadow-xl">
      <div className="flex items-start justify-between gap-4"><div><h2 className="text-xl font-semibold text-neutral">New Manual Reservation</h2><p className="mt-1 text-sm text-neutral/60">Create a staff booking entry without leaving the calendar.</p></div><button type="button" onClick={onClose} className="rounded-lg border border-neutral/20 px-3 py-1.5 text-xs font-semibold text-neutral hover:bg-base">Close</button></div>
      <form onSubmit={handleSubmit} className="mt-5">
        {error ? <p className="mb-4 rounded-lg border border-highlight/40 bg-highlight/10 px-3 py-2 text-sm text-neutral">{error}</p> : null}
        {success ? <p className="mb-4 rounded-lg border border-secondary/30 bg-secondary/10 px-3 py-2 text-sm text-neutral">{success}</p> : null}
        <div className="grid gap-4 md:grid-cols-2">
          <SelectField label="Guest type" value={guestType} onChange={(value) => setGuestType(value as typeof guestType)} options={[{ value: "existing", label: "Existing account" }, { value: "walk_in", label: "Walk-in guest" }]} />
          {guestType === "existing" ? <label className="text-sm text-neutral/70">Guest account<select value={guestId} onChange={(event) => setGuestId(event.target.value)} className="mt-2 w-full rounded-lg border border-neutral/20 px-3 py-2 text-sm"><option value="">Select guest</option>{guests.map((guest) => <option key={guest.id} value={guest.id}>{guest.first_name} {guest.last_name} · {guest.email}</option>)}</select></label> : <><Input label="First name" value={walkIn.firstName} onChange={(value) => setWalkIn((current) => ({ ...current, firstName: value }))} /><Input label="Last name" value={walkIn.lastName} onChange={(value) => setWalkIn((current) => ({ ...current, lastName: value }))} /><Input label="Email" value={walkIn.email} onChange={(value) => setWalkIn((current) => ({ ...current, email: value }))} /><Input label="Phone" value={walkIn.phoneNumber} onChange={(value) => setWalkIn((current) => ({ ...current, phoneNumber: value }))} /><Input label="Address" value={walkIn.address} onChange={(value) => setWalkIn((current) => ({ ...current, address: value }))} /></>}
          <Input label="Booking date" type="date" value={form.bookingDate} onChange={(value) => updateForm("bookingDate", value)} />
          <SelectField label="Booking package" value={form.bookingMode} onChange={(value) => updateForm("bookingMode", value)} options={[{ value: "day", label: "Day · 8:00 AM - 4:00 PM" }, { value: "night", label: "Night · 6:00 PM - 6:00 AM" }, { value: "whole_day", label: "Whole Day · 22 hours" }]} />
          {form.bookingMode === "whole_day" ? <SelectField label="Whole-day variant" value={form.wholeDayVariant} onChange={(value) => updateForm("wholeDayVariant", value)} options={[{ value: "day_to_night", label: "Variant A · 8:00 AM - 6:00 AM next day" }, { value: "night_to_day", label: "Variant B · 6:00 PM - 4:00 PM next day" }]} /> : null}
          <SelectField label="Unit" value={form.unitId} onChange={(value) => updateForm("unitId", value)} options={units.map((unit) => ({ value: unit.unit_id, label: `${unit.name} · ${unit.capacity} pax` }))} />
          <Input label="Adults" type="number" value={form.adultCount} onChange={(value) => updateForm("adultCount", value)} /><Input label="Children" type="number" value={form.childCount} onChange={(value) => updateForm("childCount", value)} />
          <label className="text-sm text-neutral/70 md:col-span-2">Special requests<textarea value={form.specialRequests} onChange={(event) => updateForm("specialRequests", event.target.value)} rows={3} className="mt-2 w-full rounded-lg border border-neutral/20 px-3 py-2 text-sm" /></label>
        </div>
        <div className="mt-6 flex justify-end gap-2"><button type="button" onClick={onClose} className="rounded-lg border border-neutral/20 px-4 py-2 text-sm font-semibold text-neutral hover:bg-base">Cancel</button><button type="submit" disabled={isSaving} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-base disabled:opacity-50">{isSaving ? "Creating..." : "Create Manual Reservation"}</button></div>
      </form>
    </div>
  </div>;
}

function Input({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (value: string) => void; type?: string }) { return <label className="text-sm text-neutral/70">{label}<input type={type} value={value} onChange={(event) => onChange(event.target.value)} className="mt-2 w-full rounded-lg border border-neutral/20 px-3 py-2 text-sm" /></label>; }
function SelectField({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: Array<{ value: string; label: string }> }) { return <label className="text-sm text-neutral/70">{label}<select value={value} onChange={(event) => onChange(event.target.value)} className="mt-2 w-full rounded-lg border border-neutral/20 px-3 py-2 text-sm"><option value="">Select {label.toLowerCase()}</option>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>; }
