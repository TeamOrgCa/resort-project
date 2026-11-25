import type { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPages } from "./fetch-all-pages";
import { matchesReservationType, type ReservationTypeFilter } from "@/lib/booking/commercial-types";

type Client = ReturnType<typeof createAdminClient>;
type LinkedRecord = { reservation_id?: string | null };

/** Payment dates can be much later than booking dates. Look up their reservations independently. */
export async function reservationTypesById(client: Client, records: LinkedRecord[]) {
  const ids = [...new Set(records.flatMap(row => row.reservation_id ? [row.reservation_id] : []))];
  const types = new Map<string, string>();
  for (let index = 0; index < ids.length; index += 200) {
    const rows = await fetchAllPages<{ reservation_id: string; commercial_type?: string }>((from, to) => client.from("reservations")
      .select("reservation_id,commercial_type").in("reservation_id", ids.slice(index, index + 200)).order("reservation_id").range(from, to));
    for (const row of rows) types.set(row.reservation_id, row.commercial_type ?? "private_swimming");
  }
  return types;
}

export async function filterReservationRecords<T extends LinkedRecord>(client: Client, rows: T[], filter: ReservationTypeFilter): Promise<T[]> {
  if (filter === "all") return rows;
  const types = await reservationTypesById(client, rows);
  return rows.filter(row => Boolean(row.reservation_id && types.has(row.reservation_id)) && matchesReservationType(types.get(row.reservation_id!), filter));
}
