import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { customerAccountUser } from "@/lib/auth/customer-access";
import { savePublicBooking } from "@/lib/server/public-booking-request";
import { LegalPolicyError } from "@/lib/server/legal-policies";
export async function POST(request: Request) {
  try {
    const client = await createClient(), { data: { user } } = await client.auth.getUser();
    if (!await customerAccountUser(client, user)) return NextResponse.json({ message: "Sign in with your customer account." }, { status: 401 });
    return await savePublicBooking(request, user!.id, client);
  } catch (e) { return NextResponse.json({ message: e instanceof LegalPolicyError ? e.message : "Unable to save this booking.", code: e instanceof LegalPolicyError && e.status === 409 ? "LEGAL_POLICY_CHANGED" : undefined }, { status: e instanceof LegalPolicyError ? e.status : 503 }); }
}
