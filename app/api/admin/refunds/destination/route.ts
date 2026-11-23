import { NextResponse } from "next/server";
import { requireActiveStaff } from "@/lib/server/admin-audit";
import { staffHasPermission } from "@/lib/server/role-permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { uuidPattern } from "@/lib/booking/reservation-edit";

export async function POST(request: Request) {
  const staff = await requireActiveStaff();
  if (!staff) return NextResponse.json({ message: "Sign in as active staff." }, { status: 401 });
  const role = staff.staffUser.role;
  if (!await staffHasPermission(staff.supabase, role, "transactions") || !(role === "admin" ||
    role === "staff" && await staffHasPermission(staff.supabase, role, "refund_approval") ||
    role === "cashier" && await staffHasPermission(staff.supabase, role, "refund_payout"))) {
    return NextResponse.json({ message: "Refund processing permission required." }, { status: 403 });
  }
  const body = await request.json().catch(() => null);
  if (!uuidPattern.test(body?.refundId ?? "")) return NextResponse.json({ message: "Choose a valid refund." }, { status: 400 });
  const { error } = await createAdminClient().rpc("request_refund_destination", { p_refund: body.refundId, p_staff: staff.staffUser.id });
  if (error) return NextResponse.json({ message: error.message }, { status: error.code === "42501" ? 403 : error.code === "22023" ? 400 : error.code === "40001" ? 409 : 503 });
  return NextResponse.json({ success: true, message: "Guest notified. They can submit payment details in Manage Booking > Refunds." });
}
