import { NextResponse } from "next/server";
import { requireAdminStaff } from "@/lib/server/admin-audit";
import { loadPackageRates } from "@/lib/server/package-rates";
import { parsePackageRates } from "@/lib/booking/package-rates";

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
    return NextResponse.json({ success: true, schedule, defaultRates }, { headers: { "Cache-Control": "no-store" } });
  }
  catch (error) { return NextResponse.json({ success: false, message: error instanceof Error ? error.message : "Unable to load package rates." }, { status: 503 }); }
}

export async function POST(request: Request) {
  const staff = await requireAdminStaff();
  if (!staff) return NextResponse.json({ success: false, message: "Admin access required." }, { status: 403 });
  const body = await request.json().catch(() => null);
  const rates = parsePackageRates(body?.rates);
  if (!rates || !Number.isSafeInteger(body?.expectedVersion) || body.expectedVersion < 1) {
    return NextResponse.json({ success: false, message: "Enter all six package prices and extra-person charges, using up to two decimal places." }, { status: 400 });
  }
  const { data, error } = await staff.supabase.rpc("publish_package_rates", { p_rates: rates, p_expected_version: body.expectedVersion });
  if (error) return NextResponse.json({ success: false, message: error.message }, { status: error.code === "40001" ? 409 : error.code === "42501" ? 403 : error.code === "22023" ? 400 : 500 });
  return NextResponse.json({ success: true, schedule: { version: Number(data), rates }, message: "Package rates saved. New bookings use these prices." });
}
