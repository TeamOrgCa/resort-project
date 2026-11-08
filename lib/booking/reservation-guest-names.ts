import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchByIds } from "@/lib/server/fetch-all-pages";

export type ReservationGuestIdentity = { reservation_id: string; guest_id?: string | null; walk_in_guest_id?: string | null };
type GuestName = { first_name: string | null; middle_name: string | null; last_name: string | null };

/** Batch both booking sources; never use the payment sender as the booking guest. */
export async function loadReservationGuestNames(client: SupabaseClient, reservations: ReservationGuestIdentity[]): Promise<Record<string, string>> {
  const guestIds = [...new Set(reservations.map(row => row.guest_id).filter((id): id is string => Boolean(id)))];
  const walkInIds = [...new Set(reservations.map(row => row.walk_in_guest_id).filter((id): id is string => Boolean(id)))];
  const [guests, walkIns] = await Promise.all([
    fetchByIds<GuestName & { id: string }>(guestIds, (ids, from, to) => client.from("guests").select("id, first_name, middle_name, last_name").in("id", ids).order("id").range(from, to)),
    fetchByIds<GuestName & { walk_in_guest_id: string }>(walkInIds, (ids, from, to) => client.from("walk_in_guests").select("walk_in_guest_id, first_name, middle_name, last_name").in("walk_in_guest_id", ids).order("walk_in_guest_id").range(from, to)),
  ]);
  const name = (row: GuestName) => [row.first_name, row.middle_name, row.last_name].map(part => part?.trim()).filter(Boolean).join(" ");
  const registered = new Map(guests.map(row => [row.id, name(row)]));
  const walkIn = new Map(walkIns.map(row => [row.walk_in_guest_id, name(row)]));
  return Object.fromEntries(reservations.map(row => [row.reservation_id,
    (row.guest_id ? registered.get(row.guest_id) : row.walk_in_guest_id ? walkIn.get(row.walk_in_guest_id) : null) || "Guest unavailable"]));
}
