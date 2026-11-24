import { NextResponse } from "next/server";
import { requireActiveStaff, createAuditLog } from "@/lib/server/admin-audit";
import { staffHasPermission } from "@/lib/server/role-permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { uuidPattern } from "@/lib/booking/reservation-edit";
import { roomDate } from "@/lib/rooms/occupancy";

export async function GET(request: Request) {
  const staff = await requireActiveStaff();
  if (!staff) return NextResponse.json({ message: "Sign in as active resort staff." }, { status: 401 });
  const params = new URL(request.url).searchParams, exporting = params.get("export") === "csv";
  if (!await staffHasPermission(staff.supabase, staff.staffUser.role, "rooms") || exporting && !await staffHasPermission(staff.supabase, staff.staffUser.role, "room_export")) return NextResponse.json({ message: "Room records permission required." }, { status: 403 });
  const room = params.get("room"), from = params.get("from"), to = params.get("to");
  const date = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
  if (room && !uuidPattern.test(room) || from && !date(from) || to && !date(to) || from && to && from > to) return NextResponse.json({ message: "Choose a valid room and date range." }, { status: 400 });
  const page = Math.max(1, Math.min(100000, Math.floor(Number(params.get("page"))) || 1)), size = 30;
  let query = createAdminClient().from("room_activity").select("*", { count: "exact" }).order("created_at", { ascending: false }).order("activity_id");
  if (room) query = query.eq("room_id", room);
  query = query.lte("created_at", new Date().toISOString());
  if (from) query = query.gte("created_at", `${from}T00:00:00+08:00`);
  if (to) query = query.lt("created_at", new Date(Date.parse(`${to}T00:00:00+08:00`) + 86400000).toISOString());
  if (params.get("type")) query = query.eq("activity_type", params.get("type")!.slice(0, 100));
  const search = (params.get("q") ?? "").trim().slice(0, 100).replace(/[%_,().\\]/g, " ");
  if (search) query = query.or(`description.ilike.%${search}%,reference_number.ilike.%${search}%,staff_name.ilike.%${search}%`);
  const { data, error, count } = await query.range(exporting ? 0 : (page - 1) * size, exporting ? 999 : page * size - 1);
  if (error) return NextResponse.json({ message: "Unable to load room history." }, { status: 503 });
  if (!exporting) return NextResponse.json({ records: data, count, page, pageSize: size }, { headers: { "Cache-Control": "no-store" } });
  if ((count ?? 0) > 10000) return NextResponse.json({ message: "Narrow the date range to export at most 10,000 activities." }, { status: 400 });
  const records = [...(data ?? [])];
  while (records.length < (count ?? 0)) {
    const next = await query.range(records.length, Math.min(records.length + 999, (count ?? 0) - 1));
    if (next.error || !next.data?.length) return NextResponse.json({ message: "The history export could not be completed. Retry the export." }, { status: 503 });
    records.push(...next.data);
  }
  const cell = (v: unknown) => `"${String(v ?? "").replace(/^[=+@\-\t\r]/, "'$&").replaceAll('"', '""')}"`;
  const csv = [["Date (Philippine time)", "Room ID", "Activity", "Reservation", "Description", "Staff"], ...records.map(r => [roomDate(r.created_at), r.room_id, r.activity_type, r.reference_number, r.description, r.staff_name])].map(row => row.map(cell).join(",")).join("\r\n");
  await createAuditLog(staff, { action: "Exported room history", entityType: "room", entityId: room, details: { from, to, count } });
  return new NextResponse(`\uFEFF${csv}`, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="marville-room-history.csv"', "Cache-Control": "no-store" } });
}
