import { createClient } from "@/lib/supabase/server";
import type { StaffUserProfile } from "@/lib/auth/staff-auth";

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

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return null;
  }

  const { data: staffUser, error: staffUserError } = await supabase
    .from("staff_users")
    .select("id, full_name, email, role, is_active")
    .eq("id", user.id)
    .maybeSingle<StaffUserProfile>();

  if (staffUserError || !staffUser || !staffUser.is_active) {
    return null;
  }

  return { supabase, staffUser };
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
