"use client";

import { useEffect, useState } from "react";
import type { BillingBreakdown } from "@/lib/booking/billing-breakdown";

const money = (value: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(value);

export default function BookingAmountBreakdown({ reservationId, totalAmount }: { reservationId: string; totalAmount: number }) {
  const [breakdown, setBreakdown] = useState<BillingBreakdown | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setBreakdown(null); setError("");
    void (async () => {
      try {
        const response = await fetch(`/api/reservations/billing-breakdown?reservationId=${encodeURIComponent(reservationId)}`, { cache: "no-store" });
        const result = await response.json();
        if (!response.ok || !result.breakdown) throw new Error("Unable to load the amount breakdown.");
        if (active) setBreakdown(result.breakdown);
      } catch { if (active) setError("Unable to load the amount breakdown."); }
    })();
    return () => { active = false; };
  }, [reservationId, totalAmount, retry]);

  return <section aria-label="Amount breakdown" className="rounded-2xl border border-neutral/10 p-5 text-sm">
    <h3 className="font-semibold">Amount breakdown</h3>
    {error ? <p role="status" className="mt-3 text-neutral/65">{error} <button type="button" onClick={() => setRetry(value => value + 1)} className="min-h-11 font-medium text-primary underline">Retry</button></p>
      : !breakdown ? <p role="status" className="mt-3 text-neutral/60">Loading charges…</p>
        : <><dl className="mt-3 space-y-3">{breakdown.lines.map((line, index) => <div key={index} className="flex items-start justify-between gap-4">
          <dt className="min-w-0"><span>{line.description}</span>{line.description !== "Private pool package and guest charges" && line.quantity > 1 && <span className="mt-1 block text-xs text-neutral/55">{line.quantity} × {money(line.unitPrice)}</span>}</dt>
          <dd className="shrink-0 whitespace-nowrap text-right tabular-nums">{money(line.amount)}</dd>
        </div>)}<div className="flex justify-between gap-4 border-t border-neutral/10 pt-3 font-semibold"><dt>Total reservation amount</dt><dd className="shrink-0 whitespace-nowrap tabular-nums">{money(breakdown.total)}</dd></div></dl>
          <p className="mt-3 text-xs text-neutral/60">Reschedule fees are included in the total and are non-refundable. Payments below reduce the remaining balance.</p></>}
  </section>;
}
