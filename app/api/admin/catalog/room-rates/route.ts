import { NextResponse } from "next/server";
import { requireAdminStaff } from "@/lib/server/admin-audit";
import { createAdminClient } from "@/lib/supabase/admin";
import { uuidPattern } from "@/lib/booking/reservation-edit";

export async function GET() {
  const staff = await requireAdminStaff();
  if (!staff) return NextResponse.json({ message: "Admin access required." }, { status: 403 });
  const { data, error } = await createAdminClient().from("room_classifications").select("*").order("code", { ascending: false });
  if (error || data?.some(c => c.rate_3_hours == null || c.rate_12_hours == null)) return NextResponse.json({ message: "Apply docs/room-rates-discounts-migration.sql, then reload room rates." }, { status: 503 });
  return NextResponse.json({ classifications: data }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const staff = await requireAdminStaff();
  if (!staff) return NextResponse.json({ message: "Admin access required." }, { status: 403 });
  const body = await request.json().catch(() => null);
  const keys = ["rate_3_hours", "rate_8_hours", "rate_12_hours", "extension_hourly_rate", "additional_guest_rate"];
  if (!body || !uuidPattern.test(body.classificationId ?? "") || !Number.isSafeInteger(body.expectedVersion) || body.expectedVersion < 1 ||
    !keys.every(k => { const v = body.rates?.[k]; if (k === "rate_8_hours" && v == null) return true; return typeof v === "number" && Number.isFinite(v) && v >= (k === "additional_guest_rate" ? 0 : 0.01) && v <= 1000000 && Math.abs(v * 100 - Math.round(v * 100)) < 0.00001; })) {
    return NextResponse.json({ message: "Enter valid room prices using up to two decimal places." }, { status: 400 });
  }
  if (body.rates.rate_8_hours != null) {
    const { error } = await createAdminClient().from("room_classifications").select("rate_8_hours").eq("classification_id", body.classificationId).maybeSingle();
    if (error) return NextResponse.json({ message: "Apply docs/swimming-room-eight-hour-rate-migration.sql before saving 8-hour room rates." }, { status: 503 });
  }
  const { data, error } = await createAdminClient().rpc("room_save_rates", { p_staff: staff.staffUser.id, p_classification: body.classificationId, p_version: body.expectedVersion, p_rates: Object.fromEntries(keys.filter(k => body.rates[k] !== undefined).map(k => [k, body.rates[k]])) });
  if (error) return NextResponse.json({ message: ["PGRST202", "42703", "42883"].includes(error.code) ? "Apply docs/room-rates-discounts-migration.sql before saving room rates." : error.message }, { status: error.code === "40001" ? 409 : error.code === "42501" ? 403 : error.code === "22023" ? 400 : 503 });
  return NextResponse.json({ classification: data, message: "Room rates saved. Existing accommodation charges are preserved." });
}
