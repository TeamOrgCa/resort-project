"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import CatalogDialog from "@/components/admin/catalog/CatalogDialog";
import type { GuestFeedbackItem } from "@/lib/reviews/feedback";

type FeedbackPage = { rows: GuestFeedbackItem[]; total: number; pageSize: number; canArchive: boolean };
export default function GuestFeedbackPanel({ query, revision, onChanged }: { query: string; revision: number; onChanged: () => void }) {
  const [status, setStatus] = useState("active"), [search, setSearch] = useState(""), [term, setTerm] = useState("");
  const [page, setPage] = useState(0), [reload, setReload] = useState(0);
  const [result, setResult] = useState<{ key: string; data: FeedbackPage } | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const [selected, setSelected] = useState<GuestFeedbackItem | null>(null), [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false), [dialogError, setDialogError] = useState(""), [message, setMessage] = useState("");
  const saving = useRef(false);
  const key = `${query}:${revision}:${reload}:${status}:${term}:${page}`;
  const data = result?.key === key ? result.data : null, error = failure?.key === key ? failure.message : null;
  const loading = !data && !error;
  useEffect(() => {
    if (search.trim() === term) return;
    const timer = window.setTimeout(() => { setTerm(search.trim()); setPage(0); }, 250);
    return () => window.clearTimeout(timer);
  }, [search, term]);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/admin/analytics/feedback?${query}&status=${status}&search=${encodeURIComponent(term)}&page=${page}`, { cache: "no-store", signal: controller.signal });
        const payload = await response.json();
        if (!response.ok || !payload.success) throw new Error(payload.message ?? "Unable to load guest feedback.");
        if (!controller.signal.aborted) setResult({ key, data: payload });
      } catch (cause) { if (!controller.signal.aborted) setFailure({ key, message: cause instanceof Error ? cause.message : "Unable to load guest feedback." }); }
    })();
    return () => controller.abort();
  }, [key, page, query, status, term]);
  const close = useCallback(() => { if (!saving.current) setSelected(null); }, []);
  async function save(event: React.FormEvent) {
    event.preventDefault(); if (!selected || saving.current) return;
    if (reason.trim().length < 3) { setDialogError("Enter a reason between 3 and 500 characters."); return; }
    saving.current = true; setBusy(true); setDialogError(""); setMessage("");
    try {
      const response = await fetch("/api/admin/analytics/feedback", { method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewId: selected.review_id, archive: !selected.archived_at, reason: reason.trim(), expectedArchivedAt: selected.archived_at }) });
      const payload = await response.json(); if (!response.ok || !payload.success) throw new Error(payload.message ?? "Unable to update feedback.");
      setMessage(payload.message); setSelected(null); setPage(0); setReload(value => value + 1); onChanged();
    } catch (cause) { setDialogError(cause instanceof Error ? cause.message : "Unable to update feedback."); }
    finally { saving.current = false; setBusy(false); }
  }
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  return <section aria-label="Guest review records" className="mt-5 space-y-4 rounded-xl border border-neutral/15 p-3 sm:p-5">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-semibold">Guest reviews</h2><p className="mt-1 text-sm text-neutral/70">Actual reviews submitted during the selected dates. Archived reviews are retained for documentation and excluded from public reviews and new analysis.</p></div>
      <button type="button" disabled={loading || busy} onClick={() => setReload(value => value + 1)} className="min-h-11 rounded-xl border border-neutral/20 px-3 py-2 text-sm disabled:opacity-50">Refresh reviews</button></div>
    <div className="flex flex-wrap gap-3"><label className="min-w-0 flex-1 text-sm">Search review text<input type="search" value={search} onChange={e => setSearch(e.target.value)} maxLength={200} placeholder="Filter as you type" className="mt-1 min-h-11 w-full rounded-xl border border-neutral/20 bg-white px-3 text-black" /></label>
      <label className="text-sm">Feedback status<select value={status} onChange={e => { setStatus(e.target.value); setPage(0); }} className="mt-1 block min-h-11 rounded-xl border border-neutral/20 bg-white px-3 text-black"><option value="active">Active</option><option value="archived">Archived</option><option value="all">All feedback</option></select></label></div>
    {message && <p role="status" className="rounded-xl bg-green-50 p-3 text-sm text-green-800">{message}</p>}
    {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}<button type="button" onClick={() => setReload(value => value + 1)} className="ml-2 min-h-11 underline">Retry reviews</button></p>}
    {loading && <p role="status" className="py-5 text-sm">Loading guest reviews...</p>}
    {data && <>
      {!data.canArchive && <p className="text-xs text-neutral/65">Your role can view feedback. An administrator can grant Archive and restore guest feedback in the Role Permission Matrix.</p>}
      <p className="text-xs text-neutral/65">{data.total.toLocaleString("en-PH")} matching reviews. {data.total > 0 && `Page ${page + 1} of ${pages}.`}</p>
      {data.rows.length === 0 && <p className="rounded-xl bg-base p-5 text-sm">No guest reviews match these dates and filters. Try another period or feedback status.</p>}
      <div className="space-y-3">{data.rows.map(review => <article key={review.review_id} className="min-w-0 rounded-xl border border-neutral/15 bg-base p-4 [overflow-wrap:anywhere]">
        <div className="flex flex-wrap justify-between gap-3"><div><p className="font-semibold">{review.public_display_name || "Guest"} <span className="ml-2 text-sm text-primary">{review.overall_rating}/5</span></p><p className="mt-1 text-xs text-neutral/65">{new Date(review.created_at).toLocaleString("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" })} (PH)</p></div>
          <span className="text-xs font-semibold">{review.archived_at ? "Archived" : review.is_approved ? "Published" : "Awaiting review"}</span></div>
        <h3 className="mt-3 font-semibold">{review.title}</h3><p className="mt-2 whitespace-pre-wrap text-sm text-neutral/80">{review.review_text.length > 450 ? review.review_text.slice(0, 450) + "..." : review.review_text}</p>
        {review.review_text.length > 450 && <details className="mt-2 text-sm"><summary className="min-h-11 cursor-pointer font-medium text-primary">Read full review</summary><p className="whitespace-pre-wrap">{review.review_text}</p></details>}
        {review.image_url && <a href={review.image_url} target="_blank" rel="noopener noreferrer" className="mt-3 inline-block"><Image unoptimized src={review.image_url} alt="Guest's attached review photo" width={180} height={120} className="max-h-32 rounded-xl object-cover" /><span className="mt-1 block text-xs text-primary underline">View attached photo</span></a>}
        {review.archived_at && <p className="mt-3 text-xs text-neutral/70">Archive reason: {review.archive_reason || "Not recorded"}</p>}
        {data.canArchive && <button type="button" onClick={() => { setSelected(review); setReason(""); setDialogError(""); }} className="mt-3 min-h-11 rounded-xl border border-neutral/20 bg-white px-3 py-2 text-sm font-medium">{review.archived_at ? "Restore feedback" : "Archive feedback"}</button>}
      </article>)}</div>
      <div className="flex flex-wrap items-center justify-between gap-3"><button type="button" disabled={page === 0 || busy} onClick={() => setPage(value => value - 1)} className="min-h-11 rounded-xl border px-4 py-2 text-sm disabled:opacity-40">Previous reviews</button><button type="button" disabled={page + 1 >= pages || busy} onClick={() => setPage(value => value + 1)} className="min-h-11 rounded-xl border px-4 py-2 text-sm disabled:opacity-40">Next reviews</button></div>
    </>}
    {selected && <CatalogDialog title={selected.archived_at ? "Restore guest feedback" : "Archive guest feedback"} description={selected.archived_at ? "Return this review to the active list. Its approval status will be retained." : "Hide this review from the public feed and future analysis. Its text and photo will be retained."} busy={busy} onClose={close}>
      <form onSubmit={save} className="space-y-4"><p className="font-medium">{selected.title}</p><label className="block text-sm">Reason<textarea data-autofocus required minLength={3} maxLength={500} value={reason} disabled={busy} onChange={e => setReason(e.target.value)} className="mt-2 min-h-24 w-full rounded-xl border border-neutral/20 p-3 text-black" /></label>
        {dialogError && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{dialogError}</p>}
        <div className="flex flex-wrap justify-end gap-2"><button type="button" disabled={busy} onClick={close} className="min-h-11 rounded-xl border px-4 py-2 text-sm">Cancel</button><button type="submit" disabled={busy} className="min-h-11 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Saving..." : selected.archived_at ? "Confirm restore" : "Confirm archive"}</button></div>
      </form>
    </CatalogDialog>}
  </section>;
}
