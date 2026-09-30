import { tryCreateAdminClient } from "@/lib/supabase/admin";

export type NotificationStaffRole = "admin" | "staff" | "cashier";

export const NOTIFICATION_AUDIENCES = {
  reservation: ["admin", "staff"],
  payment: ["admin", "cashier"],
  checkout: ["admin", "staff", "cashier"],
  review: ["admin"],
} as const satisfies Record<string, readonly NotificationStaffRole[]>;

type NotificationOptions = {
  actorId: string;
  guestId?: string | null;
  staffRoles?: readonly NotificationStaffRole[];
  title: string;
  message?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  guestActionUrl?: string | null;
  staffActionUrl?: string | null;
};

type NotificationInsert = {
  recipient_role: "guest" | NotificationStaffRole;
  recipient_id: string;
  actor_id: string;
  title: string;
  message: string | null;
  action_url: string | null;
  entity_type: string | null;
  entity_id: string | null;
};

/** Fan out one notification per account so read state and role access stay private. */
export async function createNotifications(options: NotificationOptions): Promise<{ error: Error | null }> {
  const admin = tryCreateAdminClient();
  if (!admin) return { error: new Error("Notification service is unavailable.") };

  const roles = [...new Set(options.staffRoles ?? [])];
  const recipients: Array<{ id: string; role: NotificationStaffRole }> = [];

  if (roles.length) {
    const { data, error } = await admin.from("staff_users")
      .select("id, role")
      .in("role", roles)
      .eq("is_active", true);
    if (error) return { error };
    recipients.push(...(data ?? []) as Array<{ id: string; role: NotificationStaffRole }>);
  }

  const common = {
    actor_id: options.actorId,
    title: options.title,
    message: options.message ?? null,
    entity_type: options.entityType ?? null,
    entity_id: options.entityId ?? null,
  };
  const rows: NotificationInsert[] = [
    ...(options.guestId ? [{
      ...common,
      recipient_role: "guest" as const,
      recipient_id: options.guestId,
      action_url: options.guestActionUrl ?? null,
    }] : []),
    ...recipients.map(({ id, role }) => ({
      ...common,
      recipient_role: role,
      recipient_id: id,
      action_url: options.staffActionUrl ?? null,
    })),
  ];

  if (!rows.length) return { error: null };
  const { error } = await admin.from("notifications").insert(rows);
  return { error };
}
