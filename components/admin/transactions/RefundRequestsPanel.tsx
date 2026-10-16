"use client";

import { useCallback, useEffect, useState } from "react";
import CatalogDialog from "@/components/admin/catalog/CatalogDialog";
import AdminStatusBadge from "@/components/admin/AdminStatusBadge";
import { createClient } from "@/lib/supabase/client";
import { refundStatusLabels, type CancellationPreview } from "@/lib/booking/cancellation";

type Refund = { refund_id: string; reservation_id: string; amount: number; request_kind: string; policy_snapshot: string;
  policy_version: number | null; calculation_snapshot: CancellationPreview | null; workflow_version: number; status: string; requested_at: string;
  review_reason: string | null; payment_review_notes: string | null; payment_reviewed_at: string | null;
  payout_submitted_by: string | null; payout_submitted_at: string | null; payout_verification_notes: string | null;
  refunded_at: string | null; gcash_reference: string | null; proof_path: string | null };
type Payment = { payment_id: string; reservation_id: string; amount: number; status: string; reference_number: string; payment_type: string; verified_at: string | null; proof_path: string | null };
type Bill = { reservation_id: string; total_amount: number; paid_amount: number };
type Permissions = { canReview: boolean; canApprove: boolean; canPay: boolean; canVerify: boolean; canVerifyOwnPayout: boolean; staffId: string };
const money = (n: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(Number(n));
const at = (value: string) => new Date(value).toLocaleString("en-PH", { timeZone: "Asia/Manila" });
const button = "admin-button-secondary";

export default function RefundRequestsPanel({ onUpdated }: { onUpdated?: () => void }) {
  const [refunds, setRefunds] = useState<Refund[]>([]), [payments, setPayments] = useState<Payment[]>([]), [bills, setBills] = useState<Bill[]>([]);
  const [refs, setRefs] = useState<Record<string, string>>({});
  const [permissions, setPermissions] = useState<Permissions>({ canReview: false, canApprove: false, canPay: false, canVerify: false, canVerifyOwnPayout: false, staffId: "" });
  const [selectedId, setSelectedId] = useState<string | null>(null), [filter, setFilter] = useState("all");
  const [reason, setReason] = useState(""), [reference, setReference] = useState(""), [proof, setProof] = useState<File | null>(null), [verified, setVerified] = useState(false);
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(true), [error, setError] = useState<string | null>(null), [message, setMessage] = useState<string | null>(null);
  const [proofLink, setProofLink] = useState<string | null>(null);
  const [legacyInitiator, setLegacyInitiator] = useState("guest");
  const [methods, setMethods] = useState<{ payment_method_id: string; name: string }[]>([]), [method, setMethod] = useState("GCash");
  const selected = refunds.find(f => f.refund_id === selectedId) ?? null;
  const legacy = selected?.workflow_version === 1 && selected.request_kind === "cancellation";
  const load = useCallback(async () => {
    const response = await fetch("/api/admin/refunds", { cache: "no-store" });
    const data = await response.json(); if (!response.ok) throw new Error(data.message ?? "Unable to load refunds.");
    setRefunds(data.refunds ?? []); setPayments(data.payments ?? []); setBills(data.bills ?? []); setPermissions(data.permissions ?? { canReview: false, canApprove: false, canPay: false, canVerify: false, canVerifyOwnPayout: false, staffId: "" });
    setRefs(Object.fromEntries((data.reservations ?? []).map((r: { reservation_id: string; reference_number: string }) => [r.reservation_id, r.reference_number])));
    setMethods(data.paymentMethods ?? []);
    setMethod(current => (data.paymentMethods ?? []).some((m: { name: string }) => m.name === current) ? current : data.paymentMethods?.[0]?.name ?? "");
  }, []);
  useEffect(() => { void load().catch(cause => setError(cause instanceof Error ? cause.message : "Unable to load refunds.")).finally(() => setLoading(false)); }, [load]);
  const refresh = async () => { setLoading(true); setError(null); try { await load(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to refresh refunds."); } finally { setLoading(false); } };
  async function submit(action: string) {
    if (!selected || busy) return;
    setBusy(true); setError(null); setMessage(null);
    try {
      const form = new FormData(); form.set("refundId", selected.refund_id); form.set("action", action);
      form.set("reason", reason); form.set("reference", reference); form.set("verified", String(verified)); form.set("initiator", legacyInitiator); form.set("method", method || "GCash"); if (proof) form.set("proof", proof);
      const response = await fetch("/api/admin/refunds", { method: "POST", body: form }); const data = await response.json();
      if (!response.ok) throw new Error(data.message ?? "Unable to update refund.");
      setMessage(data.message + (!data.emailSent ? " In-app alerts were recorded; email delivery could not be confirmed." : ""));
      setSelectedId(null); setReason(""); setReference(""); setProof(null); setVerified(false); setProofLink(null);
      onUpdated?.();
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to update refund."); }
    finally { setBusy(false); }
  }
  async function openProof(path: string, bucket = "refund-proofs") {
    setError(null);
    const { data, error } = await createClient().storage.from(bucket).createSignedUrl(path, 300);
    if (error || !data?.signedUrl) { setError("Unable to open proof. Check your permission and retry."); return; }
    setProofLink(data.signedUrl); window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }
  const selectedPayments = payments.filter(p => p.reservation_id === selected?.reservation_id);
  const bill = bills.find(b => b.reservation_id === selected?.reservation_id);
  return <div className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3"><p className="max-w-3xl text-sm text-neutral/70">Cancellation refunds are created automatically. Staff review verified payments, administrators approve or reject, then the manual transfer is documented and verified. Administrators can verify their own documented payout; other staff need a different authorized verifier. Uploading proof does not complete a refund.</p><button disabled={busy || loading} className={button} onClick={() => void refresh()}>Refresh</button></div>
    {message && <p role="status" className="rounded-xl bg-green-50 p-3 text-sm">{message}</p>}
    {error && !selected && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    <label className="flex flex-wrap items-center gap-3 text-sm font-medium">Show requests<select value={filter} onChange={e => setFilter(e.target.value)} className="admin-field"><option value="all">All statuses</option>{Object.entries(refundStatusLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
    {loading && <p role="status" className="text-sm">Loading refund records...</p>}
    <div className="overflow-x-auto rounded-xl border border-neutral/10"><table className="w-full min-w-[640px] text-left text-sm"><thead className="border-b border-neutral/10 bg-base/60 text-neutral/60"><tr>{["Reservation / type", "Refund amount", "Processing status", "Requested (PH)", "Action"].map(label => <th key={label} className="px-4 py-4">{label}</th>)}</tr></thead>
      <tbody>{refunds.filter(f => filter === "all" || f.status === filter).map(f => <tr key={f.refund_id} className="border-t border-neutral/10 hover:bg-base/40"><td className="px-4 py-4">{refs[f.reservation_id] ?? f.reservation_id}<span className="block text-xs text-neutral/60">{f.request_kind === "overpayment" ? "Excess payment" : "Cancelled reservation"}</span></td>
        <td className="px-4 py-4 font-medium">{money(f.amount)}</td><td className="px-4 py-4"><AdminStatusBadge status={refundStatusLabels[f.status] ?? f.status} /></td><td className="px-4 py-4">{at(f.requested_at)}</td>
        <td className="px-4 py-4"><button className="admin-button-secondary" disabled={busy} onClick={() => { setSelectedId(f.refund_id); setReason(""); setReference(""); setProof(null); setVerified(false); setProofLink(null); setError(null); }}>View / process</button></td></tr>)}</tbody></table>
      {!loading && !refunds.some(f => filter === "all" || f.status === filter) && <p className="p-5 text-sm text-neutral/65">No requests match this status.</p>}</div>
    {selected && <CatalogDialog title="Refund details" description={`Refund for ${refs[selected.reservation_id] ?? selected.reservation_id}`} busy={busy} onClose={() => { if (!busy) setSelectedId(null); }}><div className="space-y-4">
      {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</p>}
      <p className="text-sm">{refundStatusLabels[selected.status]} <strong className="ml-2">{money(selected.amount)}</strong></p>
      <p className="text-sm">{selected.policy_snapshot}</p>
      {selected.workflow_version === 1 && selected.request_kind === "cancellation" && !["refunded", "rejected"].includes(selected.status) && <div className="space-y-3 rounded-xl bg-amber-50 p-3 text-sm">
        <p>This legacy request needs an administrator to document whether the guest or resort initiated cancellation and recalculate the refund before processing. Previous approvals will be reset and recorded in the audit log.</p>
        {permissions.canApprove && <><select value={legacyInitiator} onChange={e => setLegacyInitiator(e.target.value)} className="rounded-xl border p-2"><option value="guest">Guest initiated</option><option value="resort">Resort attributable</option></select>
          <button disabled={busy || reason.trim().length < 5} className={button} onClick={() => void submit("recalculate")}>Recalculate legacy cancellation refund</button></>}
      </div>}
      {selected.calculation_snapshot && <dl className="grid grid-cols-2 gap-2 rounded-xl bg-base p-3 text-sm">
        <dt>Verified payments at cancellation</dt><dd className="text-right">{money(selected.calculation_snapshot.verifiedPaid)}</dd>
        <dt>Previous refunds</dt><dd className="text-right">{money(selected.calculation_snapshot.previousRefunds)}</dd>
        <dt>Retained deposit</dt><dd className="text-right">{money(selected.calculation_snapshot.deduction)}</dd>
        <dt>Refund calculated automatically</dt><dd className="text-right font-semibold">{money(selected.amount)}</dd></dl>}
      <p className="text-sm">Recorded bill: {money(bill?.total_amount ?? 0)}; net verified payments after completed refunds: {money(bill?.paid_amount ?? 0)}. A cancelled reservation has no active booking balance to collect.</p>
      <h4 className="font-medium">Payment records</h4>
      <div className="overflow-x-auto rounded-xl border border-neutral/10"><table className="w-full min-w-[600px] text-left text-xs"><thead className="bg-base/60 text-neutral/60"><tr>{["Amount", "Status", "Type", "Reference", "Verified (PH)", "Proof"].map(t => <th key={t} className="p-2">{t}</th>)}</tr></thead><tbody>{selectedPayments.map(p => <tr key={p.payment_id} className="border-t border-neutral/10 hover:bg-base/40">
        <td className="p-2">{money(p.amount)}</td><td className="p-2">{p.status}</td><td className="p-2">{p.payment_type}</td><td className="p-2">{p.reference_number}</td><td className="p-2">{p.verified_at ? at(p.verified_at) : "-"}</td><td className="p-2">{p.proof_path && <button onClick={() => void openProof(p.proof_path!, "payment-proofs")} className="text-primary underline">View</button>}</td></tr>)}</tbody></table></div>
      {selected.payment_review_notes && <p className="text-sm">Cashier review: {selected.payment_review_notes}</p>}
      {selected.review_reason && <p className="text-sm">Administrator decision: {selected.review_reason}</p>}
      {selected.payout_submitted_at && <p className="text-sm">Transfer submitted {at(selected.payout_submitted_at)}. Reference: {selected.gcash_reference}</p>}
      {selected.payout_verification_notes && <p className="text-sm">Verification: {selected.payout_verification_notes}</p>}
      {selected.refunded_at && <p className="text-sm">Refund completed {at(selected.refunded_at)}.</p>}
      {selected.proof_path && <button className="text-sm text-primary underline" onClick={() => void openProof(selected.proof_path!)}>View transfer proof</button>}
      {proofLink && <p className="text-sm"><a href={proofLink} target="_blank" rel="noopener noreferrer" className="text-primary underline">Open proof (if the browser blocked the new tab)</a></p>}
      {!["rejected", "refunded"].includes(selected.status) && <label className="block text-sm font-medium">Review / decision / verification notes<textarea rows={2} maxLength={2000} value={reason} disabled={busy} onChange={e => setReason(e.target.value)} className="admin-field mt-1 w-full" /></label>}
      {selected.status === "pending" && permissions.canReview && !legacy && <div className="space-y-3">
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" disabled={busy} checked={verified} onChange={e => setVerified(e.target.checked)} />I checked actual verified payments, previous refunds and the calculated deduction against the payment records.</label>
        <button className={button} disabled={busy || !verified || reason.trim().length < 5} onClick={() => void submit("reviewed")}>Submit payment review</button></div>}
      {permissions.canApprove && ["pending", "reviewed", "approved"].includes(selected.status) && <div className="flex flex-wrap gap-3">
        {selected.status === "reviewed" && !legacy && <button className={button} disabled={busy} onClick={() => void submit("approved")}>Approve refund</button>}
        <button className={button} disabled={busy || reason.trim().length < 5} onClick={() => void submit("rejected")}>Reject with reason</button></div>}
      {selected.status === "approved" && permissions.canPay && !legacy && <div className="space-y-3 rounded-xl bg-base p-3">
        <p className="text-sm font-medium">Transfer {money(selected.amount)} manually through an approved payment method before submitting this evidence.</p>
        <label className="block text-sm">Payout method<select value={method} disabled={busy} onChange={e => setMethod(e.target.value)} className="admin-field mt-1 w-full">{methods.map(m => <option key={m.payment_method_id} value={m.name}>{m.name}</option>)}</select></label>
        {!methods.length && <p role="alert" className="text-sm text-red-700">An administrator must activate a payment method in Business Catalog before a payout can be recorded.</p>}
        <label className="block text-sm">Transfer reference<input maxLength={100} value={reference} disabled={busy} onChange={e => setReference(e.target.value)} className="admin-field mt-1 w-full" /></label>
        <label className="block text-sm">Transfer proof (image or PDF, up to 8 MB)<input type="file" disabled={busy} accept="image/jpeg,image/png,image/webp,application/pdf" onChange={e => setProof(e.target.files?.[0] ?? null)} className="mt-2 block" /></label>
        <button className={button} disabled={busy || !method || reference.trim().length < 6 || !proof} onClick={() => void submit("payout_submitted")}>Submit transfer for verification</button></div>}
      {selected.status === "payout_submitted" && <div className="space-y-3 rounded-xl bg-amber-50 p-3">
        {selected.payout_submitted_by === permissions.staffId && !permissions.canVerifyOwnPayout ? <p className="text-sm">Another authorized staff member must verify your transfer. You cannot verify your own payout.</p> : permissions.canVerify ? <>
          {selected.payout_submitted_by === permissions.staffId && permissions.canVerifyOwnPayout && <p className="text-sm">As the administrator, you can verify this transfer yourself after checking the provider transaction records.</p>}
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" disabled={busy} checked={verified} onChange={e => setVerified(e.target.checked)} />I checked the transfer amount, recipient, reference and proof against the payment-provider transaction records.</label>
          <button className={button} disabled={busy || !verified || reason.trim().length < 5} onClick={() => void submit("refunded")}>Verify transfer and complete refund</button>
        </> : <p className="text-sm">Awaiting verification by authorized staff.</p>}</div>}
    </div></CatalogDialog>}
  </div>;
}
