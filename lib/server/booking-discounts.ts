import { createAdminClient } from "@/lib/supabase/admin";
import type { PromoQuote } from "@/lib/booking/discounts";
import { manilaDateKey } from "@/lib/booking/manila-date";

export class BookingPromoError extends Error { constructor(message: string, public status = 400) { super(message); } }

export async function loadBookingPromo(code: unknown): Promise<PromoQuote | null> {
  if (code === undefined || code === null || code === "") return null;
  if (typeof code !== "string" || !/^[A-Z0-9_-]{3,40}$/i.test(code.trim())) throw new BookingPromoError("Enter a valid promo code.");
  const { data, error } = await createAdminClient().from("promo_code_availability").select("code,discount_type,discount_value,starts_at,ends_at,max_uses,usage_count,pending_uses,remaining_uses")
    .eq("code", code.trim().toUpperCase()).eq("is_active", true).maybeSingle();
  if (error) throw new BookingPromoError("Promos are unavailable. Apply docs/promo-usage-limits-migration.sql after the discounts and promos migration.", 503);
  const today = manilaDateKey(new Date());
  if (!data || data.starts_at && data.starts_at.slice(0, 10) > today || data.ends_at && data.ends_at.slice(0, 10) < today) throw new BookingPromoError("This promo code is unavailable or has expired.");
  if (data.max_uses !== null && data.max_uses !== undefined && Number(data.remaining_uses) <= 0) {
    throw new BookingPromoError(Number(data.usage_count) >= Number(data.max_uses) ? "This promo code has reached its maximum number of successful reservations." : "The remaining uses of this promo are held by pending bookings. Please try another code or check again later.", 409);
  }
  return { code: data.code, discount_type: data.discount_type, discount_value: Number(data.discount_value), ...(data.max_uses !== null && data.max_uses !== undefined ? { remainingUses: Number(data.remaining_uses) } : {}) };
}

export async function applyNewBookingPromo(reservationId: string, actorId: string, code: string | null, grossTotal: number, guest: boolean, expectedNet: number) {
  if (!code) return;
  const { data, error } = await createAdminClient().rpc("apply_new_booking_promo", { p_reservation: reservationId, p_actor: actorId,
    p_code: code, p_expected_total: grossTotal, p_guest: guest, p_expected_net: expectedNet });
  if (error) throw new BookingPromoError(error.message, error.code === "40001" ? 409 : error.code === "22023" ? 400 : 503);
  if (Math.abs(Number(data?.totalAmount) - expectedNet) > 0.001 || !Number.isFinite(Number(data?.totalAmount))) throw new BookingPromoError("The promo changed while saving. Reapply the code and review the new total.", 409);
}
