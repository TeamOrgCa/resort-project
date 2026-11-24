import { NextResponse } from "next/server";
import { requireActiveStaff } from "@/lib/server/admin-audit";
import { staffHasPermission } from "@/lib/server/role-permissions";
import { loadRooms, RoomDataError } from "@/lib/server/rooms";
import { createAdminClient } from "@/lib/supabase/admin";
import { uuidPattern } from "@/lib/booking/reservation-edit";
import { normalizePhilippineMobile } from "@/lib/validation/phone";
import { normalizePersonName } from "@/lib/validation/name";

export async function GET() {
  const staff = await requireActiveStaff();
  if (!staff) return NextResponse.json({ message: "Sign in as active resort staff." }, { status: 401 });
  if (!await staffHasPermission(staff.supabase, staff.staffUser.role, "rooms")) return NextResponse.json({ message: "Room access required." }, { status: 403 });
  try { return NextResponse.json({ ...await loadRooms(), canDiscount: staff.staffUser.role === "admin" || staff.staffUser.role === "staff" && await staffHasPermission(staff.supabase, staff.staffUser.role, "edit_reservation") }, { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return NextResponse.json({ message: error instanceof RoomDataError ? error.message : "Unable to load rooms." }, { status: 503 }); }
}

const operations = ["reserve", "assign", "check_in", "check_out", "extend", "transfer", "charge", "maintenance", "complete_maintenance", "ready", "cleaning", "configure", "inventory", "deactivate", "reactivate"];
export async function POST(request: Request) {
  const staff = await requireActiveStaff();
  if (!staff) return NextResponse.json({ message: "Sign in as active resort staff." }, { status: 401 });
  const body = await request.json().catch(() => null);
  if (!body || !operations.includes(body.action) || (body.action !== "inventory" && !uuidPattern.test(body.roomId ?? "")) || body.confirmed !== true || !body.input || typeof body.input !== "object" || Array.isArray(body.input)) {
    return NextResponse.json({ message: "Select a valid room action and confirm it." }, { status: 400 });
  }
  const configuration = ["configure", "inventory", "deactivate", "reactivate"].includes(body.action);
  const permission = configuration ? "configuration" : "room_operations";
  if (!await staffHasPermission(staff.supabase, staff.staffUser.role, "rooms") || !await staffHasPermission(staff.supabase, staff.staffUser.role, permission)) return NextResponse.json({ message: "You do not have permission for this room action." }, { status: 403 });
  if (["reserve", "assign"].includes(body.action) && !await staffHasPermission(staff.supabase, staff.staffUser.role, "create_reservation")) return NextResponse.json({ message: "Reservation creation permission required." }, { status: 403 });
  const input = body.input;
  if (JSON.stringify(input).length > 16000) return NextResponse.json({ message: "Room action is too large." }, { status: 400 });
  const integer = (v: unknown, min: number, max: number) => typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max;
  const money = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1000000;
  const date = (v: unknown) => typeof v === "string" && v.length <= 64 && Number.isFinite(Date.parse(v));
  let invalid = false;
  if (["reserve", "assign"].includes(body.action)) invalid = !integer(input.occupants, 1, 100);
  if (["reserve", "maintenance"].includes(body.action)) invalid ||= !date(input.starts_at) || !date(input.ends_at) || Date.parse(input.ends_at) <= Date.parse(input.starts_at);
  if (body.action === "reserve") invalid ||= !["private_swimming", "public_swimming", "room_accommodation"].includes(input.commercial_type);
  if (body.action === "reserve") invalid ||= ![3, 12].includes(input.duration_hours) || !integer(input.extension_hours, 0, 168) ||
    !integer(input.pricing_version, 1, Number.MAX_SAFE_INTEGER) || !integer(input.eligible_guests, 0, input.occupants) ||
    !money(input.expected_total) || (input.promo_code != null && (typeof input.promo_code !== "string" || input.promo_code.length > 40)) ||
    ((input.eligible_guests > 0 || input.promo_code) && (typeof input.discount_reason !== "string" || input.discount_reason.trim().length < 5 || input.discount_reason.length > 1000));
  if (["check_in", "check_out", "extend", "transfer", "charge"].includes(body.action)) invalid ||= !uuidPattern.test(input.assignment_id ?? "");
  if (body.action === "check_in" && input.occupants != null) invalid ||= !integer(input.occupants, 1, 100);
  if (body.action === "extend") invalid ||= !integer(input.hours, 1, 168) || !money(input.hourly_rate) || !date(input.expected_checkout);
  if (body.action === "transfer") invalid ||= !uuidPattern.test(input.target_room ?? "");
  if (["charge", "maintenance"].includes(body.action)) invalid ||= typeof input.reason !== "string" || input.reason.trim().length < 3 || input.reason.length > (body.action === "charge" ? 500 : 2000);
  if (body.action === "charge") invalid ||= !money(input.amount) || input.amount <= 0;
  if (body.action === "complete_maintenance") invalid ||= !uuidPattern.test(input.maintenance_id ?? "");
  if (body.action === "configure") invalid ||= typeof input.name !== "string" || input.name.trim().length < 2 || input.name.length > 100 ||
    !integer(input.included_capacity, 1, 100) || !integer(input.maximum_capacity, 1, 100) || input.included_capacity > input.maximum_capacity ||
    !integer(input.base_hours, 1, 168) || !integer(input.cleaning_buffer_minutes, 0, 1440) ||
    ![input.base_rate, input.additional_guest_rate, input.extension_hourly_rate].every(money);
  if (body.action === "configure") invalid ||= !integer(input.pricing_version, 1, Number.MAX_SAFE_INTEGER) ||
    ![input.rate_3_hours, input.rate_12_hours].every(v => money(v) && v > 0);
  if (body.action === "inventory") invalid ||= typeof input.room_number !== "string" || input.room_number.trim().length < 1 || input.room_number.length > 20 || typeof input.name !== "string" || input.name.trim().length < 1 || input.name.length > 100 || !uuidPattern.test(input.classification_id ?? "");
  if (invalid) return NextResponse.json({ message: "Check the room action values, guest count, dates and configured rates." }, { status: 400 });
  if (body.action === "reserve" && (input.eligible_guests > 0 || input.promo_code) && staff.staffUser.role !== "admin" &&
    !await staffHasPermission(staff.supabase, staff.staffUser.role, "edit_reservation")) return NextResponse.json({ message: "Manager billing permission required to verify discounts." }, { status: 403 });
  if (body.action === "reserve") {
    const phone = normalizePhilippineMobile(input.phone);
    const first = normalizePersonName(input.first_name), last = normalizePersonName(input.last_name);
    if (!phone || !first || !last || typeof input.address !== "string" || input.address.trim().length < 3 || input.address.length > 1000) return NextResponse.json({ message: "Enter valid guest names, Philippine mobile number and address." }, { status: 400 });
    input.phone = phone; input.first_name = first; input.last_name = last;
  }
  const { data, error } = await createAdminClient().rpc(body.action === "reserve" ? "room_reserve_priced" : "room_operate", { p_staff: staff.staffUser.id, p_room: body.roomId ?? null, ...(body.action === "reserve" ? {} : { p_action: body.action }), p_input: input });
  if (error) {
    const expected = ["22023", "23514", "23502", "22P02", "22007", "22008", "23505"].includes(error.code);
    const conflict = ["40001", "40P01", "23P01"].includes(error.code);
    const missing = ["PGRST202", "42P01", "42703", "42883"].includes(error.code);
    return NextResponse.json({ ...(missing || expected || conflict || error.code === "42501" ? { outcome: "not_applied" } : {}), message: missing ? "Apply docs/room-management-migration.sql, then docs/room-rates-discounts-migration.sql before recording room operations." : error.code === "40P01" ? "Another staff member updated these records. Refresh and try again." : expected ? `Check the submitted values. ${error.code === "22023" ? error.message : "A value is missing, invalid, or already in use."}` : conflict || error.code === "42501" ? error.message : "Unable to save the room action. Refresh and try again." }, { status: error.code === "42501" ? 403 : conflict ? 409 : expected ? 400 : 503 });
  }
  return NextResponse.json({ success: true, result: data, message: "Room action recorded." });
}
