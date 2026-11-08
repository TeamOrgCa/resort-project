import { createAdminClient } from "@/lib/supabase/admin";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActiveOcularSlots } from "@/repositories/catalogRepository";
import { BOOKING_LEAD_MESSAGE, isOcularSlotStartAllowed } from "@/lib/booking/start-time";
import { isValidManilaDate, manilaDateKey } from "@/lib/booking/manila-date";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null) as {
      visitId?: unknown; scheduledDate?: unknown; timeSlotId?: unknown;
    } | null;
    const visitId = typeof body?.visitId === "string" ? body.visitId.trim() : "";
    const scheduledDate = typeof body?.scheduledDate === "string" ? body.scheduledDate : "";
    const timeSlotId = typeof body?.timeSlotId === "string" ? body.timeSlotId.trim() : "";
    if (!visitId || !timeSlotId || !isValidManilaDate(scheduledDate) || scheduledDate < manilaDateKey(new Date())) {
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
    if (!isOcularSlotStartAllowed(scheduledDate, slot.start_time)) {
      return NextResponse.json({ success: false, message: BOOKING_LEAD_MESSAGE }, { status: 400 });
    }

    const { error: updateError } = await createAdminClient().rpc("save_confirmed_ocular_visit", {
      p_guest: user.id, p_date: scheduledDate, p_slot: timeSlotId, p_reference: null, p_visit: visitId,
    });
    if (updateError) return NextResponse.json({ success: false, message: updateError.message }, { status: ["23P01", "23505", "40001"].includes(updateError.code) ? 409 : 400 });
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ success: false, message: "Could not update this ocular visit." }, { status: 500 });
  }
}
