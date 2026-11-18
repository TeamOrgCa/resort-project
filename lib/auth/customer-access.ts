import type { SupabaseClient, User } from "@supabase/supabase-js";

export function isCustomerAccountPage(path: string) {
  return /^\/(?:booking\/(?:form|payment)|manage|profile)(?:\/|$)/.test(path);
}

export function isCustomerAccountApi(path: string, method: string) {
  return (path.startsWith("/api/reservations/") && !path.startsWith("/api/reservations/availability"))
    || /^\/api\/ocular-visits(?:\/|$)/.test(path)
    || path === "/api/reviews/create" || path === "/api/reviews/eligibility"
    || (path === "/api/reviews" && method !== "GET") || path === "/api/auth/me";
}

// Staff may also have a historical guest profile. Check their staff record first;
// editable user metadata and the existence of a guest profile are not role checks.
export async function customerAccountUser(client: SupabaseClient, user: User | null): Promise<User | null> {
  if (!user) return null;
  const { data: staff, error } = await client.from("staff_users").select("id").eq("id", user.id).maybeSingle();
  if (error) throw error;
  return staff ? null : user;
}
