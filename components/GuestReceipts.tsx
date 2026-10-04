"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Booking = { id: string; reference: string };
type Receipt = { receipt_id: string; payment_id: string; receipt_number: string; issued_at: string;
  amount_paid: number | null; billed_to_name: string | null; balance_after_payment: number | null };

export default function GuestReceipts({ bookings }: { bookings: Booking[] }) {
  const [receipts, setReceipts] = useState<Array<Receipt & { reservationReference: string }>>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!bookings.length) return;
    let active = true;
    const load = async () => {
      const client = createClient();
      const { data: payments, error: paymentError } = await client.from("payments")
        .select("payment_id, reservation_id").in("reservation_id", bookings.map((booking) => booking.id)).eq("status", "verified");
      if (paymentError) { if (active) setError("Unable to load payment receipts."); return; }
      const paymentIds = (payments ?? []).map((payment) => payment.payment_id);
      if (!paymentIds.length) { if (active) setReceipts([]); return; }
      const { data, error: receiptError } = await client.from("receipts")
        .select("receipt_id, payment_id, receipt_number, issued_at, amount_paid, billed_to_name, balance_after_payment")
        .in("payment_id", paymentIds).order("issued_at", { ascending: false });
      if (!active) return;
      if (receiptError) { setError("Unable to load payment receipts."); return; }
      const referenceById = new Map(bookings.map((booking) => [booking.id, booking.reference]));
      const reservationByPayment = new Map((payments ?? []).map((payment) => [payment.payment_id, payment.reservation_id]));
      setReceipts((data ?? []).map((receipt) => ({ ...receipt,
        reservationReference: referenceById.get(reservationByPayment.get(receipt.payment_id) ?? "") ?? "-" })));
      setError(null);
    };
    void load();
    const timer = window.setInterval(() => void load(), 30_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [bookings]);
  if (!receipts.length && !error) return null;
  return <section className="mt-8 rounded-xl border border-neutral/10 p-4">
    <h3 className="mb-3 text-lg font-semibold">Payment receipts</h3>
    {error && <p role="alert" className="text-sm">{error}</p>}
    <div className="space-y-3">{receipts.map((receipt) => <div key={receipt.receipt_id} className="rounded-lg bg-base p-3 text-sm">
      <p className="font-semibold">{receipt.receipt_number} · {receipt.reservationReference}</p>
      <p>Billed to: {receipt.billed_to_name || "Guest"}</p>
      <p>Amount paid: {new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(Number(receipt.amount_paid ?? 0))}</p>
      <p>Balance after payment: {new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(Number(receipt.balance_after_payment ?? 0))}</p>
      <p>Issued {new Date(receipt.issued_at).toLocaleString("en-PH")}</p>
    </div>)}</div>
  </section>;
}
