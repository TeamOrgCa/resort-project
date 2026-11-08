import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActiveOcularSlots } from "@/repositories/catalogRepository";
import { createAdminClient } from "@/lib/supabase/admin";
import { maintenanceOverlaps } from "@/lib/booking/maintenance";

export async function GET(request: Request) {
  try {
    const slots = await getActiveOcularSlots(await createClient());
    const month = new URL(request.url).searchParams.get("month");
    const unavailableByDate: Record<string, string[]> = {};
    if (month) {
      if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month)) return NextResponse.json({ message: "Invalid month." }, { status: 400 });
      const first = `${month}-01`;
      const next = new Date(`${first}T00:00:00Z`); next.setUTCMonth(next.getUTCMonth() + 1);
      const end = next.toISOString().slice(0, 10);
      const admin = createAdminClient();
      const [visits, blocks] = await Promise.all([
        admin.from("ocular_visits").select("scheduled_date,time_slot_id").in("status", ["pending", "confirmed"]).gte("scheduled_date", first).lt("scheduled_date", end).limit(10000),
        admin.from("maintenance_blocks").select("start_date,end_date,start_datetime,end_datetime").eq("status", "active").lt("start_date", end).gte("end_date", first).limit(1000),
      ]);
      if (visits.error || blocks.error || visits.data.length >= 10000 || blocks.data.length >= 1000) throw new Error("Availability unavailable");
      const counts = new Map<string, number>();
      for (const visit of visits.data) {
        const key = `${visit.scheduled_date}:${visit.time_slot_id}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      for (let day = new Date(`${first}T00:00:00Z`); day < next; day = new Date(day.getTime() + 86_400_000)) {
        const date = day.toISOString().slice(0, 10);
        unavailableByDate[date] = slots.filter(slot => (counts.get(`${date}:${slot.slot_id}`) ?? 0) >= (slot.max_capacity ?? 1)
          || blocks.data.some(block => maintenanceOverlaps(`${date}T${slot.start_time}+08:00`, `${date}T${slot.end_time}+08:00`, block)))
          .map(slot => `${slot.start_time.slice(0, 5)}-${slot.end_time.slice(0, 5)}`);
      }
    }
    // Public availability contains aggregate slot labels, never guest records or internal reasons.
    return NextResponse.json({ success: true, slots, unavailableByDate }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ success: false, message: "Failed to load ocular time slots." }, { status: 500 });
  }
}
