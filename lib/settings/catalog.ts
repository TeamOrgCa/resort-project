import type { SettingDefinition } from "./types";

export const settingDefinitions: SettingDefinition[] = [
  { key: "resort.name", category: "resort", label: "Resort name", description: "Public name shown across guest-facing pages.", input: "text", defaultValue: "MarVille Resort" },
  { key: "resort.contact_numbers", category: "resort", label: "Contact numbers", description: "Phone numbers for booking and inquiries.", input: "json", defaultValue: ["09172796592", "82360633"] },
  { key: "resort.email", category: "resort", label: "Email address", description: "Primary resort inbox.", input: "text", defaultValue: "emailmarvilleresort@gmail.com" },
  { key: "resort.address", category: "resort", label: "Address", description: "Full resort address.", input: "textarea", defaultValue: "Cabrera Road Hapay na Mangga Brgy. Dolores, Taytay, Rizal 1920" },
  { key: "resort.social_links", category: "resort", label: "Social media links", description: "Social handles or URLs as a JSON object.", input: "json", defaultValue: { facebook: "@marvilleresort", instagram: "@marvilleresort", tiktok: "@marvilleresort" } },
  { key: "reservation.downpayment_percentage", category: "reservation", label: "Downpayment percentage", description: "Minimum percentage required before confirmation.", input: "number", defaultValue: 20 },
  { key: "reservation.cancellation_policy", category: "reservation", label: "Cancellation policy", description: "Policy shown to guests and used by reservation workflows.", input: "textarea", defaultValue: "Downpayments are non-refundable. Rescheduling is available within the configured policy window." },
  { key: "reservation.reschedule_fee", category: "reservation", label: "Reschedule fee", description: "Default fee applied when a reschedule is approved.", input: "number", defaultValue: 500 },
  { key: "reservation.maximum_advance_booking_days", category: "reservation", label: "Maximum advance booking days", description: "How far into the future guests may book.", input: "number", defaultValue: 365 },
  { key: "ocular.daily_capacity", category: "ocular", label: "Daily capacity", description: "Maximum ocular visits accepted per day.", input: "number", defaultValue: 5 },
  { key: "ocular.allowed_booking_window", category: "ocular", label: "Allowed booking window", description: "Time range in which ocular visits may be scheduled.", input: "json", defaultValue: { start: "08:00", end: "17:00" } },
  { key: "ocular.slot_duration_minutes", category: "ocular", label: "Slot duration (minutes)", description: "Default duration used to generate ocular slots.", input: "number", defaultValue: 60 },
  { key: "payments.accepted_methods", category: "payments", label: "Accepted payment methods", description: "Methods displayed at checkout as a JSON array.", input: "json", defaultValue: ["GCash", "Bank Transfer"] },
  { key: "payments.auto_verification_rules", category: "payments", label: "Auto verification rules", description: "Rules for payment automation as a JSON object.", input: "json", defaultValue: { enabled: false, maxAmount: 0 } },
  { key: "payments.receipt_settings", category: "payments", label: "Receipt settings", description: "Receipt behavior as a JSON object.", input: "json", defaultValue: { emailEnabled: true, prefix: "RCPT" } },
  { key: "notifications.email_templates", category: "notifications", label: "Email templates", description: "Template names and bodies as a JSON object.", input: "json", defaultValue: {} },
  { key: "notifications.sms_templates", category: "notifications", label: "SMS templates", description: "SMS template names and bodies as a JSON object.", input: "json", defaultValue: {} },
  { key: "notifications.admin_alert_preferences", category: "notifications", label: "Admin alert preferences", description: "Admin alert channels as a JSON object.", input: "json", defaultValue: { email: true, inApp: true, sms: false } },
];

export const settingCategories = [
  { key: "resort", label: "Resort information" },
  { key: "reservation", label: "Reservation settings" },
  { key: "ocular", label: "Ocular visit settings" },
  { key: "payments", label: "Payment settings" },
  { key: "notifications", label: "Notification settings" },
] as const;