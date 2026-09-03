import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { notifyGuestAndStaff } from "@/lib/notifications";
import { sendOcularVisitScheduledEmail } from "@/lib/email";
import { getActiveOcularSlots, type OcularSlotRecord } from "@/repositories/catalogRepository";
interface OcularVisitPayload {
  scheduledDate: string;
  timeSlot: string;
}

interface OcularVisitInsertRow {
  visit_id: string;
  reference_number: string;
  scheduled_date: string;
  time_slot_id: string;
  status: string;
  created_at: string;
}

const isValidDate = (value: string) => {
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime());
};

const slotLabel = (slot: OcularSlotRecord) => `${slot.start_time.slice(0, 5)}-${slot.end_time.slice(0, 5)}`;

const generateOcularReferenceNumber = async (supabase: Awaited<ReturnType<typeof createClient>>) => {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const candidate = `OV-${Math.random().toString(36).substring(2, 10).toUpperCase()}`;

    const { data } = await supabase
      .from("ocular_visits")
      .select("visit_id")
      .eq("reference_number", candidate)
      .maybeSingle();

    if (!data) {
      return candidate;
    }
  }

  return null;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<OcularVisitPayload>;

    if (!body.scheduledDate || typeof body.scheduledDate !== "string" || !isValidDate(body.scheduledDate)) {
      return NextResponse.json(
        {
          success: false,
          message: "Invalid scheduled date.",
        },
        { status: 400 }
      );
    }

    if (!body.timeSlot || typeof body.timeSlot !== "string") {
      return NextResponse.json(
        {
          success: false,
          message: "Invalid time slot.",
        },
        { status: 400 }
      );
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const scheduledDate = new Date(body.scheduledDate);
    scheduledDate.setHours(0, 0, 0, 0);

    if (scheduledDate < today) {
      return NextResponse.json(
        {
          success: false,
          message: "Scheduled date must be today or a future date.",
        },
        { status: 400 }
      );
    }

    const supabase = await createClient();
    const ocularSlots = await getActiveOcularSlots(supabase);
    const slot = ocularSlots.find((candidate) => slotLabel(candidate) === body.timeSlot);

    if (!slot) {
      return NextResponse.json({ success: false, message: "Selected time slot is not available." }, { status: 400 });
    }

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        {
          success: false,
          message: "You must be logged in to schedule an ocular visit.",
        },
        { status: 401 }
      );
    }

    const { data: conflictingOcularVisit, error: ocularConflictError } = await supabase
      .from("ocular_visits")
      .select("visit_id")
      .eq("scheduled_date", body.scheduledDate)
      .eq("time_slot_id", slot.slot_id)
      .in("status", ["pending", "confirmed"]);

    if (ocularConflictError) {
      return NextResponse.json(
        {
          success: false,
          message: "Unable to validate existing ocular visits.",
        },
        { status: 500 }
      );
    }

    if ((conflictingOcularVisit ?? []).length >= slot.max_capacity) {
      return NextResponse.json(
        {
          success: false,
          message: "Selected time slot already has a confirmed ocular visit.",
        },
        { status: 409 }
      );
    }

    const { data: duplicateGuestVisit, error: duplicateGuestVisitError } = await supabase
      .from("ocular_visits")
      .select("visit_id")
      .eq("guest_id", user.id)
      .eq("scheduled_date", body.scheduledDate)
      .in("status", ["pending", "confirmed"])
      .limit(1)
      .maybeSingle();

    if (duplicateGuestVisitError) {
      return NextResponse.json(
        {
          success: false,
          message: "Unable to validate duplicate ocular visit dates.",
        },
        { status: 500 }
      );
    }

    if (duplicateGuestVisit) {
      return NextResponse.json(
        {
          success: false,
          message: "You already have an ocular visit scheduled for this date.",
        },
        { status: 409 }
      );
    }

    const referenceNumber = await generateOcularReferenceNumber(supabase);

    if (!referenceNumber) {
      return NextResponse.json(
        {
          success: false,
          message: "Unable to generate ocular visit reference number.",
        },
        { status: 500 }
      );
    }

    const { data: ocularVisit, error: insertError } = await supabase
      .from("ocular_visits")
      .insert({
        guest_id: user.id,
        reference_number: referenceNumber,
        scheduled_date: body.scheduledDate,
        time_slot_id: slot.slot_id,
        status: "pending",
      })
      .select("visit_id, reference_number, scheduled_date, time_slot_id, status, created_at")
      .single<OcularVisitInsertRow>();

    if (insertError || !ocularVisit) {
      return NextResponse.json(
        {
          success: false,
          message: "Failed to schedule ocular visit.",
        },
        { status: 500 }
      );
    }

    const { error: notificationError } = await notifyGuestAndStaff(supabase, {
      actorId: user.id,
      guestId: user.id,
      title: "Ocular visit scheduled",
      message: `Ocular visit ${ocularVisit.reference_number} is pending confirmation.`,
      entityType: "ocular_visit",
      entityId: ocularVisit.visit_id,
      guestActionUrl: "/ocular",
      staffActionUrl: "/admin/reservations",
    });

    if (notificationError) {
      console.warn("Failed to create ocular visit notifications:", notificationError);
    }

    await sendOcularVisitScheduledEmail({
    guestEmail: user.email ?? "",
    guestName:
      user.user_metadata?.full_name ||
      user.user_metadata?.name ||
      "Guest",
    referenceNumber: ocularVisit.reference_number,
    scheduledDate: ocularVisit.scheduled_date,
    timeSlot: body.timeSlot,
  });

    return NextResponse.json(
      {
        success: true,
        ocularVisit: {
          id: ocularVisit.visit_id,
          reference: ocularVisit.reference_number,
          scheduledDate: ocularVisit.scheduled_date,
          timeSlot: body.timeSlot,
          status: ocularVisit.status,
          createdAt: ocularVisit.created_at,
        },
      },
      { status: 201 }
    );
  } catch {
    return NextResponse.json(
      {
        success: false,
        message: "Unexpected error while scheduling ocular visit.",
      },
      { status: 500 }
    );
  }
}
