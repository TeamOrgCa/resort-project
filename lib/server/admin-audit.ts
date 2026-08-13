import { createClient } from "@/lib/supabase/server";
import { cookies } from "next/headers";
import { getStaffSessionTokenFromCookieStore } from "@/lib/auth/staff-session";
import type { StaffRole, StaffUserProfile } from "@/lib/auth/staff-auth";

interface AuditLogInput {
  action: string;
  entityType?: string | null;
  entityId?: string | null;
}

interface StaffContext {
  supabase: Awaited<ReturnType<typeof createClient>>;
  staffUser: StaffUserProfile;
}

export async function requireActiveStaff(): Promise<StaffContext | null> {
  const supabase = await createClient();
  const sessionToken = getStaffSessionTokenFromCookieStore(await cookies());

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return null;
  }

  const { data: staffUser, error: staffUserError } = await supabase
    .from("staff_users")
    .select("id, full_name, email, role, is_active, active_session_id, last_login_at, last_logout_at")
    .eq("id", user.id)
    .maybeSingle<StaffUserProfile>();

  if (staffUserError || !staffUser || !staffUser.is_active) {
    return null;
  }

  if (!sessionToken || staffUser.active_session_id !== sessionToken) {
    return null;
  }

  return { supabase, staffUser };
}

export async function requireAdminStaff(): Promise<StaffContext | null> {
  const staffContext = await requireActiveStaff();

  if (!staffContext || staffContext.staffUser.role !== ("admin" as StaffRole)) {
    return null;
  }

  return staffContext;
}

export async function createAuditLog(staffContext: StaffContext, input: AuditLogInput) {
  const { error } = await staffContext.supabase.from("audit_logs").insert({
    user_id: staffContext.staffUser.id,
    action: input.action,
    entity_type: input.entityType ?? null,
    entity_id: input.entityId ?? null,
  });

  return !error;
}
