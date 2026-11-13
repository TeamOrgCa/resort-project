import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { LegalPolicyError, loadLegalPolicies } from "@/lib/server/legal-policies";

export async function GET(request: Request) {
  try {
    const client = await createClient(), url = new URL(request.url);
    const reservationId = url.searchParams.get("reservationId");
    let termsId: string | null = null, privacyId: string | null = null, legacy = false;
    if (reservationId) {
      if (!/^[a-f\d-]{36}$/i.test(reservationId)) return NextResponse.json({ message: "Invalid reservation." }, { status: 400 });
      const { data: { user } } = await client.auth.getUser();
      if (!user) return NextResponse.json({ message: "Sign in to view the booking's policies." }, { status: 401 });
      const { data, error } = await client.from("reservations").select("guest_id,terms_policy_id,privacy_policy_id")
        .eq("reservation_id", reservationId).eq("guest_id", user.id).maybeSingle();
      if (error) throw new LegalPolicyError("Unable to load the booking's policy versions.");
      if (!data) return NextResponse.json({ message: "Booking not found." }, { status: 404 });
      termsId = data.terms_policy_id; privacyId = data.privacy_policy_id;
      legacy = !termsId || !privacyId;
      if (legacy) {
        const { data: baseline, error: baselineError } = await client.rpc("get_baseline_legal_policies");
        if (baselineError) throw new LegalPolicyError("The booking's baseline policies are unavailable.");
        termsId = baseline?.find((row: { document_type: string }) => row.document_type === "terms")?.policy_id;
        privacyId = baseline?.find((row: { document_type: string }) => row.document_type === "privacy")?.policy_id;
        if (!termsId || !privacyId) throw new LegalPolicyError("The booking's baseline policies are unavailable.");
      }
    }
    return NextResponse.json({ policies: { ...await loadLegalPolicies(client, termsId, privacyId), legacy } }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "Policies are unavailable." }, { status: error instanceof LegalPolicyError ? error.status : 503 });
  }
}
