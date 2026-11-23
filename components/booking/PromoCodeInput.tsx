"use client";

import { useState } from "react";
import type { PromoQuote } from "@/lib/booking/discounts";

export default function PromoCodeInput({ promo, onChange, onBusyChange }: { promo?: PromoQuote | null; onChange: (promo: PromoQuote | null) => void; onBusyChange?: (busy: boolean) => void }) {
  const [code, setCode] = useState(promo?.code ?? ""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function apply() {
    if (busy) return;
    setBusy(true); onBusyChange?.(true); setError("");
    try {
      const response = await fetch("/api/promos/quote", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.message);
      onChange(data.promo);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to apply promo."); }
    finally { setBusy(false); onBusyChange?.(false); }
  }
  return <section className="rounded-xl border border-neutral/15 p-4 text-sm">
    <label className="block font-medium">Promo / voucher code<input aria-label="Promo code" maxLength={40} value={code} onChange={event => { setCode(event.target.value.toUpperCase()); setError(""); }} className="admin-field mt-2 w-full" /></label>
    <div className="mt-3 flex gap-3"><button type="button" disabled={busy || !code.trim()} onClick={() => void apply()} className="admin-button-secondary">{busy ? "Checking..." : "Apply code"}</button>{promo && <button type="button" disabled={busy} onClick={() => { onChange(null); setCode(""); }} className="admin-button-secondary">Remove code</button>}</div>
    {promo && <p role="status" className="mt-2">{promo.code} applied. The larger of this promo and any staff-verified PWD/senior discount is used; discounts do not stack.</p>}
    {promo?.remainingUses !== undefined && <p className="mt-2 text-neutral/70">{promo.remainingUses} {promo.remainingUses === 1 ? "use" : "uses"} currently available. A slot is held when you save your booking; a use is counted on confirmation. Availability is checked again when saving.</p>}
    {error && <p role="alert" className="mt-2 text-red-700">{error}</p>}
  </section>;
}
