"use client";

import { useEffect, useState } from "react";
import LoadingState from "@/components/ui/LoadingState";
import type { ReservationRecordDetail } from "@/lib/booking/reservation-record";

const dateTime = (value: string | null) => value ? new Date(value).toLocaleString("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" }) : "Not recorded";
const title = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, letter => letter.toUpperCase());
const money = (value: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(value);

export default function ReservationRecordDetails({ reservationId }: { reservationId: string }) {
  const [detail, setDetail] = useState<ReservationRecordDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/admin/records/reservations/${encodeURIComponent(reservationId)}`, { cache: "no-store", signal: controller.signal })
      .then(async response => {
        const data = await response.json();
        if (!response.ok || !data.detail?.reservation) throw new Error(data.message ?? "Unable to load the reservation record.");
        if (!controller.signal.aborted) { setDetail(data.detail); setError(null); }
      }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Unable to load the reservation record."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [reservationId, reload]);
  if (loading) return <LoadingState title="Loading reservation record..." description="Fetching guest, schedule and billing details." />;
  if (error || !detail) return <div><p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-800">{error ?? "Record unavailable."}</p>
    <button type="button" onClick={() => { setLoading(true); setDetail(null); setError(null); setReload(value => value + 1); }} className="mt-3 min-h-11 rounded-xl border px-4 py-2 text-sm">Retry details</button></div>;
  const r = detail.reservation;
  const guestName = detail.guest ? `${detail.guest.first_name ?? ""} ${detail.guest.last_name ?? ""}`.trim() : "";
  const lines = (items: ReservationRecordDetail["services"]) => <ul className="mt-2 space-y-2">{items.map((item, index) => <li key={index} className="flex flex-wrap justify-between gap-2 text-sm"><span>{item.quantity} × {item.name}</span><span>{money(item.price)} each</span></li>)}</ul>;
  return <div className="space-y-5 text-sm text-neutral">
    <section className="rounded-xl border border-neutral/10 p-4"><h3 className="font-semibold">Guest details</h3>
      <dl className="mt-3 grid gap-3 sm:grid-cols-2">{[
        ["Guest", guestName || "Guest profile unavailable"], ["Booking source", r.booking_type === "walk_in" || r.walk_in_guest_id ? "Staff entry / Walk-in" : "Online"],
        ["Email", detail.guest?.email || "Not provided"], ["Phone", detail.guest?.phone_number || "Not provided"], ["Address", detail.guest?.address || "Not provided"],
      ].map(([label, value]) => <div key={label}><dt className="text-neutral/60">{label}</dt><dd className="mt-1 break-words font-medium">{value}</dd></div>)}</dl>
    </section>
    <section className="rounded-xl border border-neutral/10 p-4"><h3 className="font-semibold">Reservation details</h3>
      <dl className="mt-3 grid gap-3 sm:grid-cols-2">{[
        ["Reference", r.reference_number], ["Status", title(r.status)], ["Package", title(r.booking_mode ?? "Unspecified")],
        ["Guests", `${r.adult_count} adults, ${r.child_count} children`], ["Scheduled arrival", dateTime(r.start_datetime)], ["Scheduled departure", dateTime(r.end_datetime)],
        ["Actual check-in", dateTime(r.checked_in_at)], ["Actual checkout", dateTime(r.checked_out_at)], ["Booking created", dateTime(r.created_at)],
      ].map(([label, value]) => <div key={label}><dt className="text-neutral/60">{label}</dt><dd className="mt-1 break-words font-medium">{value}</dd></div>)}</dl>
    </section>
    <section className="rounded-xl border border-neutral/10 p-4"><h3 className="font-semibold">Accommodation</h3>{detail.units.length ? lines(detail.units) : <p className="mt-2 text-neutral/60">No accommodation recorded.</p>}</section>
    <section className="rounded-xl border border-neutral/10 p-4"><h3 className="font-semibold">Additional services</h3>{detail.services.length ? lines(detail.services) : <p className="mt-2 text-neutral/60">No additional services recorded.</p>}</section>
    <section className="rounded-xl border border-neutral/10 p-4"><h3 className="font-semibold">Recorded bill</h3>{detail.bill ? <dl className="mt-3 grid grid-cols-[1fr_auto] gap-2">
      <dt>Total</dt><dd>{money(detail.bill.total)}</dd><dt>Net verified payments</dt><dd>{money(detail.bill.paid)}</dd>
      <dt>Remaining balance</dt><dd className="font-semibold">{money(detail.bill.balance)}</dd><dt>Payment status</dt><dd>{title(detail.bill.status)}</dd>
    </dl> : <p className="mt-2 text-neutral/60">No billing record available.</p>}</section>
    <section className="rounded-xl border border-neutral/10 p-4"><h3 className="font-semibold">Special requests / staff notes</h3><p className="mt-2 whitespace-pre-wrap break-words">{r.special_requests || "None recorded."}</p></section>
  </div>;
}
