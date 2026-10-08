"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { hasPermission } from "@/lib/auth/role-access";
import type { StaffRole } from "@/lib/auth/staff-auth";

type Refund = { refund_id: string; reservation_id: string; amount: number; policy_snapshot: string; policy_version: number | null;
  status: "pending" | "approved" | "rejected" | "refunded"; requested_at: string; reviewed_at: string | null;
  review_reason: string | null; refunded_at: string | null; gcash_reference: string | null; proof_path: string | null };

export default function RefundRequestsPanel() {
  const [refunds, setRefunds] = useState<Refund[]>([]);
  const [refs, setRefs] = useState<Record<string, string>>({});
  const [canReview, setCanReview] = useState(false);
  const [canPay, setCanPay] = useState(false);
  const [selected, setSelected] = useState<Refund | null>(null);
  const [reason, setReason] = useState("");
  const [reference, setReference] = useState("");
  const [proof, setProof] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = async () => {
    const response = await fetch("/api/admin/refunds", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message ?? "Unable to load refunds.");
    setRefunds(data.refunds ?? []);
    setRefs(Object.fromEntries((data.reservations ?? []).map((row: { reservation_id: string; reference_number: string }) => [row.reservation_id, row.reference_number])));
  };
  useEffect(() => {
    void load().catch((cause) => setError(cause instanceof Error ? cause.message : "Unable to load refunds."));
    void (async () => {
      const client = createClient();
      const { data: { user } } = await client.auth.getUser();
      if (!user) return;
      const { data } = await client.from("staff_users").select("role").eq("id", user.id).maybeSingle();
      if (!data?.role) return;
      const role = data.role as StaffRole;
      const { data: grants } = role === "admin" ? { data: null } : await client.from("role_permissions").select("permissions").eq("role", role).maybeSingle();
      const permissions = grants?.permissions ?? [];
      setCanReview(hasPermission(role, permissions, "refund_review"));
      setCanPay(hasPermission(role, permissions, "refund_payout"));
    })();
  }, []);

  const submit = async (action: "approved" | "rejected" | "refunded") => {
    if (!selected) return;
    setBusy(true); setError(null); setMessage(null);
    try {
      const form = new FormData();
      form.set("refundId", selected.refund_id); form.set("action", action);
      form.set("reason", reason); form.set("reference", reference);
      if (proof) form.set("proof", proof);
      const response = await fetch("/api/admin/refunds", { method: "POST", body: form });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? "Unable to update refund.");
      setMessage(result.notificationError ? `Refund updated. Guest alert failed: ${result.notificationError}` : `Refund ${action}.`);
      setSelected(null); setReason(""); setReference(""); setProof(null);
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to update refund."); }
    finally { setBusy(false); }
  };

  const openProof = async (path: string) => {
    setError(null);
    const { data, error: signedError } = await createClient().storage.from("refund-proofs").createSignedUrl(path, 300);
    if (signedError || !data?.signedUrl) { setError("Unable to open refund proof."); return; }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };

  return <div className="space-y-4">
    <p className="text-sm text-neutral/70">Cancellation creates a pending refund request for verified payments when the booking policy enables review. Review its policy snapshot before approving. Record the GCash transfer and upload proof after sending it.</p>
    {message && <p role="status" className="rounded bg-green-50 p-3 text-sm">{message}</p>}
    {error && <p role="alert" className="rounded bg-red-50 p-3 text-sm">{error}</p>}
    <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b"><th className="p-2">Reservation</th><th className="p-2">Amount</th><th className="p-2">Status</th><th className="p-2">Requested</th><th className="p-2">Action</th></tr></thead>
      <tbody>{refunds.map((refund) => <tr key={refund.refund_id} className="border-b">
        <td className="p-2">{refs[refund.reservation_id] ?? refund.reservation_id}</td>
        <td className="p-2">{new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(refund.amount)}</td>
        <td className="p-2 capitalize">{refund.status}</td>
        <td className="p-2">{new Date(refund.requested_at).toLocaleString("en-PH")}</td>
        <td className="p-2"><button type="button" className="text-primary underline" onClick={() => { setSelected(refund); setError(null); }}>Review</button></td>
      </tr>)}</tbody></table>{refunds.length === 0 && <p className="p-4 text-sm text-neutral/60">No refund requests.</p>}</div>
    {selected && <div className="rounded-xl border p-4 text-sm">
      <div className="mb-3 flex justify-between"><strong>Refund for {refs[selected.reservation_id] ?? selected.reservation_id}</strong><button type="button" onClick={() => setSelected(null)}>Close</button></div>
      <p><strong>Status:</strong> {selected.status}</p><p><strong>Policy version:</strong> {selected.policy_version ?? "Legacy"}</p><p className="whitespace-pre-wrap"><strong>Policy at cancellation:</strong> {selected.policy_snapshot}</p>
      {selected.review_reason && <p><strong>Decision reason:</strong> {selected.review_reason}</p>}
      {selected.gcash_reference && <p><strong>GCash reference:</strong> {selected.gcash_reference}</p>}
      {selected.proof_path && <button type="button" className="text-primary underline" onClick={() => void openProof(selected.proof_path!)}>View transfer proof</button>}
      {selected.status === "pending" && canReview && <div className="mt-4 space-y-2">
        <label className="block">Review notes / rejection reason<input value={reason} onChange={(event) => setReason(event.target.value)} className="mt-1 w-full rounded border p-2" /></label>
        <div className="flex gap-2"><button disabled={busy} onClick={() => void submit("approved")} className="rounded bg-primary px-3 py-2 text-base">Approve</button>
          <button disabled={busy || reason.trim().length < 3} onClick={() => void submit("rejected")} className="rounded border px-3 py-2">Reject</button></div>
      </div>}
      {selected.status === "approved" && canPay && <div className="mt-4 space-y-2">
        <label className="block">GCash transfer reference<input required value={reference} onChange={(event) => setReference(event.target.value)} className="mt-1 w-full rounded border p-2" /></label>
        <label className="block">Transfer proof<input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(event) => setProof(event.target.files?.[0] ?? null)} className="mt-1 block w-full" /></label>
        <button disabled={busy || reference.trim().length < 6 || !proof} onClick={() => void submit("refunded")} className="rounded bg-primary px-3 py-2 text-base disabled:opacity-50">Mark refunded</button>
      </div>}
    </div>}
  </div>;
}
