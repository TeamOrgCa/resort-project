import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  getClientKey,
  getSafetyResponse,
  isRateLimited,
  limitOutput,
  MAX_MESSAGE_LENGTH,
  MAX_OUTPUT_TOKENS,
  normalizeMessage,
  instructionForGuestBookings,
  type GuestBooking,
} from "@/lib/chatbot/guardrails";

const geminiApiKey = process.env.GEMINI_API_KEY;
const CHATBOT_ENABLED = true;

export async function POST(req: NextRequest) {
  try {
    if (!CHATBOT_ENABLED) {
      return NextResponse.json(
        { error: "ChatBot Mars is currently disabled." },
        { status: 503 }
      );
    }

    if (!geminiApiKey) {
      return NextResponse.json({ error: "ChatBot Mars is not configured." }, { status: 503 });
    }

    if (isRateLimited(getClientKey(req))) {
      return NextResponse.json(
        { error: "Too many messages. Please wait a few minutes and try again." },
        { status: 429 }
      );
    }

    const body = await req.json().catch(() => null);
    const message = normalizeMessage(body?.message);

    if (!message) {
      return NextResponse.json(
        { error: `Message is required and must be ${MAX_MESSAGE_LENGTH} characters or fewer.` },
        { status: 400 }
      );
    }

    const safetyResponse = getSafetyResponse(message);
    if (safetyResponse) {
      return NextResponse.json({ reply: safetyResponse });
    }

    let bookings: GuestBooking[] | null = null;
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (!userError && user) {
      const { data, error } = await supabase
        .from("reservations")
        .select("reference_number, start_datetime, end_datetime, booking_mode, adult_count, child_count, status, payment_deadline_at")
        .eq("guest_id", user.id)
        .order("created_at", { ascending: false })
        .limit(10);
      if (!error) bookings = (data ?? []) as GuestBooking[];
    }

    const genAI = new GoogleGenerativeAI(geminiApiKey);
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      systemInstruction: instructionForGuestBookings(bookings, Boolean(user && !userError)),
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
      },
    });

    const result = await model.generateContent(message);
    const response = await result.response;
    const text = limitOutput(response.text());

    if (!text) {
      return NextResponse.json(
        { error: "I could not generate a safe response. Please contact the resort directly." },
        { status: 502 }
      );
    }

    return NextResponse.json({ reply: text });
  } catch (error) {
    console.error("Gemini API error:", error);
    return NextResponse.json(
      { error: "Failed to generate response" },
      { status: 500 }
    );
  }
}
