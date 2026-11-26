import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET() {
  try {
    const db = createAdminClient();
    const [swimming, rooms, inventory] = await Promise.all([
      db.from("public_swimming_types").select("type_id,mode,name,start_time,end_time,end_day_offset,adult_rate,child_rate").eq("is_active", true).order("mode"),
      db.from("room_classifications").select("classification_id,name,code,included_capacity,maximum_capacity,rate_3_hours,rate_12_hours,additional_guest_rate,extension_hourly_rate").order("code", { ascending: false }),
      db.from("physical_rooms").select("classification_id").eq("is_active", true).eq("private_swimming_only", false),
    ]);
    if (swimming.error || rooms.error || inventory.error) throw new Error("Rates unavailable");
    const offeredClasses = new Set((inventory.data ?? []).map(room => room.classification_id));
    return NextResponse.json({ success: true, publicSwimming: swimming.data ?? [], rooms: (rooms.data ?? []).filter(room => offeredClasses.has(room.classification_id)) }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ success: false, message: "Public swimming and room prices are temporarily unavailable. Please try again later." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
