import { createAdminClient } from "@/lib/supabase/admin";
import { swimmingRoomsQuote, type SwimmingRoomSelection } from "@/lib/booking/swimming-rooms";

export class SwimmingRoomsError extends Error {
  constructor(message: string, public status = 409) { super(message); }
}

export async function quoteSwimmingRooms(rooms: SwimmingRoomSelection[], start: string, end: string) {
  const { data, error } = await createAdminClient().rpc("room_guest_catalog", { p_from: start, p_to: end });
  if (error || !data) throw new SwimmingRoomsError("Unable to check room availability. Please retry.", 503);
  try { return swimmingRoomsQuote(data, rooms, start, end, true); }
  catch (e) { throw new SwimmingRoomsError(e instanceof Error ? e.message : "Review your room choices."); }
}

export async function finalizeSwimmingRooms(reservation: string, actor: string, rooms: SwimmingRoomSelection[], code: string | null, gross: number, net: number) {
  const { data, error } = await createAdminClient().rpc("swimming_finalize_booking", {
    p_reservation: reservation, p_actor: actor, p_rooms: rooms, p_code: code, p_expected_gross: gross, p_expected_net: net,
  });
  if (error) throw new SwimmingRoomsError(error.code === "PGRST202"
    ? "Swimming room booking is unavailable. Apply docs/swimming-room-addons-migration.sql."
    : error.message, error.code === "40001" ? 409 : error.code === "22023" ? 400 : 503);
  if (!data || Number(data.totalAmount) !== net) throw new SwimmingRoomsError("Unable to confirm the saved booking total. Check your bookings before retrying.", 503);
}
