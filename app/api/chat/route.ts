import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextRequest, NextResponse } from "next/server";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
const CHATBOT_ENABLED = false;

export async function POST(req: NextRequest) {
  try {
    if (!CHATBOT_ENABLED) {
      return NextResponse.json(
        { error: "ChatBot Mars is currently disabled." },
        { status: 503 }
      );
    }

    const { message } = await req.json();

    if (!message) {
      return NextResponse.json(
        { error: "Message is required" },
        { status: 400 }
      );
}

    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash", // fast + cheap
    });

    const result = await model.generateContent(message);
    const response = await result.response;
    const text = response.text();

    return NextResponse.json({ reply: text });
  } catch (error) {
    console.error("Gemini API error:", error);
    return NextResponse.json(
      { error: "Failed to generate response" },
      { status: 500 }
    );
  }
}