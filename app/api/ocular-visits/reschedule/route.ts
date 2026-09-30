import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActiveOcularSlots } from "@/repositories/catalogRepository";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null) as {
      visitId?: unknown; scheduledDate?: unknown; timeSlotId?: unknown;
    } | null;
    const visitId = typeof body?.visitId === "string" ? body.visitId.trim() : "";
    const scheduledDate = typeof body?.scheduledDate === "string" ? body.scheduledDate : "";
    const timeSlotId = typeof body?.timeSlotId === "string" ? body.timeSlotId.trim() : "";
    const date = /^\d{4}-\d{2}-\d{2}$/.test(scheduledDate) ? new Date(`${scheduledDate}T00:00:00`) : null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const localDate = date ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}` : "";
    if (!visitId || !timeSlotId || !date || Number.isNaN(date.getTime()) || localDate !== scheduledDate || date < today) {
      return NextResponse.json({ success: false, message: "Choose a valid future date and time slot." }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ success: false, message: "Please sign in." }, { status: 401 });

    const { data: visit, error: visitError } = await supabase.from("ocular_visits")
      .select("visit_id, guest_id, status")
      .eq("visit_id", visitId).maybeSingle<{ visit_id: string; guest_id: string | null; status: string }>();
    if (visitError || !visit) return NextResponse.json({ success: false, message: "Ocular visit not found." }, { status: 404 });
    if (visit.guest_id !== user.id) return NextResponse.json({ success: false, message: "Forbidden." }, { status: 403 });
    if (!["pending", "confirmed"].includes(visit.status)) {
      return NextResponse.json({ success: false, message: "This ocular visit can no longer be edited." }, { status: 400 });
    }

    const slots = await getActiveOcularSlots(supabase);
    const slot = slots.find((item) => item.slot_id === timeSlotId);
    if (!slot) return NextResponse.json({ success: false, message: "This time slot is unavailable." }, { status: 400 });

    const { data: conflicts, error: conflictError } = await supabase.from("ocular_visits")
      .select("visit_id, guest_id")
      .eq("scheduled_date", scheduledDate).eq("time_slot_id", timeSlotId)
      .in("status", ["pending", "confirmed"]).neq("visit_id", visitId);
    if (conflictError) return NextResponse.json({ success: false, message: "Could not check availability." }, { status: 500 });
    if ((conflicts ?? []).length >= slot.max_capacity) {
      return NextResponse.json({ success: false, message: "This time slot is full." }, { status: 409 });
    }
    const { data: sameDay, error: sameDayError } = await supabase.from("ocular_visits")
      .select("visit_id").eq("guest_id", user.id).eq("scheduled_date", scheduledDate)
      .in("status", ["pending", "confirmed"]).neq("visit_id", visitId).limit(1);
    if (sameDayError) return NextResponse.json({ success: false, message: "Could not check your visits." }, { status: 500 });
    if (sameDay?.length) return NextResponse.json({ success: false, message: "You already have a visit on this date." }, { status: 409 });

    const { error: updateError } = await supabase.from("ocular_visits")
      .update({ scheduled_date: scheduledDate, time_slot_id: timeSlotId })
      .eq("visit_id", visitId).eq("guest_id", user.id).in("status", ["pending", "confirmed"]);
    if (updateError) return NextResponse.json({ success: false, message: "Could not update this ocular visit." }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ success: false, message: "Could not update this ocular visit." }, { status: 500 });
  }
}
