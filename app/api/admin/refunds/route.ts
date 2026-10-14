import { NextResponse } from "next/server";
import { requireActiveStaff } from "@/lib/server/admin-audit";
import { createAdminClient } from "@/lib/supabase/admin";
import { staffHasPermission } from "@/lib/server/role-permissions";
import { fetchAllPages, fetchByIds } from "@/lib/server/fetch-all-pages";
import { refundEmail, workflowErrorMessage, workflowErrorStatus } from "@/lib/server/cancellation";
import { uuidPattern } from "@/lib/booking/reservation-edit";

export async function GET() {
  const staff = await requireActiveStaff();
  if (!staff) return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  if (!await staffHasPermission(staff.supabase, staff.staffUser.role, "transactions")) return NextResponse.json({ message: "Permission required." }, { status: 403 });
  try {
    const refunds = await fetchAllPages((from, to) => staff.supabase.from("refund_requests")
      .select("refund_id, reservation_id, guest_id, amount, request_kind, policy_snapshot, policy_version, calculation_snapshot, workflow_version, status, requested_at, reviewed_by, reviewed_at, review_reason, payment_reviewed_by, payment_reviewed_at, payment_review_notes, payout_submitted_by, payout_submitted_at, payout_method, payout_verification_notes, refunded_by, refunded_at, gcash_reference, proof_path")
      .order("requested_at", { ascending: false }).order("refund_id").range(from, to));
    const ids = [...new Set(refunds.map(row => row.reservation_id as string))];
    const [reservations, bills, payments, paymentMethods, canReview, canPay, canVerify] = await Promise.all([
      fetchByIds<{ reservation_id: string; reference_number: string }>(ids, (batch, from, to) => staff.supabase.from("reservations")
        .select("reservation_id, reference_number, status, cancellation_initiator, cancellation_reason").in("reservation_id", batch).order("reservation_id").range(from, to)),
      fetchByIds(ids, (batch, from, to) => staff.supabase.from("transactions").select("reservation_id, total_amount, paid_amount, cancellation_deposit_base").in("reservation_id", batch).order("reservation_id").range(from, to)),
      fetchByIds(ids, (batch, from, to) => staff.supabase.from("payments").select("payment_id, reservation_id, amount, status, payment_type, reference_number, verified_at, proof_path")
        .in("reservation_id", batch).order("payment_id").range(from, to)),
      fetchAllPages((from, to) => staff.supabase.from("payment_methods").select("payment_method_id, name, type").eq("is_active", true).order("payment_method_id").range(from, to)),
      staffHasPermission(staff.supabase, staff.staffUser.role, "refund_review"),
      staffHasPermission(staff.supabase, staff.staffUser.role, "refund_payout"),
      staffHasPermission(staff.supabase, staff.staffUser.role, "refund_verify"),
    ]);
    return NextResponse.json({ refunds, reservations, bills, payments, paymentMethods, permissions: { canReview, canPay, canVerify, canApprove: staff.staffUser.role === "admin", canVerifyOwnPayout: staff.staffUser.role === "admin", staffId: staff.staffUser.id } },
      { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ message: "Unable to load refunds. Check the cancellation-refund-workflow migration, then retry." }, { status: 503 });
  }
}
export async function POST(request: Request) {
  const staff = await requireActiveStaff();
  if (!staff) return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  const form = await request.formData().catch(() => null);
  const id = form?.get("refundId"), action = String(form?.get("action") ?? "");
  const reason = typeof form?.get("reason") === "string" ? String(form?.get("reason")).trim() : "";
  const reference = typeof form?.get("reference") === "string" ? String(form?.get("reference")).trim() : null;
  const verified = form?.get("verified") === "true";
  const method = typeof form?.get("method") === "string" ? String(form?.get("method")) : "GCash";
  if (typeof id !== "string" || !uuidPattern.test(id) || !["recalculate", "reviewed", "approved", "rejected", "payout_submitted", "refunded"].includes(action) || reason.length > 2000 || !method.trim() || method.length > 120)
    return NextResponse.json({ message: "Invalid refund action." }, { status: 400 });
  const permission = action === "payout_submitted" ? "refund_payout" : action === "refunded" ? "refund_verify" : "refund_review";
  if (!await staffHasPermission(staff.supabase, staff.staffUser.role, permission) ||
    (["recalculate", "approved", "rejected"].includes(action) && staff.staffUser.role !== "admin"))
    return NextResponse.json({ message: "Permission required. Only administrators approve or reject refunds." }, { status: 403 });
  if ((["reviewed", "refunded"].includes(action) && (!verified || reason.length < 5)) || (action === "rejected" && reason.length < 5))
    return NextResponse.json({ message: "Enter notes and confirm verification. A rejection reason is required." }, { status: 400 });
  if (action === "recalculate") {
    const initiator = form?.get("initiator");
    if (!["guest", "resort"].includes(String(initiator)) || reason.length < 5) return NextResponse.json({ message: "Classify the legacy cancellation and document a reason." }, { status: 400 });
    const { error } = await staff.supabase.rpc("recalculate_legacy_cancellation_refund", { p_id: id, p_initiator: initiator, p_reason: reason });
    if (error) return NextResponse.json({ message: workflowErrorMessage(error) }, { status: workflowErrorStatus(error.code) });
    return NextResponse.json({ success: true, message: "Legacy refund recalculated and guest notified in-app. A positive refund requires a fresh cashier review and administrator approval.", emailSent: false });
  }
  let proofPath: string | null = null;
  if (action === "payout_submitted") {
    const proof = form?.get("proof");
    if (!(proof instanceof File) || proof.size < 1 || proof.size > 8 * 1024 * 1024 ||
      !["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(proof.type) || !reference || reference.length < 6 || reference.length > 100)
      return NextResponse.json({ message: "A transfer reference and image or PDF proof (up to 8 MB) are required." }, { status: 400 });
    const { data: current, error } = await staff.supabase.from("refund_requests").select("status").eq("refund_id", id).maybeSingle();
    if (error || current?.status !== "approved") return NextResponse.json({ message: "The refund must be approved before recording a transfer." }, { status: 409 });
    const bytes = Buffer.from(await proof.arrayBuffer());
    const signatures: Record<string, boolean> = {
      "application/pdf": bytes.subarray(0, 5).toString() === "%PDF-",
      "image/jpeg": bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255,
      "image/png": bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
      "image/webp": bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP",
    };
    if (!signatures[proof.type]) return NextResponse.json({ message: "The proof file does not match its image/PDF type." }, { status: 400 });
    proofPath = id + "/" + crypto.randomUUID() + "." + (proof.type === "application/pdf" ? "pdf" : proof.type.split("/")[1]);
    const { error: uploadError } = await createAdminClient().storage.from("refund-proofs").upload(proofPath, bytes, { contentType: proof.type, upsert: false });
    if (uploadError) return NextResponse.json({ message: "Unable to upload transfer proof. No refund was completed." }, { status: 503 });
  }
  const { error } = await staff.supabase.rpc("transition_refund_workflow", {
    p_id: id, p_action: action, p_reason: reason || null, p_reference: reference, p_proof: proofPath, p_method: method, p_verified: verified,
  });
  if (error) {
    if (proofPath && ["22023", "42501", "40001", "23505"].includes(error.code)) {
      try { await createAdminClient().storage.from("refund-proofs").remove([proofPath]); } catch { /* Financial error remains primary. */ }
    }
    return NextResponse.json({ message: workflowErrorMessage(error) }, { status: workflowErrorStatus(error.code) });
  }
  let emailSent = false;
  try {
    const { data: refund } = await staff.supabase.from("refund_requests").select("reservation_id, amount").eq("refund_id", id).maybeSingle();
    if (refund) emailSent = await refundEmail(staff.supabase, refund.reservation_id, Number(refund.amount), action, reason);
  } catch { /* The action and in-app alerts already committed. */ }
  return NextResponse.json({ success: true, status: action, emailSent, message: action === "payout_submitted"
    ? staff.staffUser.role === "admin"
      ? "Transfer submitted. Check the provider transaction records, enter verification notes and confirm verification to complete the refund."
      : "Transfer submitted. Another authorized staff member must verify it before the refund is completed."
    : action === "refunded" ? "Transfer verified. Refund completed and net payment records updated." : "Refund updated. Guest and finance staff were notified." });
}
