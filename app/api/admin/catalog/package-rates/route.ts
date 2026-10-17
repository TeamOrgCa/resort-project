import { NextResponse } from "next/server";
import { requireAdminStaff } from "@/lib/server/admin-audit";
import { loadPackageRates } from "@/lib/server/package-rates";
import { parsePackageRates } from "@/lib/booking/package-rates";
import { DEFAULT_PACKAGE_TIMES, parsePackageTimes } from "@/lib/booking/package-times";

export async function GET() {
  const staff = await requireAdminStaff();
  if (!staff) return NextResponse.json({ success: false, message: "Admin access required." }, { status: 403 });
  try {
    const [schedule, original] = await Promise.all([
      loadPackageRates(staff.supabase),
      staff.supabase.from("package_rate_versions").select("rates").order("version", { ascending: true }).limit(1).maybeSingle(),
    ]);
    const defaultRates = parsePackageRates(original.data?.rates);
    if (original.error || !defaultRates) throw new Error("Unable to load the original package rates. Please reload and try again.");
    return NextResponse.json({ success: true, schedule, defaultRates, defaultTimes: DEFAULT_PACKAGE_TIMES }, { headers: { "Cache-Control": "no-store" } });
  }
  catch (error) { return NextResponse.json({ success: false, message: error instanceof Error ? error.message : "Unable to load package rates." }, { status: 503 }); }
}

export async function POST(request: Request) {
  const staff = await requireAdminStaff();
  if (!staff) return NextResponse.json({ success: false, message: "Admin access required." }, { status: 403 });
  const body = await request.json().catch(() => null);
  const rates = parsePackageRates(body?.rates);
  const times = body?.times === undefined ? undefined : parsePackageTimes(body.times);
  if (!rates || times === null || !Number.isSafeInteger(body?.expectedVersion) || body.expectedVersion < 1) {
    return NextResponse.json({ success: false, message: "Enter all six valid package prices and time slots lasting more than zero and no more than 24 hours." }, { status: 400 });
  }
  const { data, error } = await staff.supabase.rpc("publish_package_rates", { p_rates: rates, p_expected_version: body.expectedVersion, ...(times ? { p_times: times } : {}) });
  if (error) return NextResponse.json({ success: false, message: ["PGRST202", "42703", "42883"].includes(error.code) ? "Apply docs/package-times-migration.sql before saving package time slots." : error.message }, { status: error.code === "40001" ? 409 : error.code === "42501" ? 403 : error.code === "22023" ? 400 : 500 });
  const savedTimes = times ?? (await loadPackageRates(staff.supabase, Number(data))).times;
  return NextResponse.json({ success: true, schedule: { version: Number(data), rates, times: savedTimes }, message: "Package rates and time slots saved. New bookings use this schedule." });
}
