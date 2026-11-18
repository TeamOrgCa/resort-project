import type { SupabaseClient } from "@supabase/supabase-js";
import { ADVANCE_BOOKING_KEY, advanceBookingDays, maximumBookingDate, advanceBookingIssue } from "@/lib/booking/advance-window";
import { manilaDateKey } from "@/lib/booking/manila-date";
import { createAdminClient } from "@/lib/supabase/admin";

export async function loadAdvanceBookingWindow(client: SupabaseClient = createAdminClient(), now = Date.now()) {
  const { data, error } = await client.from("business_settings").select("setting_value").eq("setting_key", ADVANCE_BOOKING_KEY).maybeSingle();
  if (error) throw new Error("Unable to load the advance booking limit. Please retry.");
  const days = advanceBookingDays(data?.setting_value);
  return { maximumAdvanceBookingDays: days, maxBookingDate: maximumBookingDate(days, now) };
}
export async function checkAdvanceBooking(start: string, client?: SupabaseClient) {
  const { maxBookingDate } = await loadAdvanceBookingWindow(client);
  return advanceBookingIssue(manilaDateKey(start), maxBookingDate);
}
