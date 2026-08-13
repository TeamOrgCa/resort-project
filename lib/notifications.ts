import type { SupabaseClient } from "@supabase/supabase-js";

type NotificationRecipientRole = "guest" | "staff";

type NotificationInsert = {
  recipient_role: NotificationRecipientRole;
  recipient_id: string | null;
  actor_id: string | null;
  title: string;
  message?: string | null;
  action_url?: string | null;
  entity_type?: string | null;
  entity_id?: string | null;
};

type NotifyGuestAndStaffOptions = {
  actorId: string;
  guestId: string;
  title: string;
  message?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  guestActionUrl?: string | null;
  staffActionUrl?: string | null;
};

export async function notifyGuestAndStaff(
  supabase: SupabaseClient,
  options: NotifyGuestAndStaffOptions
) {
  const payload: NotificationInsert[] = [
    {
      recipient_role: "guest",
      recipient_id: options.guestId,
      actor_id: options.actorId,
      title: options.title,
      message: options.message ?? null,
      action_url: options.guestActionUrl ?? null,
      entity_type: options.entityType ?? null,
      entity_id: options.entityId ?? null,
    },
    {
      recipient_role: "staff",
      recipient_id: null,
      actor_id: options.actorId,
      title: options.title,
      message: options.message ?? null,
      action_url: options.staffActionUrl ?? null,
      entity_type: options.entityType ?? null,
      entity_id: options.entityId ?? null,
    },
  ];

  return supabase.from("notifications").insert(payload);
}
