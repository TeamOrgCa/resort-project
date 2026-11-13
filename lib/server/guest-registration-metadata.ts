import type { GuestRegistration } from "@/lib/auth/guest-registration";

/** Build account metadata only from a server-validated registration. */
export function guestRegistrationMetadata(guest: GuestRegistration) {
  return {
    first_name: guest.firstName,
    last_name: guest.lastName,
    middle_name: guest.middleName,
    phone_number: guest.phoneNumber,
    address: guest.address,
    legal_consent: {
      terms_accepted: true,
      privacy_acknowledged: true,
      policy_version: guest.legalPolicyVersion,
      accepted_at: new Date().toISOString(),
    },
  };
}
