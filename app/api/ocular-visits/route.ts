import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

interface OcularVisitPayload {
  scheduledDate: string;
  timeSlot: string;
}

interface OcularVisitInsertRow {
  visit_id: string;
  reference_number: string;
  scheduled_date: string;
  time_slot: string;
  status: string;
  created_at: string;
}

const ALLOWED_TIME_SLOTS = ["08:00-09:00", "09:00-10:00", "10:00-11:00", "13:00-14:00", "14:00-15:00"];

const isValidDate = (value: string) => {
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime());
};

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

    if (!body.timeSlot || typeof body.timeSlot !== "string" || !ALLOWED_TIME_SLOTS.includes(body.timeSlot)) {
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
        time_slot: body.timeSlot,
        status: "pending",
      })
      .select("visit_id, reference_number, scheduled_date, time_slot, status, created_at")
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

    return NextResponse.json(
      {
        success: true,
        ocularVisit: {
          id: ocularVisit.visit_id,
          reference: ocularVisit.reference_number,
          scheduledDate: ocularVisit.scheduled_date,
          timeSlot: ocularVisit.time_slot,
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
