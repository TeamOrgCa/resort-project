import { NextResponse } from "next/server";
import { requireActiveStaff } from "@/lib/server/admin-audit";
import { staffHasPermission } from "@/lib/server/role-permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { isCatalogUuid } from "@/lib/catalog/catalog";
import type { ReservationRecord, ReservationRecordDetail } from "@/lib/booking/reservation-record";

type Context = { params: Promise<{ id: string }> };
type NamedRelation = { name: string } | { name: string }[] | null;
const relationName = (value: NamedRelation, fallback: string) => (Array.isArray(value) ? value[0]?.name : value?.name) || fallback;

export async function GET(_request: Request, { params }: Context) {
  const staff = await requireActiveStaff();
  if (!staff) return NextResponse.json({ message: "Sign in as active resort staff." }, { status: 401 });
  if (!await staffHasPermission(staff.supabase, staff.staffUser.role, "records")) {
    return NextResponse.json({ message: "You cannot view reservation records." }, { status: 403 });
  }
  const { id } = await params;
  if (!isCatalogUuid(id)) return NextResponse.json({ message: "Choose a valid reservation record." }, { status: 400 });
  try {
    const admin = createAdminClient();
    const { data: reservation, error } = await admin.from("reservations")
      .select("reservation_id,reference_number,guest_id,walk_in_guest_id,start_datetime,end_datetime,booking_mode,booking_type,adult_count,child_count,status,special_requests,created_at,checked_in_at,checked_out_at")
      .eq("reservation_id", id).maybeSingle<ReservationRecord>();
    if (error) throw error;
    if (!reservation) return NextResponse.json({ message: "Reservation record not found." }, { status: 404 });
    const [guest, units, services, bill] = await Promise.all([
      reservation.guest_id || reservation.walk_in_guest_id ? admin.from(reservation.guest_id ? "guests" : "walk_in_guests")
        .select("first_name,last_name,email,phone_number,address")
        .eq(reservation.guest_id ? "id" : "walk_in_guest_id", reservation.guest_id ?? reservation.walk_in_guest_id).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      admin.from("reservation_units").select("quantity,price_per_night,units(name)").eq("reservation_id", id),
      admin.from("reservation_services").select("quantity,price_at_time,services(name)").eq("reservation_id", id),
      admin.from("transactions").select("total_amount,paid_amount,balance,status").eq("reservation_id", id).maybeSingle(),
    ]);
    for (const result of [guest, units, services, bill]) if (result.error) throw result.error;
    const detail: ReservationRecordDetail = {
      reservation, guest: guest.data,
      units: (units.data ?? []).map(row => ({ name: relationName(row.units, "Booked accommodation"), quantity: Number(row.quantity ?? 1), price: Number(row.price_per_night) })),
      services: (services.data ?? []).map(row => ({ name: relationName(row.services, "Booked service"), quantity: Number(row.quantity ?? 1), price: Number(row.price_at_time) })),
      bill: bill.data ? { total: Number(bill.data.total_amount), paid: Number(bill.data.paid_amount ?? 0), balance: Number(bill.data.balance), status: bill.data.status } : null,
    };
    return NextResponse.json({ success: true, detail }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ message: "Unable to load this reservation record. Please retry." }, { status: 503 });
  }
}
