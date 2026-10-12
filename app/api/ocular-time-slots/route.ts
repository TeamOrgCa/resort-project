import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActiveOcularSlots } from "@/repositories/catalogRepository";

export async function GET() {
  try {
    const slots = await getActiveOcularSlots(await createClient());
    return NextResponse.json({ success: true, slots }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ success: false, message: "Failed to load ocular time slots." }, { status: 500 });
  }
}
