import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { loadPackageRates } from "@/lib/server/package-rates";
import { configuredFaqs, exactFaqAnswer, wantsHumanSupport } from "@/lib/chatbot/config";
import { loadChatbotSettings, requestHumanSupport } from "@/lib/server/chatbot-support";
import { additionalServiceListReply, resortServicesReply, wantsAdditionalServices, wantsServiceList } from "@/lib/chatbot/services";
import {
  getClientKey,
  getBookingGuidance,
  getSafetyResponse,
  isRateLimited,
  limitOutput,
  MAX_MESSAGE_LENGTH,
  MAX_OUTPUT_TOKENS,
  normalizeMessage,
  normalizeHistory,
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

    if (isRateLimited(getClientKey(req))) {
      return NextResponse.json(
        { error: "Too many messages. Please wait a few minutes and try again." },
        { status: 429 }
      );
    }

    const body = await req.json().catch(() => null);
    const message = normalizeMessage(body?.message);
    const history = normalizeHistory(body?.history);

    if (!message) {
      return NextResponse.json(
        { error: `Message is required and must be ${MAX_MESSAGE_LENGTH} characters or fewer.` },
        { status: 400 }
      );
    }

    const safetyResponse = getSafetyResponse(message, true);
    if (safetyResponse && !wantsHumanSupport(message)) {
      return NextResponse.json({ reply: safetyResponse });
    }

    const supabase = await createClient();
    const settings = await loadChatbotSettings().catch(() => null);
    if (!settings) return NextResponse.json({ error: "Approved FAQ content is temporarily unavailable. Please try again or contact the resort through its Facebook page." }, { status: 503 });
    if (wantsHumanSupport(message)) {
      const { data: { user }, error } = await supabase.auth.getUser();
      const previous = history.filter(turn => turn.role === "user").at(-1)?.content;
      const safeMessage = safetyResponse ? "Human support requested for an account or privacy concern. Sensitive details omitted." : message;
      const reason = previous && !getSafetyResponse(previous, true) ? `${safeMessage}\nPrevious question: ${previous}` : safeMessage;
      return NextResponse.json(await requestHumanSupport(supabase, error ? null : user, reason, settings));
    }
    const faqs = configuredFaqs(settings);
    const approvedAnswer = exactFaqAnswer(message, faqs);
    if (approvedAnswer) return NextResponse.json({ reply: approvedAnswer });
    const scopeResponse = getSafetyResponse(message, history.length > 0);
    if (scopeResponse) return NextResponse.json({ reply: scopeResponse });
    if (wantsServiceList(message)) {
      if (!wantsAdditionalServices(message)) return NextResponse.json({ reply: resortServicesReply() });
      const services = await supabase.from("services").select("name,price").eq("is_active", true).order("name")
        .then(result => result.error ? null : result.data, () => null);
      return NextResponse.json({ reply: additionalServiceListReply(services) });
    }
    const schedule = await loadPackageRates(supabase).catch(() => null);
    // General FAQ answers come from saved admin content. Keep deterministic
    // guidance only for live availability, package quotes and booking steps.
    const useWorkflowGuidance = /\b(?:availability|available|vacant|fully booked)\b/i.test(message)
      || (/\b(?:swimming|pool|package)\b/i.test(message) && /\b(?:rates?|prices?|cost)\b/i.test(message))
      || /^how (?:do|can) i book\b/i.test(message);
    const bookingGuidance = useWorkflowGuidance ? getBookingGuidance(message, schedule?.rates ?? null, schedule?.times) : null;
    if (bookingGuidance) return NextResponse.json({ reply: bookingGuidance });

    if (!geminiApiKey) {
      return NextResponse.json({ error: "ChatBot Mars is not configured." }, { status: 503 });
    }

    let bookings: GuestBooking[] | null = null;
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
      systemInstruction: `${instructionForGuestBookings(bookings, Boolean(user && !userError), schedule?.rates ?? null, schedule?.times, JSON.stringify({ approvedFaqs: faqs, contact: { address: settings["resort.address"], phones: settings["resort.contact_numbers"], email: settings["resort.email"], social: settings["resort.social_links"] } }))}\n\nThe reference contains current administrator-approved FAQs and contact details. Use the approved answers for general questions, including paraphrases. If the approved reference does not answer a question, say that the information is unavailable and direct the guest to the current contact channels. Never use prior chat answers as a source for missing facts. Live package rates, private booking facts and safety rules take priority.`,
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
      },
    });

    const contents = [
      ...history.map((turn) => ({ role: turn.role === "assistant" ? "model" : "user", parts: [{ text: turn.content }] })),
      { role: "user", parts: [{ text: message }] },
    ];
    const result = await model.generateContent({ contents });
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
