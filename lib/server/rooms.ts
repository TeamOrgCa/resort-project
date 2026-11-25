import { createAdminClient } from "@/lib/supabase/admin";
import type { Room, RoomAssignment, RoomClass, RoomDashboard, RoomBill } from "@/lib/rooms/types";
import { fetchAllPages, fetchByIds } from "@/lib/server/fetch-all-pages";

export class RoomDataError extends Error {}

export async function loadRooms(): Promise<RoomDashboard> {
  const db = createAdminClient();
  const results = await Promise.allSettled([
    fetchAllPages((from, to) => db.from("physical_rooms").select("*").order("room_number").range(from, to)),
    fetchAllPages((from, to) => db.from("room_classifications").select("*").order("code", { ascending: false }).range(from, to)),
    fetchAllPages((from, to) => db.from("room_assignments").select("*").in("state", ["reserved", "occupied"]).order("starts_at").order("assignment_id").range(from, to)),
    fetchAllPages((from, to) => db.from("room_maintenance").select("*").is("completed_at", null).order("starts_at").order("maintenance_id").range(from, to)),
  ]);
  if (results.some(r => r.status === "rejected")) throw new RoomDataError("Unable to load room records. Apply docs/room-management-migration.sql if it has not been installed, then refresh.");
  const alerts = await db.rpc("room_emit_alerts");
  if (alerts.error) throw new RoomDataError("Unable to refresh room occupancy alerts. Check the room migration.");
  const [rooms, classes, assignments, maintenance] = results.map(r => r.status === "fulfilled" ? r.value : []);
  const ids = [...new Set(assignments.map(a => a.reservation_id as string))];
  // Fetch by IDs rather than relying on legacy PostgREST relationships, some of
  // which are absent in the deployed schema. Do not fetch unrelated guest data.
  const reservations = { data: await fetchByIds(ids, (batch, from, to) => db.from("reservations").select("reservation_id,reference_number,commercial_type,room_pricing,status,start_datetime,end_datetime,payment_deadline_at,guest_id,walk_in_guest_id").in("reservation_id", batch).order("reservation_id").range(from, to)) };
  const guestIds = [...new Set((reservations.data ?? []).map(r => r.guest_id).filter(Boolean))];
  const walkIds = [...new Set((reservations.data ?? []).map(r => r.walk_in_guest_id).filter(Boolean))];
  const people = await Promise.all([
    fetchByIds(guestIds, (batch, from, to) => db.from("guests").select("id,first_name,last_name,phone_number").in("id", batch).order("id").range(from, to)).then(data => ({ data })),
    fetchByIds(walkIds, (batch, from, to) => db.from("walk_in_guests").select("walk_in_guest_id,first_name,last_name,phone_number").in("walk_in_guest_id", batch).order("walk_in_guest_id").range(from, to)).then(data => ({ data })),
  ]);
  const now = Date.now();
  const enriched = assignments.flatMap(a => {
    const reservation = reservations.data?.find(r => r.reservation_id === a.reservation_id);
    if (!reservation || (a.state !== "occupied" && (!["pending", "payment_submitted", "confirmed", "reschedule_requested"].includes(reservation.status) || reservation.status === "pending" && reservation.payment_deadline_at && Date.parse(reservation.payment_deadline_at) <= now))) return [];
    const guest = reservation.guest_id ? people[0].data?.find(g => g.id === reservation.guest_id) : people[1].data?.find(g => g.walk_in_guest_id === reservation.walk_in_guest_id);
    return [{ ...a, reservation, guest_name: guest ? `${guest.first_name} ${guest.last_name}` : "Guest details unavailable", contact: guest?.phone_number ?? "—" } as RoomAssignment];
  });
  return {
    rooms: rooms.map(r => ({ ...r, classification: classes.find(c => c.classification_id === r.classification_id),
      status: r.status !== "occupied" && maintenance.some(m => m.room_id === r.room_id && Date.parse(m.starts_at) <= now) ? "maintenance" : r.status,
      condition_notes: r.status !== "occupied" ? maintenance.find(m => m.room_id === r.room_id && Date.parse(m.starts_at) <= now)?.reason ?? r.condition_notes : r.condition_notes,
      current: enriched.find(a => a.room_id === r.room_id && a.state === "occupied") ?? null,
      upcoming: enriched.filter(a => a.room_id === r.room_id && a.state === "reserved"),
      maintenance: maintenance.filter(m => m.room_id === r.room_id),
    } as Room)),
    classifications: classes as RoomClass[], updated_at: new Date().toISOString(), server_now: new Date().toISOString(),
  };
}

export async function loadRoomBill(reservationId: string): Promise<RoomBill> {
  const db = createAdminClient();
  const results = await Promise.all([
    db.from("transactions").select("total_amount,paid_amount,balance,status,discount_amount").eq("reservation_id", reservationId).single(),
    db.from("room_charges").select("charge_id,kind,description,amount,room_id").eq("reservation_id", reservationId),
    db.from("reservation_services").select("service_id,quantity,price_at_time").eq("reservation_id", reservationId),
  ]);
  if (results.some(r => r.error)) throw new RoomDataError("Unable to load the reservation bill.");
  const services = results[2].data ?? [];
  const catalog = services.length ? await db.from("services").select("service_id,name").in("service_id", services.map(s => s.service_id)) : { data: [], error: null };
  if (catalog.error) throw new RoomDataError("Unable to load billed services.");
  return { ...results[0].data!, charges: results[1].data ?? [], services: services.map(s => ({ name: catalog.data?.find(c => c.service_id === s.service_id)?.name ?? "Booked service", amount: Number(s.quantity) * Number(s.price_at_time) })) };
}
