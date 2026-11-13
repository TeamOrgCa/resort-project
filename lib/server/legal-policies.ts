import type { SupabaseClient } from "@supabase/supabase-js";
import { legalPolicyToken, type LegalPolicies, type PublishedLegalDocument } from "@/lib/legal/documents";

export class LegalPolicyError extends Error {
  constructor(message: string, public status = 503) { super(message); }
}

export async function loadLegalPolicies(client: SupabaseClient, termsId: string | null = null, privacyId: string | null = null): Promise<LegalPolicies> {
  const { data, error } = await client.rpc("get_legal_policies", { p_terms_id: termsId, p_privacy_id: privacyId });
  if (error) throw new LegalPolicyError("Terms and Privacy Policy are unavailable. Check that the legal-policy-versioning migration is installed.");
  const rows = (data ?? []) as PublishedLegalDocument[];
  const terms = rows.find(row => row.document_type === "terms"), privacy = rows.find(row => row.document_type === "privacy");
  if (!terms || !privacy) throw new LegalPolicyError("Both Terms and Conditions and Privacy Policy must be published before continuing.");
  return { terms, privacy, version: legalPolicyToken(Number(terms.version), Number(privacy.version)) };
}

export async function requireCurrentLegalPolicies(client: SupabaseClient, acceptedVersion: string) {
  const policies = await loadLegalPolicies(client);
  if (policies.version !== acceptedVersion) throw new LegalPolicyError("The Terms and Conditions or Privacy Policy changed. Reload the policies, read them and agree again before continuing.", 409);
  return policies;
}
