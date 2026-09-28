import type { SupabaseClient } from "@supabase/supabase-js";

export interface UnitCatalogRecord {
  unit_id: string;
  unit_img: string | null;
  name: string;
  description: string | null;
  capacity: number;
  base_price: number;
  is_active: boolean;
  archived_at: string | null;
}

export interface ServiceCatalogRecord {
  service_id: string;
  name: string;
  description: string | null;
  price: number;
  is_active: boolean;
}

export interface PaymentMethodRecord {
  payment_method_id: string;
  name: string;
  type: string;
  is_active: boolean;
}

export interface PaymentAccountRecord {
  account_id: string;
  payment_method_id: string | null;
  account_name: string;
  account_number: string | null;
  qr_image: string | null;
  instructions: string | null;
  is_active: boolean;
}

export interface PolicyRecord {
  policy_id: string;
  title: string;
  content: string;
  display_order: number;
  is_active: boolean;
}

export interface OcularSlotRecord {
  slot_id: string;
  start_time: string;
  end_time: string;
  max_capacity: number;
  is_active: boolean;
}

export async function getActiveCatalog(supabase: SupabaseClient) {
  const [units, services, paymentMethods, paymentAccounts, policies, ocularSlots] = await Promise.all([
    supabase.from("units").select("unit_id, unit_img, name, description, capacity, base_price, is_active, archived_at").eq("is_active", true).is("archived_at", null).order("name"),
    supabase.from("services").select("service_id, name, description, price, is_active").eq("is_active", true).order("name"),
    supabase.from("payment_methods").select("payment_method_id, name, type, is_active").eq("is_active", true).order("name"),
    supabase.from("payment_accounts").select("account_id, payment_method_id, account_name, account_number, qr_image, instructions, is_active").eq("is_active", true).order("account_name"),
    supabase.from("reservation_policies").select("policy_id, title, content, display_order, is_active").eq("is_active", true).order("display_order"),
    supabase.from("ocular_time_slots").select("slot_id, start_time, end_time, max_capacity, is_active").eq("is_active", true).order("start_time"),
  ]);

  const failed = [units, services, paymentMethods, paymentAccounts, policies, ocularSlots].find((result) => result.error);
  if (failed?.error) throw new Error(failed.error.message);

  return {
    units: (units.data ?? []) as UnitCatalogRecord[],
    services: (services.data ?? []) as ServiceCatalogRecord[],
    paymentMethods: (paymentMethods.data ?? []) as PaymentMethodRecord[],
    paymentAccounts: (paymentAccounts.data ?? []) as PaymentAccountRecord[],
    policies: (policies.data ?? []) as PolicyRecord[],
    ocularSlots: (ocularSlots.data ?? []) as OcularSlotRecord[],
  };
}

export async function getActiveOcularSlots(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from("ocular_time_slots")
    .select("slot_id, start_time, end_time, max_capacity, is_active")
    .eq("is_active", true)
    .order("start_time");
  if (error) throw new Error(error.message);
  return (data ?? []) as OcularSlotRecord[];
}