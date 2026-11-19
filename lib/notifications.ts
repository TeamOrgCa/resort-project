import { tryCreateAdminClient } from "@/lib/supabase/admin";
import { formatNotificationText } from "@/lib/notification-text";
import { notificationActionUrl, ocularVisitDetailsUrl } from "@/lib/notification-links";
import { hasPermission, type Permission } from "@/lib/auth/role-access";

export type NotificationStaffRole = "admin" | "staff" | "cashier";

export const NOTIFICATION_AUDIENCES = {
  reservation: ["admin", "staff"],
  payment: ["admin", "cashier"],
  checkout: ["admin", "staff", "cashier"],
  review: ["admin", "staff"],
} as const satisfies Record<string, readonly NotificationStaffRole[]>;

type NotificationOptions = {
  actorId: string | null;
  guestId?: string | null;
  staffRoles?: readonly NotificationStaffRole[];
  title: string;
  message?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  guestActionUrl?: string | null;
  staffActionUrl?: string | null;
  staffTitle?: string;
  staffMessage?: string | null;
  staffRequiredPermissions?: readonly Permission[];
};

type NotificationInsert = {
  recipient_role: "guest" | NotificationStaffRole;
  recipient_id: string;
  actor_id: string | null;
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
    title: formatNotificationText(options.title),
    message: options.message ? formatNotificationText(options.message) : options.message ?? null,
    entity_type: options.entityType ?? null,
    entity_id: options.entityId ?? null,
  };
  let allowedRecipients = recipients;
  if (options.staffRequiredPermissions?.length && recipients.some(recipient => recipient.role !== "admin")) {
    const { data: grants, error } = await admin.from("role_permissions").select("role,permissions").in("role", roles.filter(role => role !== "admin"));
    if (error) return { error };
    allowedRecipients = recipients.filter(recipient => options.staffRequiredPermissions!.every(permission => hasPermission(recipient.role,
      grants?.find(row => row.role === recipient.role)?.permissions ?? [], permission)));
  }
  const rows: NotificationInsert[] = [
    ...(options.guestId ? [{
      ...common,
      recipient_role: "guest" as const,
      recipient_id: options.guestId,
      action_url: options.entityType === "ocular_visit" ? ocularVisitDetailsUrl(options.entityId) : notificationActionUrl({ action_url: options.guestActionUrl ?? null, entity_type: options.entityType, entity_id: options.entityId }),
    }] : []),
    ...allowedRecipients.map(({ id, role }) => ({
      ...common,
      title: formatNotificationText(options.staffTitle ?? options.title),
      message: options.staffMessage === undefined ? common.message : options.staffMessage === null ? null : formatNotificationText(options.staffMessage),
      recipient_role: role,
      recipient_id: id,
      action_url: notificationActionUrl({ action_url: options.staffActionUrl ?? null, entity_type: options.entityType, entity_id: options.entityId }),
    })),
  ];

  if (!rows.length) return { error: null };
  const { error } = await admin.from("notifications").insert(rows);
  return { error };
}
