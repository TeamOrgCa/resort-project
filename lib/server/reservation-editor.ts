import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadPackageRates } from "@/lib/server/package-rates";
import { reservationEditAccess, type EditableReservation, type SelectedService, type SelectedUnit, type Bill, type CatalogService, type CatalogUnit } from "@/lib/booking/reservation-edit";
import type { SwimmingRoomSelection } from "@/lib/booking/swimming-rooms";

export async function loadReservationEditor(id: string, options: { allowSwimmingRooms?: boolean } = {}) {
  const admin = createAdminClient();
  const [r, s, u, b, cs, cu, payments, reschedules, assignments] = await Promise.all([
    admin.from("reservations").select("*").eq("reservation_id", id).maybeSingle<EditableReservation>(),
    admin.from("reservation_services").select("service_id,quantity,price_at_time,billing_type").eq("reservation_id", id).order("service_id"),
    admin.from("reservation_units").select("unit_id,quantity,price_per_night").eq("reservation_id", id).order("unit_id"),
    admin.from("transactions").select("total_amount,paid_amount,status,discount_amount,discount_kind,discount_eligible_guests,discount_promo_code,discount_promo_type,discount_promo_value").eq("reservation_id", id).maybeSingle<Bill>(),
    admin.from("services").select("service_id,name,price,max_quantity,billing_type,is_active").order("name"),
    admin.from("units").select("unit_id,name,base_price,is_active,archived_at").order("name"),
    admin.from("payments").select("payment_id").eq("reservation_id", id).eq("status", "pending").limit(1),
    admin.from("reservation_reschedules").select("reschedule_id").eq("reservation_id", id).eq("status", "pending").limit(1),
    options.allowSwimmingRooms ? admin.from("room_assignments").select("assignment_id,room_id,occupants,starts_at,expected_checkout,pricing_snapshot").eq("reservation_id", id).eq("state", "reserved").order("assignment_id") : Promise.resolve({ data: [], error: null }),
  ]);
  for (const result of [r, s, u, b, cs, cu, payments, reschedules, assignments]) if (result.error) throw new Error("Unable to load reservation details.");
  if (!r.data) return null;
  if (!b.data) throw new Error("This reservation has no billing record. Resolve it before editing.");
  const publicAdmission = r.data.commercial_type === "public_swimming" && !r.data.room_pricing;
  if (!publicAdmission && !r.data.package_rate_version) throw new Error("This reservation needs the package-rates migration before editing.");
  const packageSchedule = publicAdmission ? null : await loadPackageRates(admin, r.data.package_rate_version);
  const services = (s.data ?? []) as SelectedService[];
  const units = (u.data ?? []) as SelectedUnit[];
  const bill = { ...b.data, total_amount: Number(b.data.total_amount), paid_amount: Number(b.data.paid_amount ?? 0) };
  const claims = (assignments.data ?? []) as { assignment_id: string; room_id: string; occupants: number; starts_at: string; expected_checkout: string; pricing_snapshot: Record<string, unknown> | null }[];
  const additionalRooms: SwimmingRoomSelection[] = claims.filter(a => a.pricing_snapshot?.swimming_room && a.pricing_snapshot.included === false).map(a => {
    const p = a.pricing_snapshot!;
    return { assignmentId: a.assignment_id, classificationId: String(p.classification_id), quantity: 1, pricingVersion: Number(p.version), occupants: a.occupants,
      durationHours: (Date.parse(a.expected_checkout) - Date.parse(a.starts_at)) / 3600000, name: String(p.name),
      accommodation: Number(p.accommodation ?? 0), additionalGuestCharge: Number(p.additional_guest_charge ?? 0), unitPrice: Number(p.accommodation ?? 0) + Number(p.additional_guest_charge ?? 0),
      baseHours: Number(p.base_hours ?? p.duration_hours), baseRate: Number(p.base_rate ?? p.accommodation), extensionHours: Number(p.extension_hours ?? 0), extensionHourlyRate: Number(p.extension_hourly_rate ?? 0), extensionCharge: Number(p.extension_charge ?? 0), extraGuests: Number(p.extra_guests ?? 0) };
  });
  const snapshot = { discount: { amount: Number(bill.discount_amount ?? 0), eligible: Number(bill.discount_eligible_guests ?? 0), code: bill.discount_promo_code ?? null, type: bill.discount_promo_type ?? null, value: Number(bill.discount_promo_value ?? 0) }, updatedAt: r.data.updated_at, totalAmount: bill.total_amount, paidAmount: bill.paid_amount,
    swimmingRooms: claims.map(a => ({ assignmentId: a.assignment_id, roomId: a.room_id, occupants: a.occupants, startsAt: Date.parse(a.starts_at) / 1000, checkout: Date.parse(a.expected_checkout) / 1000, pricingSnapshot: a.pricing_snapshot })),
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
  const reservation = r.data;
  const catalogServices = ((cs.data ?? []) as CatalogService[]).map(service => reservation.commercial_type === "public_swimming" && service.billing_type === "duration"
    ? { ...service, max_quantity: Math.min(service.max_quantity ?? 10000, Math.floor((Date.parse(reservation.end_datetime) - Date.parse(reservation.start_datetime)) / 3600000)) } : service);
  const access = reservationEditAccess(r.data, Boolean(payments.data?.length), Boolean(reschedules.data?.length));
  const billingLocked = Boolean(access.lockedReason);
  if (r.data.commercial_type === "room_accommodation" || r.data.room_pricing) { access.lockedReason = "Use Room Management to update room assignments, guest stays and charges."; access.canChangeDetails = false; }
  if (r.data.swimming_room_choices?.length && !options.allowSwimmingRooms) { access.lockedReason ??= "This booking includes paid room add-ons. Contact resort staff to manage the rooms and billing through Room Management."; access.canChangeDetails = false; }
  return { reservation: r.data, guest, services, units, bill, additionalRooms, packageRates: packageSchedule?.rates ?? null, packageTimes: packageSchedule?.times, catalogServices,
    catalogUnits: r.data.commercial_type === "public_swimming" ? [] : (cu.data ?? []) as CatalogUnit[], snapshot, version,
    lateRescheduleEligible: !r.data.swimming_room_choices?.length && r.data.status === "confirmed" && !r.data.checked_in_at && !payments.data?.length && !reschedules.data?.length,
    billingLocked, ...access };
}
