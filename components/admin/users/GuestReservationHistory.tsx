"use client";

import { useEffect, useState } from "react";
import LoadingState from "@/components/ui/LoadingState";
import CatalogDialog from "@/components/admin/catalog/CatalogDialog";
import AdminStatusBadge from "@/components/admin/AdminStatusBadge";
import { manilaDateKey } from "@/lib/booking/manila-date";
import { GUEST_HISTORY_PAGE_SIZE, type GuestReservationHistoryRow } from "@/lib/booking/guest-history";

const dateTime = (value: string) => new Date(value).toLocaleString("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" });
const money = (value: number | null) => value === null ? "Not recorded" : new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(value);
const title = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, letter => letter.toUpperCase());

export default function GuestReservationHistory({ guestId, name, email, onClose }: { guestId: string; name: string; email: string; onClose: () => void }) {
  const [page, setPage] = useState(0), [reload, setReload] = useState(0);
  const [result, setResult] = useState<{ rows: GuestReservationHistoryRow[]; total: number } | null>(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      setLoading(true); setError("");
      try {
        const response = await fetch(`/api/admin/users/guests/${encodeURIComponent(guestId)}/reservations?page=${page}`, { cache: "no-store", signal: controller.signal });
        const data = await response.json();
        if (!response.ok || !data.success || !Array.isArray(data.rows)) throw new Error(data.message ?? "Unable to load this guest's reservations.");
        if (!controller.signal.aborted) setResult({ rows: data.rows, total: data.total });
      } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Unable to load this guest's reservations."); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    };
    void load();
    return () => controller.abort();
  }, [guestId, page, reload]);
  return <CatalogDialog title="Guest booking history" description={`${name} (${email})`} busy={false} onClose={onClose}>
    <div className="min-w-0 space-y-4 [overflow-wrap:anywhere]">
      <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-neutral/65">All reservations linked to this account, including completed and cancelled bookings. Times are Philippine time.</p>
        <button type="button" disabled={loading} onClick={() => setReload(value => value + 1)} className="admin-button-secondary">Refresh history</button></div>
      {loading ? <LoadingState title="Loading reservation history..." description="Fetching this guest's bookings and recorded balances." />
        : error ? <div role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-800">{error}<button type="button" onClick={() => setReload(value => value + 1)} className="ml-2 min-h-11 font-semibold underline">Try again</button></div>
          : result && <>
            <p className="text-sm font-medium">{result.total} {result.total === 1 ? "reservation" : "reservations"}</p>
            {!result.rows.length && <p className="rounded-xl bg-base p-5 text-sm text-neutral/65">{page === 0 ? "This guest has no booking or reservation records yet." : "There are no reservations on this page. Go back to the previous page or refresh the history."}</p>}
            {result.rows.map(row => <article key={row.id} aria-label={`Reservation ${row.reference}`} className="min-w-0 rounded-xl border border-neutral/15 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="break-all text-sm font-semibold text-primary">{row.reference}</h3><AdminStatusBadge status={title(row.status)} /></div>
              <dl className="mt-4 grid min-w-0 gap-3 text-sm sm:grid-cols-2">
                <div><dt className="text-xs text-neutral/60">Scheduled check-in</dt><dd className="mt-1">{dateTime(row.startDatetime)}</dd></div>
                <div><dt className="text-xs text-neutral/60">Scheduled check-out</dt><dd className="mt-1">{dateTime(row.endDatetime)}</dd></div>
                <div><dt className="text-xs text-neutral/60">Package / guests</dt><dd className="mt-1">{title(row.bookingMode ?? "custom")} &middot; {row.adults} adults, {row.children} children</dd></div>
                <div><dt className="text-xs text-neutral/60">Booked on</dt><dd className="mt-1">{dateTime(row.createdAt)}</dd></div>
                <div><dt className="text-xs text-neutral/60">Recorded bill</dt><dd className="mt-1 font-medium">{money(row.totalAmount)}</dd></div>
                <div><dt className="text-xs text-neutral/60">Recorded net payments</dt><dd className="mt-1">{money(row.paidAmount)}</dd></div>
                <div><dt className="text-xs text-neutral/60">Balance</dt><dd className="mt-1">{["cancelled", "expired", "rejected"].includes(row.status) ? "Closed booking" : money(row.balance)}</dd></div>
                {(row.checkedInAt || row.checkedOutAt) && <div><dt className="text-xs text-neutral/60">Recorded attendance</dt><dd className="mt-1">{row.checkedInAt && <>Checked in {dateTime(row.checkedInAt)}.</>} {row.checkedOutAt && <>Checked out {dateTime(row.checkedOutAt)}.</>}</dd></div>}
              </dl>
              <a href={`/admin/reservations?${new URLSearchParams({ reservation: row.id, date: manilaDateKey(row.startDatetime) })}`} target="_blank" rel="noopener noreferrer" title="Open reservation in a new tab" className="admin-button-secondary mt-4 w-full sm:w-auto">Open reservation <span aria-hidden="true">↗</span><span className="sr-only"> in a new tab</span></a>
            </article>)}
          </>}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-neutral/10 pt-4 text-sm">
        <p className="text-neutral/60">Page {page + 1}{result ? ` of ${Math.max(1, Math.ceil(result.total / GUEST_HISTORY_PAGE_SIZE))}` : ""}</p>
        <div className="flex flex-wrap gap-2"><button type="button" disabled={loading || page === 0} onClick={() => setPage(value => value - 1)} className="admin-button-secondary">Previous history page</button>
          <button type="button" disabled={loading || Boolean(error) || !result || (page + 1) * GUEST_HISTORY_PAGE_SIZE >= result.total} onClick={() => setPage(value => value + 1)} className="admin-button-secondary">Next history page</button></div>
      </div>
    </div>
  </CatalogDialog>;
}
