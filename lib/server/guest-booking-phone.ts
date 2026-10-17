import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizePhilippineMobile, PH_MOBILE_ERROR } from "@/lib/validation/phone";

export class GuestBookingPhoneError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export async function saveGuestBookingPhone(client: SupabaseClient, guestId: string, submitted: unknown) {
  let value = submitted;
  if (value === undefined) {
    const { data, error } = await client.from("guests").select("phone_number").eq("id", guestId).maybeSingle();
    if (error) throw new GuestBookingPhoneError("Unable to verify your contact number. Please retry.", 503);
    value = data?.phone_number;
  }
  const phone = normalizePhilippineMobile(value);
  if (!phone) throw new GuestBookingPhoneError(PH_MOBILE_ERROR);
  // Reservations currently use the guest profile for their contact details.
  // Persist the validated booking contact so staff sees the number entered.
  const { error } = await client.from("guests").update({ phone_number: phone }).eq("id", guestId);
  if (error) throw new GuestBookingPhoneError("Unable to save your contact number. Please retry.", 503);
  return phone;
}
