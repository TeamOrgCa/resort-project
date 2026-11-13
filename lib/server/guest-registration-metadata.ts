import type { GuestRegistration } from "@/lib/auth/guest-registration";
import type { LegalPolicies } from "@/lib/legal/documents";

/** Build account metadata only from a server-validated registration. */
export function guestRegistrationMetadata(guest: GuestRegistration, policies: LegalPolicies) {
  return {
    first_name: guest.firstName,
    last_name: guest.lastName,
    middle_name: guest.middleName,
    phone_number: guest.phoneNumber,
    address: guest.address,
    legal_consent: {
      terms_accepted: true,
      privacy_acknowledged: true,
      policy_version: policies.version,
      terms_policy_id: policies.terms.policy_id,
      terms_version: policies.terms.version,
      privacy_policy_id: policies.privacy.policy_id,
      privacy_version: policies.privacy.version,
      accepted_at: new Date().toISOString(),
    },
  };
}
