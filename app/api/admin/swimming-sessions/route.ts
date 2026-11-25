import { NextResponse } from "next/server";
import { requireAdminStaff } from "@/lib/server/admin-audit";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseSwimmingPolicy } from "@/lib/booking/swimming-sessions";
import { parsePackageTimes } from "@/lib/booking/package-times";
import { loadPackageRates } from "@/lib/server/package-rates";
import { loadAdvanceBookingWindow } from "@/lib/server/advance-booking";

export async function GET() {
  const staff = await requireAdminStaff();
  if (!staff) return NextResponse.json({ message: "Admin access required." }, { status: 403 });
  try {
    const db = createAdminClient();
    const [policy, types, schedule, advance] = await Promise.all([
      db.rpc("swimming_policy"), db.from("public_swimming_types").select("*").order("mode"),
      loadPackageRates(staff.supabase), loadAdvanceBookingWindow(db),
    ]);
    if (policy.error || types.error || !parseSwimmingPolicy(policy.data)) throw new Error("Apply docs/swimming-session-management-migration.sql before configuring swimming sessions.");
    return NextResponse.json({ policy: policy.data, publicTypes: types.data, schedule, privateDays: advance.maximumAdvanceBookingDays }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return NextResponse.json({ message: e instanceof Error ? e.message : "Unable to load swimming configuration." }, { status: 503 }); }
}
export async function POST(request: Request) {
  const staff = await requireAdminStaff();
  if (!staff) return NextResponse.json({ message: "Admin access required." }, { status: 403 });
  const body = await request.json().catch(() => null);
  const policy = parseSwimmingPolicy(body?.policy), times = parsePackageTimes(body?.times);
  const types = body?.publicTypes;
  if (!policy || !times || !Number.isSafeInteger(body?.expectedVersion) || body.expectedVersion < 1
    || !Number.isSafeInteger(body?.packageVersion) || body.packageVersion < 1
    || !Number.isInteger(body?.privateDays) || body.privateDays < 0 || body.privateDays > 3650
    || !Array.isArray(types) || types.length !== 2 || new Set(types.map(t => t?.type_id)).size !== 2
    || types.some(t => !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(t?.type_id)
      || !Number.isSafeInteger(t?.pricing_version) || t.pricing_version < 1 || !/^([01]\d|2[0-3]):[0-5]\d(:00)?$/.test(t?.start_time)
      || !/^([01]\d|2[0-3]):[0-5]\d(:00)?$/.test(t?.end_time) || ![0, 1].includes(t?.end_day_offset)
      || typeof t?.is_active !== "boolean" || t.max_guests !== null && (!Number.isInteger(t.max_guests) || t.max_guests < 1 || t.max_guests > 10000))) {
    return NextResponse.json({ message: "Enter valid swimming policies, hours, capacities and non-overlapping date overrides." }, { status: 400 });
  }
  const { data, error } = await staff.supabase.rpc("save_swimming_policy", { p_policy: policy, p_expected_version: body.expectedVersion,
    p_public: types, p_times: times, p_package_version: body.packageVersion, p_private_days: body.privateDays });
  if (error) {
    let conflicts: unknown[] = [];
    try { const detail = JSON.parse(error.details); if (Array.isArray(detail)) conflicts = detail; } catch { /* Not a reservation conflict. */ }
    return NextResponse.json({ message: error.message, conflicts }, { status: error.code === "40001" ? 409 : error.code === "42501" ? 403 : ["22023", "23514", "22007"].includes(error.code) ? 400 : 500 });
  }
  return NextResponse.json({ policy: data });
}
