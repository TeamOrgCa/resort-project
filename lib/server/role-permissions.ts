import type { SupabaseClient } from "@supabase/supabase-js";
import { hasPermission, type Permission } from "@/lib/auth/role-access";
import type { StaffRole } from "@/lib/auth/staff-auth";

export async function getRolePermissions(client: SupabaseClient, role: StaffRole): Promise<string[]> {
  if (role === "admin") return [];
  const { data, error } = await client.from("role_permissions").select("permissions").eq("role", role).maybeSingle();
  if (error || !data || !Array.isArray(data.permissions)) return [];
  return data.permissions.filter((value: unknown): value is string => typeof value === "string");
}

export async function staffHasPermission(client: SupabaseClient, role: StaffRole, permission: Permission): Promise<boolean> {
  return hasPermission(role, await getRolePermissions(client, role), permission);
}
