"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Navigation from "@/components/Navigation";
import Footer from "@/components/Footer";
import BookingProgress from "./BookingProgress";
import ServiceSelectionCard from "./ServiceSelectionCard";
import PromoCodeInput from "./PromoCodeInput";
import PublicSwimmingSelection from "./PublicSwimmingSelection";
import PhilippinePhoneInput from "@/components/ui/PhilippinePhoneInput";
import PhilippineAddressFields from "@/components/ui/PhilippineAddressFields";
import { useReservationFormGuard } from "./use-reservation-form-guard";
import { createClient } from "@/lib/supabase/client";
import { useBookingStore } from "@/lib/stores/booking-store";
import { publicSwimmingQuote, publicServiceCatalog, type PublicSwimmingCatalog, type PublicSwimmingType, type PublicSwimmingSlot } from "@/lib/booking/public-swimming";
import { parsePhilippineAddress, validatePhilippineAddress } from "@/lib/address/philippine-address";
import { normalizePhilippineMobile, PH_MOBILE_ERROR } from "@/lib/validation/phone";
import { sanitizeName, isValidName } from "@/lib/helper/validation";
import { serviceQuantityError } from "@/lib/booking/service-quantity";
import { isBookingStartAllowed, BOOKING_LEAD_MESSAGE } from "@/lib/booking/start-time";
import { formatManilaDateTime } from "@/lib/booking/manila-date";
import type { PromoQuote } from "@/lib/booking/discounts";
import { useActionConfirmation } from "@/components/ui/use-action-confirmation";

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
  const requestId = useRef(""), saving = useRef(false), guard = useReservationFormGuard(!loading);
  const { confirm, confirmation } = useActionConfirmation();
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
  async function submit(e: FormEvent) {
    e.preventDefault(); if (saving.current) return; setError("");
    const phone = normalizePhilippineMobile(profile.phone), parsedAddress = validatePhilippineAddress(address);
    if (!isValidName(profile.firstName) || !isValidName(profile.lastName)) { setError("Enter the guest's full name."); return; }
    if (!phone) { setError(PH_MOBILE_ERROR); return; }
    if (!parsedAddress.value) { setError(parsedAddress.error ?? "Complete the address."); return; }
    if (!session || !isBookingStartAllowed(session.slot.startDatetime)) { setError(BOOKING_LEAD_MESSAGE); return; }
    if (!quote || loading || checkingPromo || serviceError || quoteError) { setError(serviceError || quoteError || "Review your booking details."); return; }
    const latest = catalog?.types.find(t => t.type_id === session.type.type_id);
    if (!latest || latest.pricing_version !== session.type.pricing_version) { setError("Rates changed. Return to the calendar and choose your session again."); return; }
    const values = { firstName: profile.firstName.trim(), lastName: profile.lastName.trim(), phone, address: parsedAddress.value,
      typeId: session.type.type_id, pricingVersion: session.type.pricing_version, ...session.slot, adultCount: adults, childCount: children,
      eligibleGuests: eligible, promoCode: promo?.code ?? null, selectedServices: selections, specialRequests: requests, expectedTotal: quote.total };
    if (manual) {
      if (!await confirm({ title: "Create public swimming reservation?", message: `${profile.firstName} ${profile.lastName} · ${session.type.name}\n${formatManilaDateTime(session.slot.startDatetime)}\n${adults} adults, ${children} children\nTotal: ${money(quote.total)}. Full payment is required.`, confirmText: "Create reservation" })) return;
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
        subtotal: quote.admission + quote.servicesTotal, tax: 0, total: quote.total, downPayment: quote.total, paidAmount: 0, promo, packageRates: null, packageRateVersion: null,
        services: selected.map(s => ({ id: s.service_id, name: s.name, price: Number(s.price), quantity: quantities[s.service_id], billingType: s.billing_type })), reservationId: "", reservationReference: "" });
      guard.reset(); router.push("/booking/details");
    }
  }
  const field = "mt-2 min-h-12 w-full rounded-xl border border-neutral/20 bg-white px-4 py-3 focus:border-primary focus:outline-none";
  const content = <>{guard.confirmation}{confirmation}{!session ? <PublicSwimmingSelection onChoose={(type, slot) => { setSession({ type, slot }); setError(""); }} /> : !manual && draft.reservationId ? <p className="rounded-xl bg-white p-5">Booking {draft.reservationReference} is already saved. <Link className="text-primary underline" href="/booking/details">View saved details</Link></p> : <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
    <div ref={guard.root} onFocusCapture={guard.captureInitial} onPointerDownCapture={guard.captureInitial} onClickCapture={guard.captureClick} onChangeCapture={guard.captureChange} onInputCapture={guard.captureChange}><form onSubmit={submit} className="space-y-5">
      <section className="rounded-2xl bg-white p-5 shadow-sm"><h2 className="text-xl font-semibold">Guest and contact information</h2><div className="mt-4 grid gap-4 sm:grid-cols-2">{(["firstName", "lastName"] as const).map(k => <label key={k} className="text-sm font-medium">{k === "firstName" ? "First name" : "Last name"}<input required maxLength={100} className={field} value={profile[k]} onChange={e => setProfile(p => ({ ...p, [k]: sanitizeName(e.target.value) }))} /></label>)}<label className="text-sm font-medium">Contact number<div className="mt-2"><PhilippinePhoneInput name="phone" value={profile.phone} onChange={phone => setProfile(p => ({ ...p, phone }))} /></div></label>{!manual && <div className="text-sm"><p className="font-medium">Account email</p><p className="mt-3 break-all">{profile.email}</p></div>}</div><div className="mt-5"><PhilippineAddressFields value={address} onChange={setAddress} /></div></section>
      <section className="rounded-2xl bg-white p-5 shadow-sm"><h2 className="text-xl font-semibold">Swimming guests</h2><div className="mt-4 grid gap-4 sm:grid-cols-3">{[{ label: "Adults", value: adults, min: 1, set: setAdults }, { label: "Children", value: children, min: 0, set: setChildren }, { label: "PWD / senior guests", value: eligible, min: 0, set: setEligible }].map(f => <label key={f.label} className="text-sm font-medium">{f.label}<input aria-label={f.label} type="number" min={f.min} max={f.label === "PWD / senior guests" ? adults + children : 30} step={1} required className={field} value={f.value} onChange={e => f.set(Number(e.target.value))} /></label>)}</div><p className="mt-3 text-sm text-neutral/60">Count each eligible guest once and bring valid IDs for arrival verification. Only the larger eligible PWD/senior discount or promo applies.</p><div className="mt-4"><PromoCodeInput promo={promo} onChange={setPromo} onBusyChange={setCheckingPromo} /></div></section>
      <section className="rounded-2xl bg-white p-5 shadow-sm"><h2 className="text-xl font-semibold">Additional services</h2><p className="mt-2 text-sm text-neutral/65">Hourly services may be selected for up to {duration} hours, the duration of this session.</p>{loading && <p role="status" className="mt-4">Loading services…</p>}<div className="mt-4 grid gap-4 sm:grid-cols-2">{services.map(s => <ServiceSelectionCard key={s.service_id} service={{ id: s.service_id, name: s.name, description: s.description || "", price: Number(s.price), imageUrl: s.image_url, maxQuantity: s.max_quantity, billingType: s.billing_type }} selected={quantities[s.service_id] !== undefined} quantity={quantities[s.service_id] ?? 1} onToggle={() => setQuantities(q => { const next = { ...q }; if (next[s.service_id] === undefined) next[s.service_id] = 1; else delete next[s.service_id]; return next; })} onQuantityChange={n => setQuantities(q => ({ ...q, [s.service_id]: n }))} />)}</div></section>
      <label className="block rounded-2xl bg-white p-5 text-sm font-medium">Special requests<textarea rows={3} maxLength={2000} className={field} value={requests} onChange={e => setRequests(e.target.value)} /></label>
      {(error || quoteError || serviceError) && <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{error || quoteError || serviceError}</p>}
      <div className="flex flex-wrap gap-3">{manual ? <button type="button" disabled={busy} className="admin-button-secondary" onClick={() => setSession(null)}>Change session</button> : <Link href="/booking" className="rounded-full bg-neutral/10 px-6 py-4 font-semibold">Back to dates</Link>}<button type="submit" disabled={busy || loading || checkingPromo || !quote || !!serviceError} className="rounded-full bg-primary px-6 py-4 font-semibold text-white disabled:opacity-50">{busy ? "Saving reservation…" : manual ? "Create Public Swimming Reservation" : "Continue to Full Booking Details"}</button></div>
    </form></div><aside className="h-fit rounded-2xl bg-white p-5 shadow-sm lg:sticky lg:top-28"><h2 className="text-xl font-semibold">{session.type.name}</h2><p className="mt-3 text-sm text-neutral/65">{formatManilaDateTime(session.slot.startDatetime)} – {formatManilaDateTime(session.slot.endDatetime)}</p><p className="mt-2 text-sm">{adults} adult(s) · {children} child(ren)</p>{quote && <dl className="mt-5 space-y-3 text-sm">{[["Admission", quote.admission], ["Services", quote.servicesTotal], [quote.discount.kind === "pwd_senior" ? "PWD / senior discount" : "Promo discount", -quote.discount.amount], ["Total", quote.total]].map(([label, value]) => <div key={label} className="flex justify-between gap-3"><dt>{label}</dt><dd className="font-semibold">{money(Number(value))}</dd></div>)}</dl>}<p className="mt-5 rounded-xl bg-base p-3 text-sm">Full payment is required within 30 minutes of saving. Payments remain subject to verification.</p></aside>
  </div>}</>;
  return manual ? content : <div className="booking-flow min-h-screen bg-base"><Navigation /><BookingProgress currentStep={2} /><main className="mx-auto max-w-7xl px-4 py-10 sm:px-6"><h1 className="mb-6 text-3xl font-bold">Public Swimming Booking Details</h1>{content}</main><Footer /></div>;
}
