import { NextResponse } from "next/server";
import { requireActiveStaff } from "@/lib/server/admin-audit";
import { staffHasPermission } from "@/lib/server/role-permissions";

const validDate = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

export async function GET(request: Request) {
  const staff = await requireActiveStaff();
  if (!staff) return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  const month = new URL(request.url).searchParams.get("month");
  const start = new URL(request.url).searchParams.get("start");
  const end = new URL(request.url).searchParams.get("end");
  let query = staff.supabase.from("maintenance_blocks")
    .select("block_id, name, reason, start_date, end_date, start_datetime, end_datetime, status, created_at, created_by, released_at, released_by")
    .order("start_date", { ascending: true }).limit(500);
  if (validDate(start) && validDate(end) && end > start) {
    query = query.lt("start_date", end).gte("end_date", start);
  } else if (month && /^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    const [year, number] = month.split("-").map(Number);
    const next = new Date(Date.UTC(year, number, 1)).toISOString().slice(0, 10);
    query = query.lt("start_date", next).gte("end_date", `${month}-01`);
  }
  const { data, error } = await query;
  return error ? NextResponse.json({ message: error.message }, { status: 500 }) : NextResponse.json({ blocks: data });
}

export async function POST(request: Request) {
  const staff = await requireActiveStaff();
  if (!staff || (staff.staffUser.role !== "admin" && (staff.staffUser.role !== "staff" || !await staffHasPermission(staff.supabase, staff.staffUser.role, "edit_reservation")))) return NextResponse.json({ message: "Administrator or manager reservation-edit permission required." }, { status: 403 });
  const body = await request.json().catch(() => null);
  if (!body || typeof body.name !== "string" || typeof body.reason !== "string" ||
      !validDate(body.startDate) || !validDate(body.endDate) || body.endDate < body.startDate ||
      !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(body.startTime ?? "") || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(body.endTime ?? "") ||
      body.name.trim().length < 1 || body.name.length > 120 || body.reason.trim().length < 1 || body.reason.length > 2000) {
    return NextResponse.json({ message: "Enter a name, internal reason, and valid start/end dates and times." }, { status: 400 });
  }
  const start = `${body.startDate}T${body.startTime}:00+08:00`;
  const end = body.allDay === true ? new Date(Date.parse(`${body.endDate}T00:00:00+08:00`) + 86_400_000).toISOString() : `${body.endDate}T${body.endTime}:00+08:00`;
  if (Date.parse(end) <= Date.parse(start)) return NextResponse.json({ message: "End must be after start (Philippine time)." }, { status: 400 });
  const { data: blockId, error } = await staff.supabase.rpc("create_timed_maintenance_block", {
    p_name: body.name.trim(), p_reason: body.reason.trim(), p_start: body.allDay === true ? `${body.startDate}T00:00:00+08:00` : start, p_end: end,
  });
  if (error) return NextResponse.json({ message: error.message }, { status: error.code === "23P01" ? 409 : 400 });

  return NextResponse.json({ blockId, message: "Maintenance period blocked successfully." }, { status: 201 });
}

export async function PATCH(request: Request) {
  const staff = await requireActiveStaff();
  if (!staff || (staff.staffUser.role !== "admin" && (staff.staffUser.role !== "staff" || !await staffHasPermission(staff.supabase, staff.staffUser.role, "edit_reservation")))) return NextResponse.json({ message: "Administrator or manager reservation-edit permission required." }, { status: 403 });
  const body = await request.json().catch(() => null);
  if (!body || typeof body.blockId !== "string") return NextResponse.json({ message: "Block ID required." }, { status: 400 });
  const { error } = await staff.supabase.rpc("release_maintenance_block", { p_id: body.blockId });
  return error ? NextResponse.json({ message: error.message }, { status: 400 }) : NextResponse.json({ success: true });
}
