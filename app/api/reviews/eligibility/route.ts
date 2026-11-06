import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const client = await createClient();
  const { data: { user }, error: authError } = await client.auth.getUser();
  const headers = { "Cache-Control": "private, no-store" };
  if (authError || !user) return NextResponse.json({ eligible: false, message: "Sign in with your guest account to submit a review.", reservations: [] }, { headers });
  const { data: guest, error: guestError } = await client.from("guests").select("id,is_active").eq("id", user.id).maybeSingle();
  if (guestError) return NextResponse.json({ message: "Unable to check review eligibility. Please retry." }, { status: 503, headers });
  if (!guest?.is_active) return NextResponse.json({ eligible: false, message: "Only active guest accounts can submit reviews.", reservations: [] }, { headers });
  const { data, error } = await client.from("reservations").select("reservation_id,reference_number,end_datetime").eq("guest_id", user.id).order("end_datetime", { ascending: false }).limit(100);
  if (error) return NextResponse.json({ message: "Unable to load your reservations. Please retry." }, { status: 503, headers });
  return NextResponse.json({ eligible: true, message: "You can share a review. Linking a reservation is optional.", reservations: data ?? [] }, { headers });
}
