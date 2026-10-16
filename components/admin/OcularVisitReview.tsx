"use client";

import { useRef, useState } from "react";

export default function OcularVisitReview({ visit, canReview, onBusyChange, onReviewed, onRefresh }: {
  visit: { visit_id: string; status: string; review_reason?: string | null };
  canReview: boolean;
  onBusyChange: (busy: boolean) => void;
  onReviewed: (visit: { visit_id: string; status: string; review_reason?: string }) => void;
  onRefresh: () => void;
}) {
  const [reason, setReason] = useState(""), [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null), [message, setMessage] = useState<string | null>(null);
  const submitting = useRef(false);
  async function review(action: "approve" | "reject") {
    if (submitting.current || reason.trim().length < 5 || reason.trim().length > 2000) return;
    submitting.current = true; setBusy(true); onBusyChange(true); setError(null); setMessage(null);
    try {
      const response = await fetch(`/api/admin/ocular-visits/${action}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ visitId: visit.visit_id, reviewReason: reason.trim() }) });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.message ?? "Unable to review this visit.");
      setMessage(data.message + (data.notificationSent === false || data.emailSent === false ? " The decision was saved, but some guest notifications could not be delivered." : ""));
      onReviewed(data.visit); setReason("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to review this visit. Refresh before retrying if the connection was interrupted."); }
    finally { submitting.current = false; setBusy(false); onBusyChange(false); }
  }
  return <section aria-label="Ocular visit review" className="space-y-3 rounded-xl border border-neutral/10 p-4">
    <h3 className="font-semibold">Staff review</h3>
    {visit.review_reason && <p className="text-sm text-neutral/75">Review reason: {visit.review_reason}</p>}
    {message && <p role="status" className="rounded-xl bg-green-50 p-3 text-sm text-green-900">{message}</p>}
    {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{error} <button type="button" onClick={onRefresh} className="min-h-11 underline">Refresh visit</button></p>}
    {canReview && visit.status === "pending" ? <>
      <label className="block text-sm font-medium">Review reason (required)<textarea aria-label="Ocular review reason" rows={3} minLength={5} maxLength={2000} disabled={busy} value={reason} onChange={event => setReason(event.target.value)} className="admin-field mt-2 w-full" placeholder="Explain the approval or rejection. This reason will be shared with the guest." /></label>
      <div className="flex flex-wrap gap-2"><button type="button" disabled={busy || reason.trim().length < 5} onClick={() => void review("approve")} className="admin-button-primary">{busy ? "Saving..." : "Approve ocular visit"}</button><button type="button" disabled={busy || reason.trim().length < 5} onClick={() => void review("reject")} className="admin-button-secondary border-red-200 text-red-700">Reject ocular visit</button></div>
    </> : visit.status === "pending" ? <p className="text-sm text-neutral/65">Ocular approval permission is required to approve or reject this request.</p> : <p className="text-sm text-neutral/65">This visit has already been reviewed or closed.</p>}
  </section>;
}
