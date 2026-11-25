"use client";

import { useEffect, useRef, useState } from "react";
import { calculateBookingDiscount, savedPromo, type DiscountState, type PromoQuote } from "@/lib/booking/discounts";
import PromoCodeInput from "@/components/booking/PromoCodeInput";

type Detail = { headCount: number; packagePrice: number; packagePriceLabel?: string; bill: DiscountState & { total_amount: number; paid_amount: number }; locked: boolean };
const money = (n: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(n);
export default function BookingDiscountPanel({ reservationId, disabled = false, onChanged, onBusyChange }: {
  reservationId: string; disabled?: boolean; onChanged?: (result: { totalAmount: number; remainingBalance: number }) => void; onBusyChange?: (busy: boolean) => void;
}) {
  const [detail, setDetail] = useState<Detail | null>(null), [eligible, setEligible] = useState("0"), [promo, setPromo] = useState<PromoQuote | null>(null);
  const [reason, setReason] = useState(""), [error, setError] = useState(""), [message, setMessage] = useState(""), [busy, setBusy] = useState(false), [reload, setReload] = useState(0);
  const [checkingPromo, setCheckingPromo] = useState(false);
  const saving = useRef(false);
  useEffect(() => {
    const c = new AbortController(); setDetail(null); setError("");
    fetch(`/api/admin/booking-discounts?reservationId=${encodeURIComponent(reservationId)}`, { cache: "no-store", signal: c.signal }).then(async response => {
      const data = await response.json(); if (!response.ok) throw new Error(data.message);
      if (!c.signal.aborted) { setDetail(data); setEligible(String(data.bill.discount_eligible_guests ?? 0)); setPromo(savedPromo(data.bill)); }
    }).catch(cause => { if (!c.signal.aborted) setError(cause.message); });
    return () => c.abort();
  }, [reservationId, reload]);
  let comparison: ReturnType<typeof calculateBookingDiscount> | null = null;
  if (detail) { try { comparison = calculateBookingDiscount(detail.packagePrice, detail.headCount, Number(eligible), promo); } catch { /* Show bounded-input guidance below. */ } }
  async function save() {
    if (!detail || !comparison || saving.current || disabled || checkingPromo) return;
    saving.current = true; setBusy(true); onBusyChange?.(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/admin/booking-discounts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reservationId, eligibleGuests: Number(eligible), promoCode: promo?.code ?? null, expectedTotal: Number(detail.bill.total_amount), reason }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.message);
      setMessage(data.message); setReason(""); setReload(n => n + 1); onChanged?.(data);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to update discount."); }
    finally { saving.current = false; setBusy(false); onBusyChange?.(false); }
  }
  return <section aria-label="Booking discounts" className="space-y-3 rounded-xl border border-primary/20 bg-base/40 p-4 text-sm">
    <h3 className="font-semibold">PWD / senior discount and promo</h3>
    {detail && <fieldset disabled={busy || disabled || detail.locked} className="space-y-3">
      <p>{detail.packagePriceLabel ?? "Package price"} {money(detail.packagePrice)} ÷ {detail.headCount} guests × 20% × eligible guests. Services, swimming room add-ons, extra-guest charges and reschedule fees are excluded. Count each eligible guest once after verifying eligibility.</p>
      <label className="block font-medium">Eligible PWD / senior guests<input aria-label="Eligible PWD / senior guests" type="number" min={0} max={detail.headCount} step={1} value={eligible} onChange={e => setEligible(e.target.value)} className="admin-field mt-1 w-full" /></label>
      <PromoCodeInput promo={promo} onChange={setPromo} onBusyChange={setCheckingPromo} />
      {comparison ? <dl className="grid grid-cols-[1fr_auto] gap-2"><dt>PWD / senior discount</dt><dd>{money(comparison.eligibleDiscount)}</dd><dt>Promo discount</dt><dd>{money(comparison.promoDiscount)}</dd><dt className="font-semibold">Discount applied (larger amount)</dt><dd className="font-semibold">{money(comparison.amount)}</dd><dt>New total</dt><dd>{money(Number(detail.bill.total_amount) + Number(detail.bill.discount_amount ?? 0) - comparison.amount)}</dd></dl> : <p role="alert">Enter a whole-number eligible count from 0 to {detail.headCount}.</p>}
      <label className="block">Verification / reason<textarea aria-label="Discount verification reason" minLength={5} maxLength={1000} value={reason} onChange={e => setReason(e.target.value)} className="admin-field mt-1 w-full" /></label>
      <button type="button" onClick={() => void save()} disabled={checkingPromo || !comparison || reason.trim().length < 5 || eligible === ""} className="admin-button-primary">{busy ? "Updating..." : "Update discount and bill"}</button>
      {detail.locked && <p>This booking is locked for changes. Resolve open reviews or refunds first.</p>}
    </fieldset>}
    {message && <p role="status">{message}</p>}{error && <p role="alert" className="text-red-700">{error}<button type="button" disabled={busy} className="ml-2 underline" onClick={() => setReload(n => n + 1)}>Reload discount</button></p>}
  </section>;
}
