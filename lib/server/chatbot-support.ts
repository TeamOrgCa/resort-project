import { createAdminClient } from "@/lib/supabase/admin";
import { createNotifications } from "@/lib/notifications";
import { CHATBOT_SETTING_KEYS, chatbotSettingDefaults, facebookChatUrl } from "@/lib/chatbot/config";
import { publicResortDefaults } from "@/lib/settings/public-content";
import type { SettingsMap } from "@/lib/settings/types";
import type { SupabaseClient, User } from "@supabase/supabase-js";

export async function loadChatbotSettings(): Promise<SettingsMap> {
  const { data, error } = await createAdminClient().from("business_settings").select("setting_key,setting_value").in("setting_key", CHATBOT_SETTING_KEYS);
  if (error) throw new Error("Chatbot settings are temporarily unavailable.");
  return { ...publicResortDefaults, ...chatbotSettingDefaults, ...Object.fromEntries((data ?? []).map(row => [row.setting_key, row.setting_value])) };
}

export async function requestHumanSupport(client: SupabaseClient, user: User | null, message: string, settings: SettingsMap) {
  let name = "Website visitor (not signed in)", reference: string | null = null;
  if (user) {
    const { data: guest, error } = await client.from("guests").select("first_name,middle_name,last_name,is_active").eq("id", user.id).maybeSingle();
    if (!error && guest?.is_active) {
      name = [guest.first_name, guest.middle_name, guest.last_name].filter(Boolean).join(" ").trim() || "Guest";
      const requestedReference = message.match(/\b(?:SR|MV)-[A-Z0-9-]+\b/i)?.[0]?.toUpperCase();
      if (requestedReference) {
        const { data: reservation } = await client.from("reservations").select("reference_number").eq("guest_id", user.id).eq("reference_number", requestedReference).maybeSingle();
        reference = reservation?.reference_number ?? null;
      }
    } else name = "Signed-in customer";
  }
  let notified = false;
  try {
    const { error } = await createNotifications({ actorId: user?.id ?? null, staffRoles: ["admin"], title: "Human assistance requested",
      message: `${name}${reference ? ` (${reference})` : ""} requested help from a resort employee.\nReason: ${message}\nChannel: Facebook Messenger`,
      entityType: "chatbot_support", entityId: null, staffActionUrl: null });
    notified = !error;
  } catch { /* Always provide the direct channel, even if the admin alert fails. */ }
  const numbers = Array.isArray(settings["resort.contact_numbers"]) ? settings["resort.contact_numbers"].filter(value => typeof value === "string").join(" / ") : "";
  const email = typeof settings["resort.email"] === "string" ? settings["resort.email"] : "";
  return {
    reply: `You can chat directly with a MarVille Resort employee on Facebook Messenger using the link below.${notified ? " An administrator has been notified of your request." : " Please message the resort directly; the administrator notification could not be delivered."}${numbers ? `\nPhone: ${numbers}` : ""}${email ? `\nEmail: ${email}` : ""}\nYour message will be sent to the resort when you open Messenger and send it there.`,
    supportLink: { label: "Chat with MarVille Resort on Facebook", url: facebookChatUrl(settings) }, notified,
  };
}
