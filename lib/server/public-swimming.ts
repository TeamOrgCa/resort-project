import type { SwimmingPolicy, SwimmingAccessMode } from "@/lib/booking/swimming-sessions";
import { createAdminClient } from "@/lib/supabase/admin";
import { publicSwimmingDates, type PublicSwimmingAvailability, type PublicSwimmingCatalog, type PublicSwimmingEligibility, type PublicSwimmingSession, type PublicSwimmingType } from "@/lib/booking/public-swimming";

type CalendarRow = { booking_date: string; type_id: string; starts_at: string; ends_at: string; remaining_capacity: number;
  availability: PublicSwimmingAvailability; eligibility: PublicSwimmingEligibility; opens_at: string; evaluated_at: string; access_mode: SwimmingAccessMode; cutoff_at: string; total_capacity: number | null };

export async function loadPublicSwimmingCatalog(exclude?: string, month?: string): Promise<PublicSwimmingCatalog> {
  const db = createAdminClient();
  const now = new Date(), today = publicSwimmingDates(now)[0];
  const selectedMonth = month ?? today.slice(0, 7);
  const number = Number(selectedMonth.slice(5, 7));
  const from = `${selectedMonth}-01`, monthEnd = new Date(`${from}T00:00:00Z`);
  monthEnd.setUTCMonth(number); monthEnd.setUTCDate(0);
  const to = monthEnd.toISOString().slice(0, 10);
  const [types, calendar, slots, services, policy] = await Promise.all([
    db.from("public_swimming_types").select("*").order("mode"),
    db.rpc("public_swimming_calendar", { p_from: from, p_to: to, p_exclude: exclude ?? null }),
    db.rpc("public_booking_slots", { p_exclude: exclude ?? null }),
    db.from("services").select("service_id,name,price,description,image_url,max_quantity,billing_type").eq("is_active", true).order("name"),
    db.rpc("swimming_policy"),
  ]);
  for (const result of [types, calendar, slots, services, policy]) if (result.error) throw new Error("Unable to load public-swimming availability. Please retry.");
  const mapSlot = (s: { booking_date: string; type_id: string; starts_at: string; ends_at: string; remaining_capacity: number }) =>
    ({ date: s.booking_date, typeId: s.type_id, startDatetime: s.starts_at, endDatetime: s.ends_at, remainingCapacity: s.remaining_capacity, cutoffAt: new Date(Date.parse(s.starts_at) - Number(policy.data?.minimumAdvanceMinutes ?? 60) * 60000).toISOString() });
  const sessions: PublicSwimmingSession[] = ((calendar.data ?? []) as CalendarRow[]).map(s => ({ ...mapSlot(s), availability: s.availability, eligibility: s.eligibility, opensAt: s.opens_at, accessMode: s.access_mode, cutoffAt: s.cutoff_at, totalCapacity: s.total_capacity }));
  const evaluatedAt = calendar.data?.[0]?.evaluated_at ?? now.toISOString();
  const dates = publicSwimmingDates(new Date(evaluatedAt), Math.max(Number(policy.data?.flexibleDays ?? 3), policy.data?.publicOnlyDays == null ? 3 : Number(policy.data.publicOnlyDays) + 1));
  return { types: (types.data ?? []) as PublicSwimmingType[], slots: (slots.data ?? []).map(mapSlot), sessions, dates, today: publicSwimmingDates(new Date(evaluatedAt))[0], now: evaluatedAt, policy: policy.data as SwimmingPolicy, services: services.data ?? [] };
}
