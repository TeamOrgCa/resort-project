import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { loadPackageRates } from "@/lib/server/package-rates";

export async function GET() {
  try { return NextResponse.json({ success: true, schedule: await loadPackageRates(await createClient()) }, { headers: { "Cache-Control": "no-store" } }); }
  catch { return NextResponse.json({ success: false, message: "Booking prices are temporarily unavailable. Please try again later." }, { status: 503 }); }
}
