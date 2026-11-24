import { createAdminClient } from "@/lib/supabase/admin";
import type { PublicSwimmingCatalog, PublicSwimmingSlot, PublicSwimmingType } from "@/lib/booking/public-swimming";

export async function loadPublicSwimmingCatalog(exclude?: string): Promise<PublicSwimmingCatalog> {
  const db = createAdminClient();
  const [types, slots, services] = await Promise.all([
    db.from("public_swimming_types").select("*").eq("is_active", true).order("mode"),
    db.rpc("public_booking_slots", { p_exclude: exclude ?? null }),
    db.from("services").select("service_id,name,price,description,image_url,max_quantity,billing_type").eq("is_active", true).order("name"),
  ]);
  for (const result of [types, slots, services]) if (result.error) throw new Error("Unable to load public-swimming availability. Please retry.");
  const available: PublicSwimmingSlot[] = (slots.data ?? []).map((s: { booking_date: string; type_id: string; starts_at: string; ends_at: string; remaining_capacity: number }) =>
    ({ date: s.booking_date, typeId: s.type_id, startDatetime: s.starts_at, endDatetime: s.ends_at, remainingCapacity: s.remaining_capacity }));
  const first = available.map(s => s.date).sort()[0];
  const dates = first ? Array.from({ length: 3 }, (_, i) => new Date(Date.parse(`${first}T00:00:00Z`) + i * 86400000).toISOString().slice(0, 10)) : [];
  return { types: (types.data ?? []) as PublicSwimmingType[], slots: available, dates, services: services.data ?? [] };
}
