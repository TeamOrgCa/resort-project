"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Refund = { refund_id: string; reservation_id: string; amount: number; status: string;
  requested_at: string; review_reason: string | null; gcash_reference: string | null };

export default function GuestRefundStatus() {
  const [refunds, setRefunds] = useState<Refund[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    const load = async () => {
      const { data, error: queryError } = await createClient().from("refund_requests")
        .select("refund_id, reservation_id, amount, status, requested_at, review_reason, gcash_reference")
        .order("requested_at", { ascending: false });
      if (!active) return;
      if (queryError) setError("Unable to load refund requests.");
      else { setError(null); setRefunds(data ?? []); }
    };
    void load();
    const refresh = window.setInterval(() => void load(), 30_000);
    return () => { active = false; window.clearInterval(refresh); };
  }, []);
  if (!refunds.length && !error) return null;
  return <section className="mt-8 rounded-xl border border-neutral/10 p-4">
    <h3 className="mb-3 text-lg font-semibold">Refund requests</h3>
    {error && <p role="alert" className="text-sm">{error}</p>}
    <div className="space-y-3">{refunds.map((refund) => <div key={refund.refund_id} className="rounded-lg bg-base p-3 text-sm">
      <p className="font-semibold capitalize">{refund.status} · {new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(refund.amount)}</p>
      <p>Requested {new Date(refund.requested_at).toLocaleString("en-PH")}</p>
      {refund.review_reason && <p>Review note: {refund.review_reason}</p>}
      {refund.gcash_reference && <p>GCash reference: {refund.gcash_reference}</p>}
    </div>)}</div>
  </section>;
}
