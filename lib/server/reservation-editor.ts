import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadPackageRates } from "@/lib/server/package-rates";
import { reservationEditAccess, type EditableReservation, type SelectedService, type SelectedUnit, type Bill, type CatalogService, type CatalogUnit } from "@/lib/booking/reservation-edit";

export async function loadReservationEditor(id: string) {
  const admin = createAdminClient();
  const [r, s, u, b, cs, cu, payments, reschedules] = await Promise.all([
    admin.from("reservations").select("*").eq("reservation_id", id).maybeSingle<EditableReservation>(),
    admin.from("reservation_services").select("service_id,quantity,price_at_time").eq("reservation_id", id).order("service_id"),
    admin.from("reservation_units").select("unit_id,quantity,price_per_night").eq("reservation_id", id).order("unit_id"),
    admin.from("transactions").select("total_amount,paid_amount,status").eq("reservation_id", id).maybeSingle<Bill>(),
    admin.from("services").select("service_id,name,price,is_active").order("name"),
    admin.from("units").select("unit_id,name,base_price,is_active,archived_at").order("name"),
    admin.from("payments").select("payment_id").eq("reservation_id", id).eq("status", "pending").limit(1),
    admin.from("reservation_reschedules").select("reschedule_id").eq("reservation_id", id).eq("status", "pending").limit(1),
  ]);
  for (const result of [r, s, u, b, cs, cu, payments, reschedules]) if (result.error) throw new Error("Unable to load reservation details.");
  if (!r.data) return null;
  if (!b.data) throw new Error("This reservation has no billing record. Resolve it before editing.");
  if (!r.data.package_rate_version) throw new Error("This reservation needs the package-rates migration before editing.");
  const packageSchedule = await loadPackageRates(admin, r.data.package_rate_version);
  const services = (s.data ?? []) as SelectedService[];
  const units = (u.data ?? []) as SelectedUnit[];
  const bill = { ...b.data, total_amount: Number(b.data.total_amount), paid_amount: Number(b.data.paid_amount ?? 0) };
  const snapshot = { updatedAt: r.data.updated_at, totalAmount: bill.total_amount, paidAmount: bill.paid_amount,
    services: services.map(s => ({ serviceId: s.service_id, quantity: s.quantity, price: Number(s.price_at_time) })),
    units: units.map(u => ({ unitId: u.unit_id, quantity: u.quantity, price: Number(u.price_per_night) })) };
  const version = createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
  let guest = null;
  if (r.data.guest_id || r.data.walk_in_guest_id) {
    const result = await admin.from(r.data.guest_id ? "guests" : "walk_in_guests")
      .select("first_name,last_name,email,phone_number")
      .eq(r.data.guest_id ? "id" : "walk_in_guest_id", r.data.guest_id ?? r.data.walk_in_guest_id).maybeSingle();
    if (result.error) throw new Error("Unable to load guest details.");
    guest = result.data;
  }
  return { reservation: r.data, guest, services, units, bill, packageRates: packageSchedule.rates, catalogServices: (cs.data ?? []) as CatalogService[],
    catalogUnits: (cu.data ?? []) as CatalogUnit[], snapshot, version,
    ...reservationEditAccess(r.data, Boolean(payments.data?.length), Boolean(reschedules.data?.length)) };
}
