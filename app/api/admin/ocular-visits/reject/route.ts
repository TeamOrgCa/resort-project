import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json({ success: false, message: "Ocular visits are automatically confirmed. Use cancellation or mark visited instead." }, { status: 410 });
}
