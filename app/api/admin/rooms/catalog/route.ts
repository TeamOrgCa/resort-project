import { NextResponse } from "next/server";
import { requireActiveStaff } from "@/lib/server/admin-audit";
import { staffHasPermission } from "@/lib/server/role-permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { uuidPattern } from "@/lib/booking/reservation-edit";

async function authorize() {
  const staff = await requireActiveStaff();
  if (!staff || !await staffHasPermission(staff.supabase, staff.staffUser.role, "configuration")) return null;
  return staff;
}
export async function GET() {
  if (!await authorize()) return NextResponse.json({ message: "Admin configuration permission required." }, { status: 403 });
  const db = createAdminClient();
  const results = await Promise.all([db.from("room_catalog_links").select("*"), db.from("units").select("unit_id,name").eq("is_active", true), db.from("services").select("service_id,name,billing_type").eq("is_active", true).eq("billing_type", "quantity")]);
  if (results.some(r => r.error)) return NextResponse.json({ message: "Unable to load room catalog links." }, { status: 503 });
  return NextResponse.json({ links: results[0].data, units: results[1].data, services: results[2].data }, { headers: { "Cache-Control": "no-store" } });
}
export async function POST(request: Request) {
  const staff = await authorize();
  if (!staff) return NextResponse.json({ message: "Admin configuration permission required." }, { status: 403 });
  const body = await request.json().catch(() => null);
  if (!body || !uuidPattern.test(body.classificationId ?? "") || (body.unitId != null) === (body.serviceId != null) || !uuidPattern.test(body.unitId ?? body.serviceId ?? "") || body.confirmed !== true) return NextResponse.json({ message: "Choose one catalog item and a classification, then confirm." }, { status: 400 });
  const { error } = await createAdminClient().rpc("room_set_catalog_link", { p_staff: staff.staffUser.id, p_classification: body.classificationId, p_unit: body.unitId ?? null, p_service: body.serviceId ?? null, p_remove: body.remove === true });
  if (error) return NextResponse.json({ message: ["40001", "22023", "42501"].includes(error.code) ? error.message : "Unable to update catalog link." }, { status: error.code === "40001" ? 409 : 400 });
  return NextResponse.json({ success: true });
}
