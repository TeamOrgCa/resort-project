"use client";
import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Navigation from "@/components/Navigation";
import Footer from "@/components/Footer";
import BookingGuide from "./BookingGuide";
import BookingProgress from "./BookingProgress";
import ServiceSelectionCard from "./ServiceSelectionCard";
import PromoCodeInput from "./PromoCodeInput";
import PhilippinePhoneInput from "@/components/ui/PhilippinePhoneInput";
import PhilippineAddressFields from "@/components/ui/PhilippineAddressFields";
import { useReservationFormGuard } from "./use-reservation-form-guard";
import { createClient } from "@/lib/supabase/client";
import { useBookingStore } from "@/lib/stores/booking-store";
import { availableRoomCount, customerRoomQuote, type CustomerRoomCatalog, type CustomerRoomSelection } from "@/lib/booking/customer-rooms";
import { parsePhilippineAddress, validatePhilippineAddress } from "@/lib/address/philippine-address";
import { normalizePhilippineMobile, PH_MOBILE_ERROR } from "@/lib/validation/phone";
import { sanitizeName, isValidName } from "@/lib/helper/validation";
import { serviceQuantityError } from "@/lib/booking/service-quantity";
import { isRoomBookingStartAllowed, ROOM_BOOKING_LEAD_MESSAGE } from "@/lib/booking/room-stay";
import type { PromoQuote } from "@/lib/booking/discounts";
import { roomSelectionLabel } from "@/lib/booking/room-selection-summary";

const money = (n: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(n);
export default function RoomBookingForm() {
  const router = useRouter(), draft = useBookingStore(s => s.bookingDraft), setDraft = useBookingStore(s => s.setBookingDraft);
  const [catalog, setCatalog] = useState<CustomerRoomCatalog | null>(null), [loading, setLoading] = useState(true), [loadError, setLoadError] = useState(""), [error, setError] = useState(""), [reload, setReload] = useState(0);
  const [profile, setProfile] = useState({ firstName: draft.firstName, lastName: draft.lastName, email: draft.email, phone: draft.phone });
  const [address, setAddress] = useState(() => parsePhilippineAddress(draft.address));
  const [rooms, setRooms] = useState<CustomerRoomSelection[]>(draft.roomSelections ?? []);
  const [eligible, setEligible] = useState(draft.eligibleGuests ?? 0), [promo, setPromo] = useState<PromoQuote | null>(draft.promo ?? null), [checkingPromo, setCheckingPromo] = useState(false);
  const [quantities, setQuantities] = useState<Record<string, number>>(() => Object.fromEntries(draft.services.map(s => [s.id, s.quantity ?? 1])));
  const [requests, setRequests] = useState(draft.specialRequests);
  const guard = useReservationFormGuard(!loading);
  const duration = (Date.parse(draft.endDatetime) - Date.parse(draft.startDatetime)) / 3600000;
  const validStay = [3, 12].includes(duration);
  useEffect(() => {
    if (!validStay) { setLoading(false); return; }
    const controller = new AbortController();
    async function load() {
      setLoading(true); setLoadError("");
      try {
        const db = createClient();
        const [response, auth] = await Promise.all([fetch(`/api/booking/rooms?${new URLSearchParams({ startDatetime: draft.startDatetime, endDatetime: draft.endDatetime })}`, { cache: "no-store", signal: controller.signal }), db.auth.getUser()]);
        const data = await response.json(); if (!response.ok || !data.success) throw new Error(data.message ?? "Room availability is unavailable.");
        const user = auth.data.user;
        if (!user) throw new Error("Sign in to continue your room booking.");
        const { data: guest, error: guestError } = await db.from("guests").select("first_name,last_name,phone_number,address").eq("id", user.id).maybeSingle();
        if (guestError) throw new Error("Unable to load your guest details. Please retry.");
        if (controller.signal.aborted) return;
        setCatalog(data);
        setProfile(p => ({ firstName: p.firstName || guest?.first_name || user.user_metadata?.first_name || "", lastName: p.lastName || guest?.last_name || user.user_metadata?.last_name || "", email: user.email || p.email, phone: p.phone || guest?.phone_number || "" }));
        setAddress(p => Object.values(p).some(Boolean) ? p : parsePhilippineAddress(guest?.address || ""));
        setRooms(current => current.length ? current.map(r => ({ ...r, pricingVersion: data.classifications.find((c: { classification_id: string }) => c.classification_id === r.classificationId)?.pricing_version ?? r.pricingVersion })) :
          data.classifications.filter((c: { classification_id: string }) => availableRoomCount(data, c.classification_id, draft.startDatetime, draft.endDatetime) > 0).slice(0, 1).map((c: { classification_id: string; pricing_version: number }) => ({ classificationId: c.classification_id, occupants: 1, pricingVersion: c.pricing_version })));
      } catch (e) { if (!controller.signal.aborted) setLoadError(e instanceof Error ? e.message : "Unable to load room booking details."); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    }
    void load(); return () => controller.abort();
  }, [draft.startDatetime, draft.endDatetime, reload, validStay]);

  const services = catalog?.services.filter(s => quantities[s.service_id] !== undefined) ?? [];
  const selections = services.map(s => ({ serviceId: s.service_id, quantity: quantities[s.service_id] }));
  const serviceError = serviceQuantityError(selections, catalog?.services ?? []);
  let quote: ReturnType<typeof customerRoomQuote> | null = null, quoteError = "";
  if (catalog) { try { quote = customerRoomQuote(catalog.classifications, rooms, duration, eligible, promo, services.reduce((sum, s) => sum + Number(s.price) * quantities[s.service_id], 0)); } catch (e) { quoteError = e instanceof Error ? e.message : "Review the selected rooms."; } }
  const inventoryError = catalog?.classifications.some(c => rooms.filter(r => r.classificationId === c.classification_id).length > availableRoomCount(catalog, c.classification_id, draft.startDatetime, draft.endDatetime)) ? "Not enough rooms are available for your selection. Remove a room, choose another type, or change your dates." : "";
  const nextClass = catalog?.classifications.find(c => rooms.filter(r => r.classificationId === c.classification_id).length < availableRoomCount(catalog, c.classification_id, draft.startDatetime, draft.endDatetime));
  function continueToReview(e: FormEvent) {
    e.preventDefault(); setError("");
    const phone = normalizePhilippineMobile(profile.phone), parsedAddress = validatePhilippineAddress(address);
    if (!isValidName(profile.firstName) || !isValidName(profile.lastName)) { setError("Enter your full first and last names."); return; }
    if (!phone) { setError(PH_MOBILE_ERROR); return; }
    if (!parsedAddress.value) { setError(parsedAddress.error ?? "Complete your address."); return; }
    if (!isRoomBookingStartAllowed(draft.startDatetime)) { setError(ROOM_BOOKING_LEAD_MESSAGE); return; }
    if (!quote || loading || loadError || quoteError || inventoryError || serviceError || checkingPromo) { setError(quoteError || inventoryError || serviceError || "Refresh the room availability and review your selections."); return; }
    setDraft({ commercialType: "room_accommodation", roomSelections: quote.selections, eligibleGuests: eligible, discountAmount: quote.discount.amount, discountKind: quote.discount.kind,
      firstName: profile.firstName.trim(), lastName: profile.lastName.trim(), email: profile.email, phone, address: parsedAddress.value,
      adultCount: quote.headCount, childCount: 0, unitId: "room-accommodation", roomName: roomSelectionLabel(quote.selections), roomPrice: quote.accommodation,
      subtotal: quote.gross, tax: 0, total: quote.total, downPayment: quote.total, paidAmount: 0, packageRates: null, packageRateVersion: null,
      services: services.map(s => ({ id: s.service_id, name: s.name, price: Number(s.price), quantity: quantities[s.service_id], billingType: s.billing_type })),
      specialRequests: requests, promo, promoCode: promo?.code ?? null, roomRequestId: draft.roomRequestId || crypto.randomUUID(), reservationId: "", reservationReference: "" });
    guard.reset(); router.push("/booking/details");
  }
  const fieldClass = "mt-2 min-h-12 w-full rounded-xl border border-neutral/20 bg-white px-4 py-3 text-neutral focus:border-primary focus:outline-none";
  return <div className="booking-flow min-h-screen bg-base"><Navigation /><BookingProgress currentStep={2} />{!draft.reservationId && <BookingGuide page="guest" room disabled={checkingPromo} />}{guard.confirmation}<main className="mx-auto max-w-6xl px-4 py-6 sm:py-12">
    {(!validStay || draft.reservationId) && <h1 className="text-3xl font-bold text-neutral">Room booking details</h1>}
    {!validStay ? <p role="alert" className="mt-6">Choose a 3-hour or 12-hour room stay first. <Link className="font-semibold text-primary underline" href="/booking">Select dates</Link></p> : draft.reservationId ? <section className="mt-6 rounded-2xl bg-white p-6"><p>This booking is already saved as <strong>{draft.reservationReference}</strong>. View its details to continue to full payment.</p><Link className="mt-4 inline-block rounded-full bg-primary px-6 py-3 font-semibold text-white" href="/booking/details">View saved booking details</Link></section> : <div className="grid min-w-0 gap-6 lg:grid-cols-3 lg:gap-8">
      <div ref={guard.root} onFocusCapture={guard.captureInitial} onPointerDownCapture={guard.captureInitial} onClickCapture={guard.captureClick} onChangeCapture={guard.captureChange} onInputCapture={guard.captureChange} className="min-w-0 rounded-3xl bg-white p-4 shadow-xl sm:p-8 lg:col-span-2"><form onSubmit={continueToReview} className="space-y-8">
        <header><h1 className="text-2xl font-bold text-neutral sm:text-3xl">Reservation Details</h1><p className="mt-2 text-neutral/70">Choose your rooms and services, then review the complete booking before saving.</p></header>
        <section data-booking-guide="guest-personal" className="min-w-0"><h2 className="text-xl font-semibold text-neutral">Guest and contact information</h2><div className="mt-5 grid gap-4 sm:grid-cols-2">{(["firstName", "lastName"] as const).map(k => <label key={k} className="text-sm font-medium">{k === "firstName" ? "First name" : "Last name"}<input required autoComplete={k === "firstName" ? "given-name" : "family-name"} maxLength={100} className={fieldClass} value={profile[k]} onChange={e => setProfile(p => ({ ...p, [k]: sanitizeName(e.target.value) }))} /></label>)}<label className="text-sm font-medium">Contact number<div className="mt-2"><PhilippinePhoneInput name="phone" value={profile.phone} onChange={phone => setProfile(p => ({ ...p, phone }))} /></div></label><div className="text-sm"><p className="font-medium">Account email</p><p className="mt-3 break-all text-neutral/70">{profile.email || "Loading…"}</p></div></div><div className="mt-5"><PhilippineAddressFields value={address} onChange={setAddress} /></div></section>
        <section data-booking-guide="guest-group" className="min-w-0"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-semibold text-neutral">Rooms to avail</h2><button type="button" onClick={() => setReload(n => n + 1)} disabled={loading} className="text-sm font-semibold text-primary underline">Refresh availability</button></div>
          {loading && <div role="status" className="mt-4 animate-pulse rounded-xl bg-base p-5">Loading available rooms…</div>}{loadError && <p role="alert" className="mt-4 text-sm text-red-700">{loadError}</p>}
          {rooms.map((r, i) => { const c = catalog?.classifications.find(c => c.classification_id === r.classificationId); return <fieldset key={i} disabled={loading} className="mt-4 rounded-xl border border-neutral/15 p-4"><legend className="px-2 font-semibold">Room {i + 1}</legend><div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-medium">Room type<select required aria-label={`Room ${i + 1} type`} className={fieldClass} value={r.classificationId} onChange={e => { const chosen = catalog?.classifications.find(c => c.classification_id === e.target.value); if (chosen) setRooms(rows => rows.map((row, n) => n === i ? { classificationId: chosen.classification_id, pricingVersion: chosen.pricing_version, occupants: Math.min(row.occupants, chosen.maximum_capacity) } : row)); }}>{catalog?.classifications.map(c => <option key={c.classification_id} value={c.classification_id}>{c.name} ({availableRoomCount(catalog, c.classification_id, draft.startDatetime, draft.endDatetime)} available)</option>)}</select></label><label className="text-sm font-medium">Guests in this room<input required aria-label={`Room ${i + 1} guests`} type="number" min={1} max={c?.maximum_capacity} step={1} className={fieldClass} value={r.occupants} onChange={e => setRooms(rows => rows.map((row, n) => n === i ? { ...row, occupants: Number(e.target.value) } : row))} /></label></div><p className="mt-3 text-sm text-neutral/65">{c?.included_capacity} guests included · Maximum {c?.maximum_capacity} guests · {duration} hours</p>{rooms.length > 1 && <button type="button" className="mt-3 text-sm font-semibold text-primary underline" onClick={() => setRooms(rows => rows.filter((_, n) => n !== i))}>Remove room {i + 1}</button>}</fieldset>; })}
          {!loading && !loadError && !rooms.length && <p className="mt-4 text-sm">No rooms are available for these dates. <Link href="/booking" className="text-primary underline">Choose another stay</Link></p>}
          <button type="button" disabled={loading || !nextClass || rooms.length >= 20} className="mt-4 rounded-full border border-primary px-5 py-3 text-sm font-semibold text-primary disabled:opacity-50" onClick={() => { if (nextClass) setRooms(rows => [...rows, { classificationId: nextClass.classification_id, pricingVersion: nextClass.pricing_version, occupants: 1 }]); }}>+ Add another room</button>
        </section>
        <section data-booking-guide="guest-services" className="min-w-0"><h2 className="text-xl font-semibold text-neutral">Additional services</h2><div className="mt-4 grid gap-4 sm:grid-cols-2">{catalog?.services.map(s => <ServiceSelectionCard key={s.service_id} service={{ id: s.service_id, name: s.name, description: s.description ?? "", price: Number(s.price), imageUrl: s.image_url, maxQuantity: s.max_quantity, billingType: s.billing_type }} selected={quantities[s.service_id] !== undefined} quantity={quantities[s.service_id] ?? 1} onToggle={() => setQuantities(q => { const next = { ...q }; if (next[s.service_id] !== undefined) delete next[s.service_id]; else next[s.service_id] = 1; return next; })} onQuantityChange={n => setQuantities(q => ({ ...q, [s.service_id]: n }))} />)}</div>{catalog?.services.length === 0 && <p className="mt-3 text-sm text-neutral/65">No additional services are available.</p>}</section>
        <section className="min-w-0 space-y-4"><h2 className="text-xl font-semibold text-neutral">PWD / senior and promo discounts</h2><label className="block text-sm font-medium">PWD / senior guests<input aria-label="PWD / senior guests" type="number" min={0} max={rooms.reduce((sum, r) => sum + r.occupants, 0)} step={1} required value={eligible} className={fieldClass} onChange={e => setEligible(Number(e.target.value))} /></label><p className="text-sm text-neutral/65">Count each eligible guest once. Bring valid IDs for staff verification at arrival. The 20% discount is proportional to eligible guests and applies to accommodation. The larger of the PWD/senior discount or promo applies; discounts never stack.</p><PromoCodeInput promo={promo} onChange={setPromo} onBusyChange={setCheckingPromo} /></section>
        <section data-booking-guide="guest-requests" className="min-w-0"><label className="text-sm font-semibold">Special requests<textarea maxLength={2000} rows={3} className={fieldClass} value={requests} onChange={e => setRequests(e.target.value)} /></label></section>
        {(error || quoteError || inventoryError || serviceError) && <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{error || quoteError || inventoryError || serviceError}</p>}
        <div className="grid gap-3 sm:grid-cols-2"><Link href="/booking" className="rounded-full bg-neutral/10 px-6 py-4 text-center font-semibold text-neutral">Back to dates</Link><button data-booking-guide="guest-continue" type="submit" disabled={loading || checkingPromo || !quote || !!loadError || !!inventoryError || !!serviceError} className="rounded-full bg-primary px-6 py-4 font-semibold text-white disabled:opacity-50">Continue to Full Booking Details</button></div>
      </form></div>
      <div className="min-w-0 lg:col-span-1"><aside data-booking-guide="guest-summary" className="booking-summary rounded-3xl bg-white p-4 shadow-xl sm:p-8 lg:sticky lg:top-28"><h2 className="text-2xl font-bold text-neutral">Billing Summary</h2><p className="mt-3 text-sm text-neutral/65">{new Date(draft.startDatetime).toLocaleString("en-PH", { timeZone: "Asia/Manila" })} – {new Date(draft.endDatetime).toLocaleString("en-PH", { timeZone: "Asia/Manila" })} (PHT)</p><p className="mt-2 text-sm">{rooms.length} room(s) · {rooms.reduce((sum, r) => sum + r.occupants, 0)} guest(s) · {duration} hours</p>{quote && <dl className="mt-5 space-y-3 text-sm">{[["Accommodation", quote.accommodation], ["Additional guests", quote.additionalGuests], ["Services", quote.servicesTotal], [quote.discount.kind === "pwd_senior" ? "PWD / senior discount" : "Promo discount", -quote.discount.amount], ["Total", quote.total]].map(([label, value]) => <div key={label} className="flex justify-between gap-3"><dt>{label}</dt><dd className="font-semibold">{money(Number(value))}</dd></div>)}</dl>}<p className="mt-5 rounded-xl bg-base p-3 text-sm">Full payment is required for room accommodation. Your booking is saved only after you review it and select Save Booking.</p></aside></div>
    </div>}
  </main><Footer /></div>;
}
