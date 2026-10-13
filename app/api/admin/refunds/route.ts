import { NextResponse } from "next/server";
import { requireActiveStaff } from "@/lib/server/admin-audit";
import { createNotifications } from "@/lib/notifications";
import { createAdminClient } from "@/lib/supabase/admin";
import { staffHasPermission } from "@/lib/server/role-permissions";
import { fetchAllPages, fetchByIds } from "@/lib/server/fetch-all-pages";

export async function GET() {
  const staff = await requireActiveStaff();
  if (!staff) return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  if (!(await staffHasPermission(staff.supabase, staff.staffUser.role, "transactions"))) return NextResponse.json({ message: "Permission required." }, { status: 403 });
  try {
    const data = await fetchAllPages((from, to) => staff.supabase.from("refund_requests")
      .select("refund_id, reservation_id, guest_id, amount, request_kind, policy_snapshot, policy_version, status, requested_at, reviewed_by, reviewed_at, review_reason, refunded_by, refunded_at, gcash_reference, proof_path")
      .order("requested_at", { ascending: false }).order("refund_id").range(from, to));
    const ids = [...new Set(data.map(row => row.reservation_id as string))];
    const reservations = await fetchByIds<{ reservation_id: string; reference_number: string }>(ids, (batch, from, to) => staff.supabase.from("reservations")
      .select("reservation_id, reference_number").in("reservation_id", batch).order("reservation_id").range(from, to));
    return NextResponse.json({ refunds: data, reservations }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ message: "Unable to load refund requests. Please refresh and try again." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const staff = await requireActiveStaff();
  if (!staff) return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  const form = await request.formData().catch(() => null);
  const refundId = form?.get("refundId");
  const action = form?.get("action");
  const reason = form?.get("reason");
  const reference = form?.get("reference");
  if (typeof refundId !== "string" || !/^[a-f\d-]{36}$/i.test(refundId) ||
      !["approved", "rejected", "refunded"].includes(String(action))) {
    return NextResponse.json({ message: "Invalid refund request." }, { status: 400 });
  }
  if (!(await staffHasPermission(staff.supabase, staff.staffUser.role, action === "refunded" ? "refund_payout" : "refund_review")))
    return NextResponse.json({ message: "Permission required." }, { status: 403 });
  let proofPath: string | null = null;
  if (action === "refunded") {
    const proof = form?.get("proof");
    if (!(proof instanceof File) || proof.size < 1 || proof.size > 8 * 1024 * 1024 ||
        !["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(proof.type) ||
        typeof reference !== "string" || reference.trim().length < 6) {
      return NextResponse.json({ message: "A GCash reference and image or PDF proof (up to 8 MB) are required." }, { status: 400 });
    }
    const { data: current } = await staff.supabase.from("refund_requests").select("status")
      .eq("refund_id", refundId).maybeSingle();
    if (current?.status !== "approved") return NextResponse.json({ message: "Approve the refund before recording payment." }, { status: 409 });
    proofPath = `${refundId}/${crypto.randomUUID()}.${proof.type === "application/pdf" ? "pdf" : proof.type.split("/")[1]}`;
    const { error: uploadError } = await createAdminClient().storage.from("refund-proofs")
      .upload(proofPath, await proof.arrayBuffer(), { contentType: proof.type, upsert: false });
    if (uploadError) return NextResponse.json({ message: uploadError.message }, { status: 500 });
  }
  const { error } = await staff.supabase.rpc("transition_refund", {
    p_id: refundId, p_action: action, p_reason: typeof reason === "string" ? reason : null,
    p_reference: typeof reference === "string" ? reference : null, p_proof: proofPath,
  });
  if (error) {
    if (proofPath) await createAdminClient().storage.from("refund-proofs").remove([proofPath]);
    return NextResponse.json({ message: error.message }, { status: 409 });
  }
  const { data: refund } = await staff.supabase.from("refund_requests")
    .select("guest_id, reservation_id, amount").eq("refund_id", refundId).single();
  const { error: notificationError } = await createNotifications({
    actorId: staff.staffUser.id, guestId: refund?.guest_id,
    title: action === "approved" ? "Refund approved" : action === "rejected" ? "Refund rejected" : "Refund sent via GCash",
    message: action === "rejected" ? `Reason: ${String(reason).trim()}` :
      action === "refunded" ? `GCash reference: ${String(reference).trim()}` :
        "Your refund has been approved and is awaiting GCash transfer.",
    entityType: "refund_request", entityId: refundId, guestActionUrl: "/manage",
  });
  if (notificationError) console.warn("Failed to notify guest about refund:", notificationError);
  return NextResponse.json({ success: true, status: action, notificationError: notificationError?.message ?? null });
}
