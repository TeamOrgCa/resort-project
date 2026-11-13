export const LEGAL_POLICY_VERSION = "terms:1;privacy:1";
export function legalPoliciesFixture({termsVersion=1,privacyVersion=1}={}) {
  return {
    version:`terms:${termsVersion};privacy:${privacyVersion}`,
    terms:{policy_id:`11111111-1111-4111-8111-${String(termsVersion).padStart(12,"0")}`,document_type:"terms",version:termsVersion,title:"Terms and Conditions",content:"# Reservations\n\nPublished Terms and Conditions for resort guests.\n\n- Review your bill before paying.",published_at:"2026-11-13T00:00:00Z",is_active:true},
    privacy:{policy_id:`22222222-2222-4222-8222-${String(privacyVersion).padStart(12,"0")}`,document_type:"privacy",version:privacyVersion,title:"Privacy Policy",content:"# Privacy\n\nPublished Privacy Policy for guest accounts and booking records.",published_at:"2026-11-13T00:00:00Z",is_active:true},
  };
}
