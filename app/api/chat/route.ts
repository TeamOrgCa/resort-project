import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextRequest, NextResponse } from "next/server";
import {
  getClientKey,
  getSafetyResponse,
  isRateLimited,
  limitOutput,
  MAX_MESSAGE_LENGTH,
  MAX_OUTPUT_TOKENS,
  normalizeMessage,
  systemInstruction,
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

    const genAI = new GoogleGenerativeAI(geminiApiKey);
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      systemInstruction,
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