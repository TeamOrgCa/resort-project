import { NextResponse } from "next/server";
import { requireAdminStaff } from "@/lib/server/admin-audit";
import { GUEST_HISTORY_PAGE_SIZE, type GuestReservationHistoryRow } from "@/lib/booking/guest-history";

const money = (value: unknown) => value !== null && value !== undefined && Number.isFinite(Number(value)) ? Number(value) : null;

export async function GET(request: Request, context: { params: Promise<{ guestId: string }> }) {
  try {
    const staff = await requireAdminStaff();
    if (!staff) return NextResponse.json({ success: false, message: "Administrator access is required." }, { status: 403 });
    const { guestId } = await context.params;
    const pageInput = new URL(request.url).searchParams.get("page") ?? "0";
    const page = Number(pageInput);
    if (!/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(guestId) || !/^\d+$/.test(pageInput) || !Number.isSafeInteger(page) || page > 1_000_000) {
      return NextResponse.json({ success: false, message: "Choose a valid guest and history page." }, { status: 400 });
    }
    const { data: guest, error: guestError } = await staff.supabase.from("guests").select("id").eq("id", guestId).maybeSingle();
    if (guestError) throw guestError;
    if (!guest) return NextResponse.json({ success: false, message: "Guest account not found." }, { status: 404 });

    // All statuses belong in an account history, including inactive guests' old bookings.
    const { data: reservations, count, error } = await staff.supabase.from("reservations")
      .select("reservation_id, reference_number, status, booking_mode, start_datetime, end_datetime, adult_count, child_count, created_at, checked_in_at, checked_out_at", { count: "exact" })
      .eq("guest_id", guestId).order("created_at", { ascending: false }).order("reservation_id", { ascending: false })
      .range(page * GUEST_HISTORY_PAGE_SIZE, (page + 1) * GUEST_HISTORY_PAGE_SIZE - 1);
    if (error) throw error;
    const ids = (reservations ?? []).map(row => row.reservation_id);
    const bills = ids.length ? await staff.supabase.from("transactions").select("reservation_id,total_amount,paid_amount,balance").in("reservation_id", ids) : { data: [], error: null };
    if (bills.error) throw bills.error;
    const byReservation = new Map((bills.data ?? []).map(bill => [bill.reservation_id, bill]));
    const rows: GuestReservationHistoryRow[] = (reservations ?? []).map(row => {
      const bill = byReservation.get(row.reservation_id);
      return {
        id: row.reservation_id, reference: row.reference_number, status: row.status, bookingMode: row.booking_mode,
        startDatetime: row.start_datetime, endDatetime: row.end_datetime, createdAt: row.created_at,
        adults: row.adult_count, children: row.child_count, checkedInAt: row.checked_in_at, checkedOutAt: row.checked_out_at,
        totalAmount: money(bill?.total_amount), paidAmount: money(bill?.paid_amount), balance: money(bill?.balance),
      };
    });
    return NextResponse.json({ success: true, rows, total: count ?? 0, page, pageSize: GUEST_HISTORY_PAGE_SIZE }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ success: false, message: "Unable to load this guest's reservations. Please retry." }, { status: 500 });
  }
}
