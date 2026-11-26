"use client";
import { swimmingRoomDescription } from "@/lib/booking/swimming-rooms";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Navigation from "@/components/Navigation";
import Footer from "@/components/Footer";
import BookingProgress from "./BookingProgress";
import BookingGuide from "./BookingGuide";
import BookingPromoDiscount from "./BookingPromoDiscount";
import ServiceSelectionCard from "./ServiceSelectionCard";
import PromoCodeInput from "./PromoCodeInput";
import PublicSwimmingSelection, { type PublicSwimmingSelectionChange } from "./PublicSwimmingSelection";
import PhilippinePhoneInput from "@/components/ui/PhilippinePhoneInput";
import GuestCountInput from "@/components/ui/GuestCountInput";
import PhilippineAddressFields from "@/components/ui/PhilippineAddressFields";
import { useReservationFormGuard } from "./use-reservation-form-guard";
import { createClient } from "@/lib/supabase/client";
import { useBookingStore } from "@/lib/stores/booking-store";
import { publicSwimmingQuote, publicServiceCatalog, type PublicSwimmingCatalog, type PublicSwimmingType, type PublicSwimmingSlot } from "@/lib/booking/public-swimming";
import { parsePhilippineAddress, validatePhilippineAddress } from "@/lib/address/philippine-address";
import { normalizePhilippineMobile, PH_MOBILE_ERROR } from "@/lib/validation/phone";
import { sanitizeName, isValidName } from "@/lib/helper/validation";
import { serviceQuantityError, serviceQuantityLimit } from "@/lib/booking/service-quantity";
import { serviceBilling } from "@/lib/booking/service-billing";
import { isPublicSwimmingStartAllowed, PUBLIC_SWIMMING_LEAD_MESSAGE } from "@/lib/booking/public-swimming";
import { formatManilaDateTime } from "@/lib/booking/manila-date";
import type { PromoQuote } from "@/lib/booking/discounts";
import { useActionConfirmation } from "@/components/ui/use-action-confirmation";
import SwimmingRoomSelection, { useSwimmingRooms } from "./SwimmingRoomSelection";
import type { SwimmingRoomSelection as RoomSelection } from "@/lib/booking/swimming-rooms";

const money = (n: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(n);
export default function PublicSwimmingForm({ onSaved, onBusyChange }: { onSaved?: (reference: string, date?: string) => void; onBusyChange?: (busy: boolean) => void }) {
  const manual = !!onSaved, router = useRouter(), draft = useBookingStore(s => s.bookingDraft), setDraft = useBookingStore(s => s.setBookingDraft);
  const [session, setSession] = useState<{ type: PublicSwimmingType; slot: Pick<PublicSwimmingSlot, "startDatetime" | "endDatetime"> } | null>(() => !manual && draft.publicSwimmingType ? { type: draft.publicSwimmingType, slot: draft } : null);
  const [catalog, setCatalog] = useState<PublicSwimmingCatalog | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [profile, setProfile] = useState({ firstName: manual ? "" : draft.firstName, lastName: manual ? "" : draft.lastName, email: manual ? "" : draft.email, phone: manual ? "" : draft.phone });
  const [address, setAddress] = useState(() => parsePhilippineAddress(manual ? "" : draft.address));
  const [adults, setAdults] = useState(manual ? 1 : draft.adultCount || 1), [children, setChildren] = useState(manual ? 0 : draft.childCount || 0);
  const [eligible, setEligible] = useState(manual ? 0 : draft.eligibleGuests ?? 0), [promo, setPromo] = useState<PromoQuote | null>(manual ? null : draft.promo ?? null), [checkingPromo, setCheckingPromo] = useState(false);
  const [quantities, setQuantities] = useState<Record<string, number>>(() => manual ? {} : Object.fromEntries(draft.services.map(s => [s.id, s.quantity ?? 1])));
  const [requests, setRequests] = useState(manual ? "" : draft.specialRequests), [busy, setBusy] = useState(false);
  const [swimmingRooms, setSwimmingRooms] = useState<RoomSelection[]>(manual ? [] : draft.swimmingRooms ?? []);
  const roomsState = useSwimmingRooms(session?.slot.startDatetime ?? "", session?.slot.endDatetime ?? "", swimmingRooms, false, adults + children);
  const roomsTotal = roomsState.quote?.total ?? 0;
  const roomsIssue = swimmingRooms.length > 0 && (roomsState.loading || !roomsState.quote || !!roomsState.error);
  const requestId = useRef(""), saving = useRef(false), guard = useReservationFormGuard(!manual && !loading);
  const { confirm, confirmation } = useActionConfirmation();
  const chooseManualSession = useCallback<PublicSwimmingSelectionChange>((selection, data) => {
    setSession(selection); if (data) setCatalog(data);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch("/api/booking/public-swimming", { cache: "no-store", signal: controller.signal }), data = await response.json();
        if (!response.ok || !data.success) throw new Error(data.message ?? "Unable to load public swimming.");
        if (!manual) {
          const db = createClient(), { data: { user } } = await db.auth.getUser();
          if (!user) throw new Error("Sign in to continue your booking.");
          const result = await db.from("guests").select("first_name,last_name,phone_number,address").eq("id", user.id).maybeSingle();
          if (result.error) throw new Error("Unable to load your contact details.");
          if (controller.signal.aborted) return;
          setProfile(p => ({ firstName: p.firstName || result.data?.first_name || "", lastName: p.lastName || result.data?.last_name || "", email: user.email || p.email, phone: p.phone || result.data?.phone_number || "" }));
          setAddress(p => Object.values(p).some(Boolean) ? p : parsePhilippineAddress(result.data?.address || ""));
        }
        if (!controller.signal.aborted) setCatalog(data);
      } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Unable to load booking details."); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    }
    void load(); return () => controller.abort();
  }, [manual]);
  const duration = session ? (Date.parse(session.slot.endDatetime) - Date.parse(session.slot.startDatetime)) / 3600000 : 0;
  const services = publicServiceCatalog(catalog?.services ?? [], duration), selected = services.filter(s => quantities[s.service_id] !== undefined);
  const selections = selected.map(s => ({ serviceId: s.service_id, quantity: quantities[s.service_id] }));
  const serviceError = serviceQuantityError(selections, services);
  let quote: ReturnType<typeof publicSwimmingQuote> | null = null, quoteError = "";
  if (session) { try { quote = publicSwimmingQuote(session.type, adults, children, eligible, promo, selected.reduce((sum, s) => sum + Number(s.price) * quantities[s.service_id], 0)); } catch (e) { quoteError = e instanceof Error ? e.message : "Review the guest counts."; } }
  const total = Math.round(((quote?.total ?? 0) + roomsTotal) * 100) / 100;
  async function submit(e: FormEvent) {
    e.preventDefault(); if (saving.current) return; setError("");
    const phone = normalizePhilippineMobile(profile.phone), parsedAddress = validatePhilippineAddress(address);
    if (!isValidName(profile.firstName) || !isValidName(profile.lastName)) { setError("Enter the guest's full name."); return; }
    if (!phone) { setError(PH_MOBILE_ERROR); return; }
    if (!parsedAddress.value) { setError(parsedAddress.error ?? "Complete the address."); return; }
    if (!session || !isPublicSwimmingStartAllowed(session.slot.startDatetime, Date.now(), new Date(Date.parse(session.slot.startDatetime) - (catalog?.policy?.minimumAdvanceMinutes ?? 60) * 60000).toISOString())) { setError(PUBLIC_SWIMMING_LEAD_MESSAGE); return; }
    if (!quote || loading || checkingPromo || serviceError || quoteError || roomsIssue) { setError(serviceError || quoteError || roomsState.error || "Review your booking details."); return; }
    const latest = catalog?.types.find(t => t.type_id === session.type.type_id);
    if (!latest || latest.pricing_version !== session.type.pricing_version) { setError("Rates changed. Return to the calendar and choose your session again."); return; }
    if (!catalog?.slots.some(s => s.typeId === session.type.type_id && Date.parse(s.startDatetime) === Date.parse(session.slot.startDatetime)
      && Date.parse(s.endDatetime) === Date.parse(session.slot.endDatetime) && s.remainingCapacity >= adults + children)) {
      setError("This session is unavailable or has insufficient capacity. Return to the calendar and choose another session."); return;
    }
    const values = { firstName: profile.firstName.trim(), lastName: profile.lastName.trim(), phone, address: parsedAddress.value,
      typeId: session.type.type_id, pricingVersion: session.type.pricing_version,
      startDatetime: session.slot.startDatetime, endDatetime: session.slot.endDatetime, adultCount: adults, childCount: children,
      eligibleGuests: eligible, promoCode: promo?.code ?? null, selectedServices: selections, swimmingRooms: roomsState.quote?.selections ?? [], specialRequests: requests, expectedTotal: total };
    if (manual) {
      if (!await confirm({ title: "Create public swimming reservation?", message: `${profile.firstName} ${profile.lastName} · ${session.type.name}\n${formatManilaDateTime(session.slot.startDatetime)}\n${adults} adults, ${children} children\nTotal: ${money(total)}. Full payment is required.`, confirmText: "Create reservation" })) return;
      if (saving.current) return;
      saving.current = true; setBusy(true); onBusyChange?.(true); requestId.current ||= crypto.randomUUID();
      try {
        const r = await fetch("/api/admin/reservations/public-swimming", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...values, requestId: requestId.current }) }), data = await r.json();
        if (!r.ok || !data.success) throw new Error(data.message || "Unable to create the reservation.");
        guard.reset(); onSaved?.(data.reservation.referenceNumber, session.slot.startDatetime);
      } catch (e) { setError(e instanceof Error ? e.message : "Unable to create the reservation. Check the records before retrying."); }
      finally { saving.current = false; setBusy(false); onBusyChange?.(false); }
    } else {
      setDraft({ ...values, email: profile.email, commercialType: "public_swimming", publicSwimmingType: session.type, publicRequestId: draft.publicRequestId || crypto.randomUUID(),
        roomPrice: quote.admission, roomName: session.type.name, unitId: "public-swimming", eligibleGuests: eligible, discountAmount: quote.discount.amount, discountKind: quote.discount.kind,
        subtotal: quote.admission + quote.servicesTotal + roomsTotal, tax: 0, total, downPayment: total, paidAmount: 0, promo, packageRates: null, packageRateVersion: null,
        services: selected.map(s => ({ id: s.service_id, name: s.name, price: Number(s.price), quantity: quantities[s.service_id], billingType: s.billing_type })), reservationId: "", reservationReference: "" });
      guard.reset(); router.push("/booking/details");
    }
  }
  if (manual) return <>{confirmation}<form onSubmit={submit} className="mt-5 space-y-5" aria-label="Public swimming manual reservation">
    {(error || quoteError || serviceError) && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800">{error || quoteError || serviceError}</p>}
    <fieldset disabled={busy} className="min-w-0 space-y-5">
      <p className="text-sm text-neutral/60">For guests who book by phone, Messenger or walk-in. Public swimming uses adult and child admission rates.</p>
      <div className="grid gap-4 md:grid-cols-2">
        {(["firstName", "lastName"] as const).map(k => <label key={k} className="block text-sm text-neutral">{k === "firstName" ? "First name" : "Last name"}<input name={k} required maxLength={100} className="admin-field mt-1 w-full" value={profile[k]} onChange={event => setProfile(p => ({ ...p, [k]: sanitizeName(event.target.value) }))} /></label>)}
        <label className="block text-sm text-neutral">Phone<div className="mt-1"><PhilippinePhoneInput name="phone" value={profile.phone} onChange={phone => setProfile(p => ({ ...p, phone }))} /></div></label>
      </div>
      <fieldset className="space-y-3"><legend className="mb-2 text-sm font-medium text-neutral">Address</legend><div className="grid gap-3 sm:grid-cols-2">
        {([['streetAddress', 'Street address'], ['city', 'City / Municipality'], ['province', 'Province'], ['zipCode', 'ZIP code']] as const).map(([key, label]) => <label key={key} className="block text-sm text-neutral">{label}<input name={key} required inputMode={key === 'zipCode' ? 'numeric' : 'text'} maxLength={key === 'zipCode' ? 4 : 200} className="admin-field mt-1 w-full" value={address[key]} onChange={event => setAddress(current => ({ ...current, [key]: event.target.value }))} /></label>)}
      </div></fieldset>
      <PublicSwimmingSelection appearance="admin" onSelectionChange={chooseManualSession} />
      <div className="grid gap-4 sm:grid-cols-2">{[{ label: "Adults", value: adults, min: 1, set: setAdults }, { label: "Children", value: children, min: 0, set: setChildren }].map(f => <label key={f.label} className="block text-sm text-neutral">{f.label}<GuestCountInput aria-label={f.label} min={f.min} max={30} required className="admin-field mt-1 w-full" value={f.value} onValueChange={f.set} /></label>)}</div>
      <p className="text-sm text-neutral/60">Include at least one adult, with up to 30 guests per reservation.</p>
      {session && <SwimmingRoomSelection state={roomsState} value={swimmingRooms} onChange={setSwimmingRooms} start={session.slot.startDatetime} end={session.slot.endDatetime} guestCount={adults + children} />}
      <section aria-labelledby="manual-public-services-title"><h3 id="manual-public-services-title" className="font-semibold text-neutral">Additional services</h3><p className="mt-1 text-sm text-neutral/60">Optional. Select a session to see rental limits for its duration.</p>
        <div className="mt-3 space-y-3">{services.map(s => {
          const chosen = quantities[s.service_id] !== undefined, billing = serviceBilling(s.billing_type, serviceQuantityLimit(s.max_quantity));
          return <div key={s.service_id} className="rounded-xl border border-neutral/10 p-3"><label className="flex cursor-pointer items-start gap-3 text-sm text-neutral">
            <input type="checkbox" aria-label={`Add ${s.name}`} disabled={!session} checked={chosen} onChange={() => setQuantities(q => { const next = { ...q }; if (next[s.service_id] === undefined) next[s.service_id] = 1; else delete next[s.service_id]; return next; })} className="mt-0.5 h-5 w-5 shrink-0" />
            <span className="min-w-0 flex-1"><span className="block font-medium">{s.name}</span>{s.description && <span className="mt-1 block text-xs text-neutral/60">{s.description}</span>}<span className="mt-1 block text-xs">{billing.typeLabel} · {money(Number(s.price))} {billing.rateLabel}</span></span>
          </label>{chosen && billing.hasQuantity && <label className="mt-3 block max-w-40 text-sm text-neutral">{billing.inputLabel}<input aria-label={`${billing.inputLabel} for ${s.name}`} type="number" min={1} max={serviceQuantityLimit(s.max_quantity)} step={1} required value={Number.isFinite(quantities[s.service_id]) ? quantities[s.service_id] : ""} onChange={event => setQuantities(q => ({ ...q, [s.service_id]: Number(event.target.value) }))} className="admin-field mt-1 w-full" /></label>}</div>;
        })}</div>
        {loading && <p role="status" className="mt-3 text-sm text-neutral/60">Loading services...</p>}{!loading && !services.length && <p className="mt-3 text-sm text-neutral/60">No active services are available.</p>}
      </section>
      <label className="block max-w-sm text-sm text-neutral">PWD / senior guests<GuestCountInput aria-label="PWD / senior guests" min={0} max={adults + children} required className="admin-field mt-1 w-full" value={eligible} onValueChange={setEligible} /><span className="mt-1 block text-xs text-neutral/60">Verify eligible guest IDs at arrival. The larger eligible discount or promo applies to admission.</span></label>
      <PromoCodeInput promo={promo} onChange={setPromo} onBusyChange={setCheckingPromo} />
      <label className="block text-sm text-neutral">Special requests<textarea name="specialRequests" rows={3} maxLength={2000} className="admin-field mt-1 w-full" value={requests} onChange={event => setRequests(event.target.value)} /></label>
      <div aria-label="Billing preview" className="rounded-xl bg-base p-4 text-sm text-neutral">{session && quote ? <>
        <p className="font-semibold">{session.type.name}</p><p className="mt-1">{formatManilaDateTime(session.slot.startDatetime)} – {formatManilaDateTime(session.slot.endDatetime)}</p>
        <p className="mt-2">Adults: {adults} × {money(Number(session.type.adult_rate))}</p><p className="mt-1">Children: {children} × {money(Number(session.type.child_rate))}</p>
        <p className="mt-1">Additional services: {money(quote.servicesTotal)}</p><p className="mt-1">Optional rooms: {money(roomsTotal)}</p>
        {quote.discount.amount > 0 && <p className="mt-1">Discount: −{money(quote.discount.amount)}</p>}<p className="mt-2 font-semibold text-primary">Total: {money(total)}</p><p className="mt-1 text-xs text-neutral/60">Full payment is required within 30 minutes of saving. Submitted payments awaiting review preserve the booking.</p>
      </> : <p>Choose an available date and session to view admission rates and the total.</p>}</div>
      <div className="flex flex-wrap justify-end gap-2"><button type="submit" disabled={busy || loading || checkingPromo || !session || !quote || !!serviceError || roomsIssue} className="admin-button-primary">{busy ? "Creating..." : "Create Manual Reservation"}</button></div>
    </fieldset>
  </form></>;
  const field = "mt-2 w-full rounded-lg border border-neutral/20 bg-white px-4 py-3 text-neutral focus:border-primary focus:outline-none";
  const content = <>{guard.confirmation}{confirmation}{!session ? <PublicSwimmingSelection onChoose={(type, slot) => { setSession({ type, slot }); setError(""); }} /> : draft.reservationId ? <section className="rounded-3xl bg-white p-4 shadow-xl sm:p-8"><p>Booking {draft.reservationReference} is already saved. <Link className="font-semibold text-primary underline" href="/booking/details">View saved details</Link></p></section> : <div className="grid min-w-0 gap-6 lg:grid-cols-3 lg:gap-8">
    <div ref={guard.root} onFocusCapture={guard.captureInitial} onPointerDownCapture={guard.captureInitial} onClickCapture={guard.captureClick} onChangeCapture={guard.captureChange} onInputCapture={guard.captureChange} className="min-w-0 lg:col-span-2">
      <form onSubmit={submit} className="rounded-3xl bg-white p-4 shadow-xl sm:p-8">
        <h2 className="mb-6 text-2xl font-bold text-neutral sm:mb-8 sm:text-3xl">Reservation Details</h2>
        <section data-booking-guide="guest-personal" className="mb-8">
          <h3 className="mb-4 text-xl font-semibold text-neutral">Personal Information</h3>
          <div className="grid gap-4 md:grid-cols-2">
            {(["firstName", "lastName"] as const).map(k => <label key={k} className="block text-sm font-medium text-neutral/70">
              {k === "firstName" ? "First name" : "Last name"} *
              <input name={k} required autoComplete={k === "firstName" ? "given-name" : "family-name"} maxLength={100} className={field} value={profile[k]} onChange={e => setProfile(p => ({ ...p, [k]: sanitizeName(e.target.value) }))} />
            </label>)}
            <label className="block text-sm font-medium text-neutral/70">Account email
              <input name="email" type="email" readOnly aria-readonly="true" className={field + " bg-neutral/5 text-neutral/70"} value={profile.email} autoComplete="email" />
            </label>
            <label className="block text-sm font-medium text-neutral/70">Phone Number *
              <div className="mt-2"><PhilippinePhoneInput name="phone" value={profile.phone} onChange={phone => setProfile(p => ({ ...p, phone }))} /></div>
            </label>
            <div className="md:col-span-2"><PhilippineAddressFields value={address} onChange={setAddress} /></div>
          </div>
        </section>
        <section data-booking-guide="guest-group" className="mb-8">
          <h3 className="mb-4 text-xl font-semibold text-neutral">Swimming Guests</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            {[{ label: "Adults", value: adults, min: 1, set: setAdults }, { label: "Children", value: children, min: 0, set: setChildren }].map(f => <label key={f.label} className="block text-sm font-medium text-neutral/70">{f.label}
              <GuestCountInput aria-label={f.label} min={f.min} max={30} required className={field} value={f.value} onValueChange={f.set} />
            </label>)}
          </div>
          <p className="mt-3 text-sm text-neutral/70">Include at least one adult, with up to 30 guests per booking. Adult and child entrance rates are shown in the billing summary.</p>
        </section>
        <SwimmingRoomSelection state={roomsState} value={swimmingRooms} onChange={setSwimmingRooms} start={session.slot.startDatetime} end={session.slot.endDatetime} guestCount={adults + children} />
        <section data-booking-guide="guest-services" className="mb-8">
          <h3 className="mb-4 text-xl font-semibold text-neutral">Additional Services &amp; Amenities</h3>
          <p className="mb-4 text-sm text-neutral/70">Services are optional. Hourly rentals may be selected for up to {duration} hours, the duration of this session.</p>
          {loading && <p role="status" className="mb-4 text-sm text-neutral/70">Loading available services...</p>}
          <div className="grid gap-3 sm:grid-cols-2">{services.map(s => <ServiceSelectionCard key={s.service_id}
            service={{ id: s.service_id, name: s.name, description: s.description || "", price: Number(s.price), imageUrl: s.image_url, maxQuantity: s.max_quantity, billingType: s.billing_type }}
            selected={quantities[s.service_id] !== undefined} quantity={quantities[s.service_id] ?? 1}
            onToggle={() => setQuantities(q => { const next = { ...q }; if (next[s.service_id] === undefined) next[s.service_id] = 1; else delete next[s.service_id]; return next; })}
            onQuantityChange={n => setQuantities(q => ({ ...q, [s.service_id]: n }))} />)}</div>
          {!loading && !services.length && <p className="text-sm text-neutral/60">No additional services are available right now.</p>}
        </section>
        <section className="mb-8" aria-labelledby="public-discounts-heading">
          <h3 id="public-discounts-heading" className="mb-4 text-xl font-semibold text-neutral">Discounts &amp; Promo Code</h3>
          <label className="block max-w-sm text-sm font-medium text-neutral/70">PWD / senior guests
            <GuestCountInput aria-label="PWD / senior guests" min={0} max={adults + children} required className={field} value={eligible} onValueChange={setEligible} />
          </label>
          <p className="mb-4 mt-3 text-sm text-neutral/70">Count each eligible guest once and bring valid IDs for arrival verification. Only the larger eligible PWD/senior discount or promo applies to admission. Rooms and services are charged separately.</p>
          <PromoCodeInput promo={promo} onChange={setPromo} onBusyChange={setCheckingPromo} />
        </section>
        <section data-booking-guide="guest-requests" className="mb-8">
          <h3 className="mb-4 text-xl font-semibold text-neutral"><label htmlFor="public-special-requests">Special Requests</label></h3>
          <textarea id="public-special-requests" name="specialRequests" rows={4} maxLength={2000} placeholder="Any special requests or dietary requirements?" className={field} value={requests} onChange={e => setRequests(e.target.value)} />
        </section>
        {(error || quoteError || serviceError) && <p role="alert" className="mb-3 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error || quoteError || serviceError}</p>}
        <div className="flex flex-col gap-3 sm:flex-row sm:gap-4">
          <Link href="/booking" className="flex-1 rounded-full bg-neutral/10 px-6 py-4 text-center font-semibold text-neutral transition-colors hover:bg-neutral/20">Back to dates</Link>
          <button data-booking-guide="guest-continue" type="submit" disabled={busy || loading || checkingPromo || !quote || !!serviceError || roomsIssue}
            className="flex-1 rounded-full bg-primary px-6 py-4 font-semibold text-base transition-all hover:bg-primary/90 sm:hover:scale-105 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100">
            {busy ? "Saving reservation..." : "Review Full Details"}
          </button>
        </div>
      </form>
    </div>
    <div className="min-w-0 lg:col-span-1">
      <aside data-booking-guide="guest-summary" className="booking-summary rounded-3xl bg-white p-4 shadow-xl sm:p-8 lg:sticky lg:top-28">
        <h3 className="mb-6 text-2xl font-bold text-neutral">Billing Summary</h3>
        <div className="mb-6 space-y-4">
          <dl className="space-y-2 border-b border-neutral/10 pb-4">
            <div className="flex justify-between gap-3"><dt className="text-neutral/70">Start</dt><dd className="text-right font-semibold text-neutral">{formatManilaDateTime(session.slot.startDatetime)}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-neutral/70">End</dt><dd className="text-right font-semibold text-neutral">{formatManilaDateTime(session.slot.endDatetime)}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-neutral/70">Mode</dt><dd className="text-right font-semibold text-neutral">{session.type.name}</dd></div>
          </dl>
          <div className="border-b border-neutral/10 pb-4">
            <h4 className="mb-2 text-sm font-semibold text-neutral">Guest Pricing</h4>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-3"><dt className="text-neutral/70">Adults ({adults} × {money(Number(session.type.adult_rate))})</dt><dd className="whitespace-nowrap text-neutral">{money(adults * Number(session.type.adult_rate))}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-neutral/70">Children ({children} × {money(Number(session.type.child_rate))})</dt><dd className="whitespace-nowrap text-neutral">{money(children * Number(session.type.child_rate))}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-neutral/70">Total guests</dt><dd className="font-semibold text-neutral">{adults + children}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-neutral/70">Admission</dt><dd className="whitespace-nowrap font-semibold text-neutral">{money(quote?.admission ?? 0)}</dd></div>
            </dl>
          </div>
          {selected.length > 0 && <div className="border-b border-neutral/10 pb-4">
            <h4 className="mb-2 text-sm font-semibold text-neutral">Additional Services</h4>
            <dl className="space-y-2 text-sm">{selected.map(s => <div key={s.service_id} className="flex justify-between gap-3">
              <dt className="text-neutral/70">{s.name} × {quantities[s.service_id]}{s.billing_type === "duration" ? " hour(s)" : ""}</dt>
              <dd className="whitespace-nowrap text-neutral">{money(Number(s.price) * quantities[s.service_id])}</dd>
            </div>)}</dl>
          </div>}
          {roomsState.quote?.selections.map((r, index) => <div key={index} className="flex justify-between gap-3 text-sm"><span>{swimmingRoomDescription(r, index)}</span><span className="whitespace-nowrap">{money(r.unitPrice * r.quantity)}</span></div>)}
          {quote && <>
            <dl className="border-b border-neutral/10 pb-4">
              <div className="flex justify-between gap-3"><dt className="text-neutral/70">Subtotal (before discount)</dt><dd className="whitespace-nowrap font-semibold text-neutral">{money(quote.admission + quote.servicesTotal + roomsTotal)}</dd></div>
            </dl>
            <BookingPromoDiscount code={promo?.code ?? null} amount={quote.discount.amount} kind={quote.discount.kind} />
            <dl><div className="flex justify-between gap-3 text-xl font-bold"><dt className="text-neutral">Total</dt><dd className="whitespace-nowrap text-primary">{money(total)}</dd></div></dl>
            <div className="rounded-lg bg-accent/10 p-4">
              <div className="flex justify-between gap-3"><span className="text-sm font-semibold text-neutral">Full Payment</span><strong className="whitespace-nowrap text-lg text-accent">{money(total)}</strong></div>
              <p className="mt-2 text-xs text-neutral/60">Full payment is due within 30 minutes of saving. Payments remain subject to staff verification.</p>
            </div>
          </>}
        </div>
        <p className="rounded-lg bg-highlight/10 p-4 text-sm text-neutral/80"><span className="font-semibold">Note:</span> Review your session, guest counts and services before saving your reservation.</p>
      </aside>
    </div>
  </div>}</>;
  return <div className="booking-flow min-h-screen bg-base">
    <Navigation /><BookingProgress currentStep={session ? 2 : 1} />
    {session && !draft.reservationId && <BookingGuide page="guest" publicSwimming disabled={busy || checkingPromo} />}
    <main className="px-4 py-6 sm:py-12"><div className="mx-auto max-w-6xl">{content}</div></main>
    <Footer />
  </div>;
}
