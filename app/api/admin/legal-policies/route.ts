import { NextResponse } from "next/server";
import { requireAdminStaff } from "@/lib/server/admin-audit";
import { LegalPolicyError, loadLegalPolicies } from "@/lib/server/legal-policies";
import { fetchAllPages } from "@/lib/server/fetch-all-pages";
import type { PublishedLegalDocument } from "@/lib/legal/documents";

export async function GET() {
  const staff = await requireAdminStaff();
  if (!staff) return NextResponse.json({ message: "Admin access required." }, { status: 403 });
  try {
    const policies = await loadLegalPolicies(staff.supabase);
    const history = await fetchAllPages<PublishedLegalDocument>((from, to) => staff.supabase.from("reservation_policies")
      .select("policy_id,document_type,version,title,content,published_at,published_by,change_note,is_active")
      .in("document_type", ["terms", "privacy"]).order("published_at", { ascending: false }).order("policy_id", { ascending: false }).range(from, to));
    return NextResponse.json({ policies, history }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ message: error instanceof LegalPolicyError ? error.message : "Unable to load policy history." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const staff = await requireAdminStaff();
  if (!staff) return NextResponse.json({ message: "Admin access required." }, { status: 403 });
  const body = await request.json().catch(() => null);
  if (!body || !["terms", "privacy"].includes(body.documentType) || typeof body.title !== "string" || body.title.trim().length < 3 || body.title.trim().length > 200
    || typeof body.content !== "string" || body.content.trim().length < 20 || body.content.length > 50000
    || typeof body.changeNote !== "string" || !body.changeNote.trim() || body.changeNote.length > 1000
    || !Number.isSafeInteger(body.expectedVersion) || body.expectedVersion < 1) {
    return NextResponse.json({ message: "Enter a document title, policy text, a reason for the revision and the current version." }, { status: 400 });
  }
  const { data, error } = await staff.supabase.rpc("publish_legal_policy", {
    p_document_type: body.documentType, p_title: body.title.trim(), p_content: body.content.trim(),
    p_change_note: body.changeNote.trim(), p_expected_version: body.expectedVersion,
  });
  if (error) return NextResponse.json({ message: error.code === "PGRST202" ? "Apply the legal-policy-versioning migration before publishing." : error.message },
    { status: error.code === "40001" ? 409 : error.code === "42501" ? 403 : error.code === "22023" ? 400 : 503 });
  return NextResponse.json({ success: true, policy: data });
}
