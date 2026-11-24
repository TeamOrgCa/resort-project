import { NextResponse } from "next/server";
import { requireActiveStaff } from "@/lib/server/admin-audit";
import { staffHasPermission } from "@/lib/server/role-permissions";
import { loadRoomBill } from "@/lib/server/rooms";
import { createAdminClient } from "@/lib/supabase/admin";
import { uuidPattern } from "@/lib/booking/reservation-edit";

export async function GET(_request: Request, { params }: { params: Promise<{ roomId: string }> }) {
  const staff = await requireActiveStaff();
  if (!staff) return NextResponse.json({ message: "Sign in as active resort staff." }, { status: 401 });
  if (!await staffHasPermission(staff.supabase, staff.staffUser.role, "rooms")) return NextResponse.json({ message: "Room access required." }, { status: 403 });
  const { roomId } = await params;
  if (!uuidPattern.test(roomId)) return NextResponse.json({ message: "Invalid room." }, { status: 400 });
  const db = createAdminClient();
  const [activity, occupancy] = await Promise.all([
    db.from("room_activity").select("*").eq("room_id", roomId).order("created_at", { ascending: false }).limit(10),
    db.from("room_assignments").select("reservation_id").eq("room_id", roomId).eq("state", "occupied").maybeSingle(),
  ]);
  if (activity.error || occupancy.error) return NextResponse.json({ message: "Unable to load room details." }, { status: 503 });
  try { return NextResponse.json({ history: activity.data, bill: occupancy.data ? await loadRoomBill(occupancy.data.reservation_id) : null }, { headers: { "Cache-Control": "no-store" } }); }
  catch { return NextResponse.json({ message: "Unable to load the reservation bill." }, { status: 503 }); }
}
